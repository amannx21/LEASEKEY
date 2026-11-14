//! Slime Arena: a demo GAME built on LeaseKey.
//!
//! It shows how any game integrates, using nothing but LeaseKey's public
//! interface:
//!
//! * it is a registered LeaseKey game with its own capped item types;
//! * it decides which games' items it honours (`accepted`);
//! * it rewards its own players: a renter who lands `MIN_USES` on-chain
//!   strikes in one lease may roll once, and a win makes this contract call
//!   the factory's ordinary `mint`, paid from the game's own balance.
//!
//! LeaseKey itself never hands out items. This contract is the game.
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::store::LookupMap;
use near_sdk::{
    env, log, near, require, AccountId, Gas, GasWeight, NearToken, PanicOnDefault, Promise,
    PromiseError, PromiseOrValue,
};

/// On-chain strikes a renter must land in one lease to earn a roll.
pub const MIN_USES: u32 = 20;
const VIEW_GAS: Gas = Gas::from_tgas(5);
const CHECK_GAS: Gas = Gas::from_tgas(20);
const MINT_GAS: Gas = Gas::from_tgas(50);
/// NEAR this contract always keeps for its own storage.
const RESERVE: u128 = 500_000_000_000_000_000_000_000; // 0.5 NEAR

/// The part of a LeaseKey item's state this game needs.
#[near(serializers = [json])]
pub struct LeaseState {
    pub renter: Option<AccountId>,
    pub uses: u32,
    pub rental_count: u32,
    pub rental_active: bool,
    /// The game that made the item.
    pub creator: AccountId,
}

/// The part of a LeaseKey item type this game needs.
#[near(serializers = [json])]
pub struct RewardType {
    pub type_id: String,
    pub max_supply: u32,
    pub minted: u32,
}

#[near(serializers = [json])]
pub struct Rules {
    pub factory: AccountId,
    pub min_uses: u32,
    pub chance_percent: u8,
    pub accepted_games: Vec<AccountId>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct ArenaGame {
    factory: AccountId,
    admin: AccountId,
    /// Games whose items this arena honours. Its own choice.
    accepted: Vec<AccountId>,
    chance: u8,
    rolls: LookupMap<String, bool>,
}

#[near]
impl ArenaGame {
    #[init]
    pub fn new(factory: AccountId, accepted_games: Vec<AccountId>) -> Self {
        Self {
            factory,
            admin: env::predecessor_account_id(),
            accepted: accepted_games,
            chance: 40,
            rolls: LookupMap::new(b"r"),
        }
    }

    /// The game changes which games it accepts, or its reward chance.
    pub fn set_rules(&mut self, accepted_games: Option<Vec<AccountId>>, chance_percent: Option<u8>) {
        require!(env::predecessor_account_id() == self.admin, "only the game admin");
        if let Some(a) = accepted_games {
            self.accepted = a;
        }
        if let Some(c) = chance_percent {
            require!(c <= 100, "percent above 100");
            self.chance = c;
        }
    }

    pub fn get_rules(&self) -> Rules {
        Rules {
            factory: self.factory.clone(),
            min_uses: MIN_USES,
            chance_percent: self.chance,
            accepted_games: self.accepted.clone(),
        }
    }

    pub fn reward_rolled(&self, token_id: String, rental_count: u32) -> bool {
        self.rolls.contains_key(&format!("{token_id}:{rental_count}"))
    }

    /// Roll for a reward with the item the caller is renting. The game reads
    /// the lease, its own reward types and the mint price straight from chain.
    pub fn claim_reward(&mut self, token_id: String) -> Promise {
        let player = env::predecessor_account_id();
        let me = env::current_account_id();
        let item: AccountId = format!("{token_id}.{}", self.factory)
            .parse()
            .unwrap_or_else(|_| env::panic_str("bad token id"));
        let view = |account: AccountId, method: &str, args: String| {
            Promise::new(account).function_call(method.to_string(), args.into_bytes(), NearToken::from_yoctonear(0), VIEW_GAS)
        };
        view(item, "get_item", "{}".to_string())
            .and(view(self.factory.clone(), "get_item_types", json!({ "game": me }).to_string()))
            .and(view(self.factory.clone(), "mint_deposit", "{}".to_string()))
            .then(Self::ext(me).with_static_gas(CHECK_GAS).on_checked(player, token_id))
    }

    #[private]
    pub fn on_checked(
        &mut self,
        player: AccountId,
        token_id: String,
        #[callback_result] item: Result<LeaseState, PromiseError>,
        #[callback_result] types: Result<Vec<RewardType>, PromiseError>,
        #[callback_result] deposit: Result<U128, PromiseError>,
    ) -> PromiseOrValue<Option<bool>> {
        let item = item.unwrap_or_else(|_| env::panic_str("not a LeaseKey item"));
        require!(
            self.accepted.contains(&item.creator),
            "this arena does not accept items from that game"
        );
        require!(
            item.rental_active && item.renter.as_ref() == Some(&player),
            "you are not renting this item right now"
        );
        require!(
            item.uses >= MIN_USES,
            format!("land {} strikes in this lease to earn a roll, you have {}", MIN_USES, item.uses)
        );
        let key = format!("{token_id}:{}", item.rental_count);
        require!(!self.rolls.contains_key(&key), "this lease already used its reward roll");
        self.rolls.insert(key, true);

        let seed = env::random_seed();
        let won = (seed[0] as u32 * 100 / 256) < self.chance as u32;
        // Weighted by remaining supply: commons often, rare types rarely, sold-out types never.
        let pool: Vec<RewardType> = types.unwrap_or_default().into_iter().filter(|t| t.minted < t.max_supply).collect();
        let total: u32 = pool.iter().map(|t| t.max_supply - t.minted).sum();
        let deposit = deposit.map(|d| d.0).unwrap_or(u128::MAX);
        let affordable = env::account_balance().as_yoctonear() > deposit.saturating_add(RESERVE);
        if !won || total == 0 || !affordable {
            log!("no reward this roll for {}", player);
            return PromiseOrValue::Value(None);
        }
        let mut pick = u32::from_le_bytes([seed[1], seed[2], seed[3], seed[4]]) % total;
        let reward = pool
            .into_iter()
            .find(|t| {
                let left = t.max_supply - t.minted;
                if pick < left {
                    true
                } else {
                    pick -= left;
                    false
                }
            })
            .unwrap();
        // The same `mint` any partner game calls, paid by this game.
        let args = json!({ "args": {
            "item_type": reward.type_id,
            "price_per_hour": "50000000000000000000000",
            "max_secs": "7200",
            "royalty_bps": 1000,
            "owner": player,
        }})
        .to_string()
        .into_bytes();
        PromiseOrValue::Promise(Promise::new(self.factory.clone()).function_call_weight(
            "mint".to_string(),
            args,
            NearToken::from_yoctonear(deposit),
            MINT_GAS,
            GasWeight(1),
        ))
    }
}
