//! LeaseKey item contract.
//!
//! One instance lives on every item sub-account (`<token-id>.<factory>`).
//! The account has NO full-access key: only this code can act for it.
//!
//! Renting never moves the NFT. `rent` adds a function-call access key for the
//! renter that is restricted to `receiver_id = this account` and
//! `method_names = ["use_item"]`. NEAR keys do not expire, so expiry is
//! enforced here, and `end_rental` (callable by anyone after expiry) deletes
//! the key and settles the rent.
use std::collections::BTreeMap;

use near_sdk::json_types::{U128, U64};
use near_sdk::{
    env, log, near, require, AccountId, Allowance, Gas, NearToken, PanicOnDefault, Promise,
    PromiseError, PublicKey,
};

/// Flat charge per `use_item`, taken from the renter's gas budget. The item
/// account pays the gas of every session-key call, so this keeps it solvent.
pub const USE_FEE: u128 = 500_000_000_000_000_000_000; // 0.0005 NEAR (measured cost is about 0.0002)
/// Smallest gas budget a renter may attach on top of the rent.
pub const MIN_GAS_BUDGET: u128 = 10_000_000_000_000_000_000_000; // 0.01 NEAR
/// Fee kept (as earnings) from the refund when a renter returns early.
pub const EARLY_RETURN_FEE_BPS: u128 = 500; // 5%
/// Shortest rental. Short enough for a live demo.
pub const MIN_RENT_SECS: u64 = 60;
/// Price of a repair, per durability point restored.
pub const REPAIR_FEE_PER_POINT: u128 = 100_000_000_000_000_000_000; // 0.0001 NEAR

const CALLBACK_GAS: Gas = Gas::from_tgas(5);
const NS_PER_MS: u64 = 1_000_000;

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Rental {
    pub renter: AccountId,
    pub renter_pk: PublicKey,
    pub starts_at: U64,
    pub ends_at: U64,
    pub rent_paid: U128,
    pub gas_budget: U128,
    pub uses: u32,
}

#[near(serializers = [json])]
pub struct ItemInit {
    pub token_id: String,
    pub owner: AccountId,
    pub creator: AccountId,
    pub royalty_bps: u16,
    pub name: String,
    pub image: String,
    pub power: u32,
    pub price_per_hour: U128,
    pub max_secs: U64,
    pub max_durability: u32,
}

#[near(serializers = [json])]
pub struct ItemView {
    pub token_id: String,
    pub account_id: AccountId,
    pub factory: AccountId,
    pub owner: AccountId,
    pub creator: AccountId,
    pub royalty_bps: u16,
    pub name: String,
    pub image: String,
    pub power: u32,
    pub price_per_hour: U128,
    pub max_secs: U64,
    pub listed: bool,
    pub durability: u32,
    pub max_durability: u32,
    /// Current renter, if a rental exists (it may be expired but unsettled).
    pub renter: Option<AccountId>,
    pub renter_pk: Option<PublicKey>,
    pub starts_at: Option<U64>,
    pub ends_at: Option<U64>,
    pub rent_paid: Option<U128>,
    pub uses: u32,
    pub uses_left: u32,
    /// True while the rental exists and has not reached `ends_at`.
    pub rental_active: bool,
    pub lifetime_earnings: U128,
    pub owner_earnings: U128,
    pub creator_earnings: U128,
    pub rental_count: u32,
    pub total_uses: u64,
    pub now_ms: U64,
}

#[near(serializers = [json])]
pub struct UseResult {
    pub action: String,
    pub power: u32,
    pub uses: u32,
    pub uses_left: u32,
    pub durability: u32,
    pub ends_at: U64,
}

#[near(serializers = [json])]
pub struct Settlement {
    pub renter: AccountId,
    pub rent_earned: U128,
    pub owner_cut: U128,
    pub creator_cut: U128,
    pub renter_refund: U128,
    pub early: bool,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Item {
    factory: AccountId,
    token_id: String,
    owner: AccountId,
    creator: AccountId,
    royalty_bps: u16,
    name: String,
    image: String,
    power: u32,
    price_per_hour: u128,
    max_secs: u64,
    listed: bool,
    durability: u32,
    max_durability: u32,
    rental: Option<Rental>,
    lifetime_earnings: u128,
    owner_earnings: u128,
    creator_earnings: u128,
    rental_count: u32,
    total_uses: u64,
    /// Payouts whose transfer failed. Nothing gets stuck: claim() retries.
    unclaimed: BTreeMap<AccountId, u128>,
}

fn now_ms() -> u64 {
    env::block_timestamp() / NS_PER_MS
}

/// Rent for `secs` at `price_per_hour`, rounded down.
pub fn rent_cost(price_per_hour: u128, secs: u64) -> u128 {
    price_per_hour * secs as u128 / 3600
}

/// Pro-rata split of a rental that is returned at `now`.
/// Returns (rent kept as earnings, rent refunded to the renter).
pub fn early_return_split(rent_paid: u128, starts_at: u64, ends_at: u64, now: u64) -> (u128, u128) {
    let total = (ends_at - starts_at) as u128;
    let left = ends_at.saturating_sub(now.max(starts_at)) as u128;
    let unused = rent_paid * left / total;
    let fee = unused * EARLY_RETURN_FEE_BPS / 10_000;
    let refund = unused - fee;
    (rent_paid - refund, refund)
}

/// Split of earned rent. Returns (owner cut, creator cut).
pub fn revenue_split(earned: u128, royalty_bps: u16) -> (u128, u128) {
    let creator = earned * royalty_bps as u128 / 10_000;
    (earned - creator, creator)
}

#[near]
impl Item {
    /// Called once by the factory in the same transaction that creates the account.
    #[init]
    pub fn new(init: ItemInit) -> Self {
        let current = env::current_account_id();
        let factory = env::predecessor_account_id();
        require!(
            current.as_str().ends_with(&format!(".{factory}")),
            "only the parent factory can initialise an item"
        );
        require!(init.royalty_bps <= 5_000, "royalty above 50%");
        require!(init.max_durability > 0, "max_durability must be positive");
        require!(init.max_secs.0 >= MIN_RENT_SECS, "max_secs below minimum rental");
        Self {
            factory,
            token_id: init.token_id,
            owner: init.owner,
            creator: init.creator,
            royalty_bps: init.royalty_bps,
            name: init.name,
            image: init.image,
            power: init.power,
            price_per_hour: init.price_per_hour.0,
            max_secs: init.max_secs.0,
            listed: false,
            durability: init.max_durability,
            max_durability: init.max_durability,
            rental: None,
            lifetime_earnings: 0,
            owner_earnings: 0,
            creator_earnings: 0,
            rental_count: 0,
            total_uses: 0,
            unclaimed: BTreeMap::new(),
        }
    }

    // ---------------------------------------------------------------- owner

    /// List the item for rent. Optionally update price and max duration.
    pub fn list(&mut self, price_per_hour: Option<U128>, max_secs: Option<U64>) {
        self.assert_owner();
        require!(self.rental.is_none(), "cannot change a listing during a rental");
        if let Some(p) = price_per_hour {
            self.price_per_hour = p.0;
        }
        if let Some(m) = max_secs {
            require!(m.0 >= MIN_RENT_SECS, "max_secs below minimum rental");
            self.max_secs = m.0;
        }
        require!(self.price_per_hour > 0, "price must be positive");
        self.listed = true;
        self.emit("item_listed", &format!(r#""price_per_hour":"{}""#, self.price_per_hour));
    }

    /// Remove the listing. Impossible while a rental exists: the owner cannot rug.
    pub fn unlist(&mut self) {
        self.assert_owner();
        require!(self.rental.is_none(), "cannot unlist during a rental");
        self.listed = false;
        self.emit("item_unlisted", "");
    }

    /// Restore durability to max. The fee is an economy sink paid to the game creator.
    #[payable]
    pub fn repair(&mut self) {
        self.assert_owner();
        let missing = (self.max_durability - self.durability) as u128;
        require!(missing > 0, "item is not damaged");
        let fee = missing * REPAIR_FEE_PER_POINT;
        let attached = env::attached_deposit().as_yoctonear();
        require!(attached >= fee, format!("repair costs {fee} yoctoNEAR"));
        self.durability = self.max_durability;
        self.pay(self.creator.clone(), fee);
        if attached > fee {
            self.pay(env::predecessor_account_id(), attached - fee);
        }
        self.emit("item_repaired", "");
    }

    /// The factory pushes NFT ownership changes here. A rental in progress is untouched.
    pub fn set_owner(&mut self, owner: AccountId) {
        require!(env::predecessor_account_id() == self.factory, "only the factory");
        self.owner = owner;
    }

    // --------------------------------------------------------------- renter

    /// Rent the item. Attach `price_per_hour * duration / 3600` plus a gas
    /// budget (>= 0.01 NEAR). `public_key` is the renter's session key: it is
    /// added to THIS account, able to call `use_item` here and nothing else.
    #[payable]
    pub fn rent(&mut self, public_key: PublicKey, duration_secs: U64) -> Promise {
        require!(self.listed, "item is not listed");
        require!(self.rental.is_none(), "item is rented (call end_rental if expired)");
        require!(self.durability > 0, "item is broken, owner must repair it");
        let secs = duration_secs.0;
        require!(
            (MIN_RENT_SECS..=self.max_secs).contains(&secs),
            format!("duration must be {MIN_RENT_SECS}..={} seconds", self.max_secs)
        );
        let cost = rent_cost(self.price_per_hour, secs);
        let attached = env::attached_deposit().as_yoctonear();
        require!(
            attached >= cost + MIN_GAS_BUDGET,
            format!("attach rent {cost} + gas budget of at least {MIN_GAS_BUDGET} yoctoNEAR")
        );
        let gas_budget = attached - cost;
        let renter = env::predecessor_account_id();
        let now = now_ms();
        self.rental = Some(Rental {
            renter: renter.clone(),
            renter_pk: public_key.clone(),
            starts_at: U64(now),
            ends_at: U64(now + secs * 1000),
            rent_paid: U128(cost),
            gas_budget: U128(gas_budget),
            uses: 0,
        });
        self.rental_count += 1;
        let me = env::current_account_id();
        Promise::new(me.clone())
            .add_access_key_allowance(
                public_key,
                Allowance::limited(NearToken::from_yoctonear(gas_budget)).unwrap(),
                me.clone(),
                "use_item",
            )
            .then(
                Self::ext(me)
                    .with_static_gas(CALLBACK_GAS)
                    .on_key_added(renter, U128(attached)),
            )
    }

    /// If the session key could not be added, undo the rental and refund everything.
    #[private]
    pub fn on_key_added(
        &mut self,
        renter: AccountId,
        attached: U128,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> Option<Rental> {
        if result.is_ok() {
            let rental = self.rental.clone();
            if let Some(r) = &rental {
                self.emit(
                    "item_rented",
                    &format!(
                        r#""renter":"{}","ends_at":"{}","rent_paid":"{}""#,
                        r.renter, r.ends_at.0, r.rent_paid.0
                    ),
                );
            }
            return rental;
        }
        self.rental = None;
        self.rental_count -= 1;
        self.pay(renter, attached.0);
        None
    }

    /// The ONLY method the renter's session key can call.
    /// The call is signed by this account with the renter's key, so there is
    /// no wallet pop-up and the player pays no gas.
    pub fn use_item(&mut self, action: String) -> UseResult {
        let me = env::current_account_id();
        require!(
            env::predecessor_account_id() == me && env::signer_account_id() == me,
            "use_item needs the renter session key"
        );
        let rental = self.rental.as_mut().unwrap_or_else(|| env::panic_str("item is not rented"));
        require!(env::signer_account_pk() == rental.renter_pk, "not the renter key");
        require!(now_ms() < rental.ends_at.0, "lease expired");
        let max_uses = (rental.gas_budget.0 / USE_FEE) as u32;
        require!(rental.uses < max_uses, "gas budget used up");
        require!(self.durability > 0, "item is broken");
        require!(action.len() <= 32, "action too long");
        rental.uses += 1;
        let (uses, ends_at, renter) = (rental.uses, rental.ends_at, rental.renter.clone());
        self.total_uses += 1;
        self.durability -= 1;
        log!(
            r#"EVENT_JSON:{{"standard":"leasekey","version":"1.0.0","event":"item_used","data":{{"token_id":"{}","renter":"{}","action":"{}","power":{},"uses":{},"durability":{}}}}}"#,
            self.token_id,
            renter,
            action.replace(['"', '\\'], ""),
            self.power,
            uses,
            self.durability
        );
        UseResult {
            action,
            power: self.power,
            uses,
            uses_left: max_uses - uses,
            durability: self.durability,
            ends_at,
        }
    }

    /// Renter gives the item back before expiry and gets unused time refunded.
    pub fn return_early(&mut self) -> Settlement {
        let rental = self.rental.clone().unwrap_or_else(|| env::panic_str("item is not rented"));
        require!(env::predecessor_account_id() == rental.renter, "only the renter can return early");
        let now = now_ms();
        require!(now < rental.ends_at.0, "lease already expired, call end_rental");
        let (earned, refund) =
            early_return_split(rental.rent_paid.0, rental.starts_at.0, rental.ends_at.0, now);
        self.settle(rental, earned, refund, true)
    }

    /// Anyone can end an expired rental: deletes the session key and pays everyone.
    pub fn end_rental(&mut self) -> Settlement {
        let rental = self.rental.clone().unwrap_or_else(|| env::panic_str("no rental to end"));
        require!(now_ms() >= rental.ends_at.0, "lease has not expired yet");
        let earned = rental.rent_paid.0;
        self.settle(rental, earned, 0, false)
    }

    /// Retry a payout that failed earlier.
    pub fn claim(&mut self) {
        let who = env::predecessor_account_id();
        let amount = self.unclaimed.remove(&who).unwrap_or(0);
        require!(amount > 0, "nothing to claim");
        self.pay(who, amount);
    }

    #[private]
    pub fn on_payout(
        &mut self,
        account: AccountId,
        amount: U128,
        #[callback_result] result: Result<(), PromiseError>,
    ) {
        if result.is_err() {
            *self.unclaimed.entry(account).or_insert(0) += amount.0;
        }
    }

    // ---------------------------------------------------------------- views

    pub fn get_item(&self) -> ItemView {
        let now = now_ms();
        let r = self.rental.as_ref();
        let max_uses = r.map(|r| (r.gas_budget.0 / USE_FEE) as u32).unwrap_or(0);
        let uses = r.map(|r| r.uses).unwrap_or(0);
        ItemView {
            token_id: self.token_id.clone(),
            account_id: env::current_account_id(),
            factory: self.factory.clone(),
            owner: self.owner.clone(),
            creator: self.creator.clone(),
            royalty_bps: self.royalty_bps,
            name: self.name.clone(),
            image: self.image.clone(),
            power: self.power,
            price_per_hour: U128(self.price_per_hour),
            max_secs: U64(self.max_secs),
            listed: self.listed,
            durability: self.durability,
            max_durability: self.max_durability,
            renter: r.map(|r| r.renter.clone()),
            renter_pk: r.map(|r| r.renter_pk.clone()),
            starts_at: r.map(|r| r.starts_at),
            ends_at: r.map(|r| r.ends_at),
            rent_paid: r.map(|r| r.rent_paid),
            uses,
            uses_left: max_uses.saturating_sub(uses),
            rental_active: r.map(|r| now < r.ends_at.0).unwrap_or(false),
            lifetime_earnings: U128(self.lifetime_earnings),
            owner_earnings: U128(self.owner_earnings),
            creator_earnings: U128(self.creator_earnings),
            rental_count: self.rental_count,
            total_uses: self.total_uses,
            now_ms: U64(now),
        }
    }

    pub fn get_unclaimed(&self, account_id: AccountId) -> U128 {
        U128(self.unclaimed.get(&account_id).copied().unwrap_or(0))
    }

    pub fn quote(&self, duration_secs: U64) -> U128 {
        U128(rent_cost(self.price_per_hour, duration_secs.0))
    }
}

impl Item {
    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "only the item owner");
    }

    fn emit(&self, event: &str, data: &str) {
        let sep = if data.is_empty() { "" } else { "," };
        log!(
            r#"EVENT_JSON:{{"standard":"leasekey","version":"1.0.0","event":"{}","data":{{"token_id":"{}"{}{}}}}}"#,
            event,
            self.token_id,
            sep,
            data
        );
    }

    /// Clears the rental FIRST (so it can never settle twice), deletes the
    /// session key, then pays owner, creator and renter.
    fn settle(&mut self, rental: Rental, earned: u128, rent_refund: u128, early: bool) -> Settlement {
        self.rental = None;
        let gas_used = (rental.uses as u128 * USE_FEE).min(rental.gas_budget.0);
        let renter_refund = rent_refund + (rental.gas_budget.0 - gas_used);
        let (owner_cut, creator_cut) = revenue_split(earned, self.royalty_bps);
        self.lifetime_earnings += earned;
        self.owner_earnings += owner_cut;
        self.creator_earnings += creator_cut;

        Promise::new(env::current_account_id()).delete_key(rental.renter_pk.clone()).detach();
        self.pay(self.owner.clone(), owner_cut);
        self.pay(self.creator.clone(), creator_cut);
        self.pay(rental.renter.clone(), renter_refund);

        self.emit(
            "rental_settled",
            &format!(
                r#""renter":"{}","rent_earned":"{}","owner_cut":"{}","creator_cut":"{}","renter_refund":"{}","early":{}"#,
                rental.renter, earned, owner_cut, creator_cut, renter_refund, early
            ),
        );
        Settlement {
            renter: rental.renter,
            rent_earned: U128(earned),
            owner_cut: U128(owner_cut),
            creator_cut: U128(creator_cut),
            renter_refund: U128(renter_refund),
            early,
        }
    }

    /// Transfer with a callback: a failed transfer is credited to `unclaimed`.
    fn pay(&self, account: AccountId, amount: u128) {
        if amount == 0 {
            return;
        }
        Promise::new(account.clone())
            .transfer(NearToken::from_yoctonear(amount))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_payout(account, U128(amount)),
            )
            .detach();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rent_cost_math() {
        let near: u128 = 10u128.pow(24);
        assert_eq!(rent_cost(near / 10, 3600), near / 10);
        assert_eq!(rent_cost(near / 10, 120), near / 300);
        assert_eq!(rent_cost(0, 120), 0);
    }

    #[test]
    fn pro_rata_refund_math() {
        // Returned exactly half way: half is unused, 5% of that is the fee.
        let (earned, refund) = early_return_split(1_000_000, 0, 1000, 500);
        assert_eq!(refund, 475_000);
        assert_eq!(earned, 525_000);
        // Returned immediately: everything but the fee comes back.
        assert_eq!(early_return_split(1_000_000, 0, 1000, 0), (50_000, 950_000));
        // Returned at the very end: nothing to refund.
        assert_eq!(early_return_split(1_000_000, 0, 1000, 1000), (1_000_000, 0));
    }

    #[test]
    fn split_math() {
        assert_eq!(revenue_split(1_000_000, 1000), (900_000, 100_000));
        assert_eq!(revenue_split(1_000_000, 0), (1_000_000, 0));
        let (o, c) = revenue_split(999, 250);
        assert_eq!(o + c, 999);
    }
}
