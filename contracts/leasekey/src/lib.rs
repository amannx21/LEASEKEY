//! LeaseKey factory + NEP-171 NFT contract.
//!
//! Items come into LeaseKey in two ways, and each one gets its own NEAR account
//! (`<token-id>.<this contract>`) that runs the `item` contract and rents
//! itself out:
//!
//! * **Minted by a game.** Only registered games can mint. The game is the
//!   item's creator, earns the royalty, and is recorded on the item forever,
//!   so a copy minted by anyone else is visibly a different game's item.
//! * **Wrapped from any NEP-171 collection.** A player sends an NFT they own
//!   with `nft_transfer_call`. LeaseKey keeps it in escrow, creates a rentable
//!   item account backed by it, and gives the original back on `unwrap`.
//!
//! Item code is attached either as a shared global contract (by hash) or as
//! an embedded copy of the wasm.
use std::collections::HashMap;

use near_contract_standards::non_fungible_token::core::{
    NonFungibleTokenCore, NonFungibleTokenReceiver, NonFungibleTokenResolver,
};
use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
use near_contract_standards::non_fungible_token::metadata::{
    NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata, NFT_METADATA_SPEC,
};
use near_contract_standards::non_fungible_token::{NonFungibleToken, Token, TokenId};
use near_sdk::json_types::{Base58CryptoHash, U128, U64};
use near_sdk::serde_json::json;
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{
    assert_one_yocto, env, log, near, require, AccountId, BorshStorageKey, Gas, NearToken,
    PanicOnDefault, Promise, PromiseError, PromiseOrValue,
};

/// NEAR left on every item account for its own storage and gas float.
pub const ITEM_FLOAT: u128 = 150_000_000_000_000_000_000_000; // 0.15 NEAR
/// Kept by the factory per item to pay for NFT storage.
pub const NFT_STORAGE: u128 = 10_000_000_000_000_000_000_000; // 0.01 NEAR
/// Deposit to register a game (pays for its registry entry).
pub const GAME_DEPOSIT: u128 = 10_000_000_000_000_000_000_000; // 0.01 NEAR
/// Storage price: 1 NEAR per 100kb.
const YOCTO_PER_BYTE: u128 = 10_000_000_000_000_000_000;

const CODE_KEY: &[u8] = b"__item_code";
const INIT_GAS: Gas = Gas::from_tgas(15);
const MINT_CALLBACK_GAS: Gas = Gas::from_tgas(15);
const SET_OWNER_GAS: Gas = Gas::from_tgas(8);
const UNWRAP_GAS: Gas = Gas::from_tgas(10);
const NFT_TRANSFER_GAS: Gas = Gas::from_tgas(15);
const RELEASE_CALLBACK_GAS: Gas = Gas::from_tgas(10);

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Owners,
    TokenMetadata,
    Enumeration,
    Approvals,
    Games,
    ItemGame,
    Origins,
    WrapCredit,
    Stuck,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, PartialEq)]
pub enum ItemCode {
    Unset,
    /// Shared, immutable global contract referenced by code hash.
    Global(Base58CryptoHash),
    /// Wasm stored in this contract and copied to each item account.
    Embedded { bytes: u64 },
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Game {
    pub name: String,
    pub registered_at: U64,
}

/// Where a wrapped item came from.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Origin {
    pub contract: AccountId,
    pub token_id: TokenId,
}

#[near(serializers = [json])]
pub struct MintArgs {
    pub name: String,
    pub image: String,
    pub power: u32,
    pub price_per_hour: U128,
    pub max_secs: U64,
    pub royalty_bps: u16,
    /// The player who receives the item. Defaults to the caller.
    pub owner: Option<AccountId>,
    /// Admin only: mint on behalf of a registered game.
    pub creator: Option<AccountId>,
    pub max_durability: Option<u32>,
}

/// `msg` of `nft_transfer_call` when wrapping an NFT.
#[near(serializers = [json])]
pub struct WrapArgs {
    pub name: String,
    pub image: Option<String>,
    pub power: Option<u32>,
    pub price_per_hour: U128,
    pub max_secs: Option<U64>,
    /// Royalty paid to the origin collection on every rental. Default 0.
    pub royalty_bps: Option<u16>,
}

#[near(serializers = [json])]
pub struct ItemRef {
    pub token_id: TokenId,
    pub item_account: AccountId,
    pub owner: AccountId,
    /// The game that minted it, or the collection it was wrapped from.
    pub game: Option<AccountId>,
    pub game_name: Option<String>,
    pub origin: Option<Origin>,
}

#[near(serializers = [json])]
pub struct GameView {
    pub account_id: AccountId,
    pub name: String,
    pub registered_at: U64,
}

#[near(serializers = [json])]
pub struct Config {
    pub admin: AccountId,
    pub item_code: ItemCode,
    pub mint_deposit: U128,
    pub total_items: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct LeaseKey {
    tokens: NonFungibleToken,
    admin: AccountId,
    item_code: ItemCode,
    next_id: u64,
    games: IterableMap<AccountId, Game>,
    item_game: LookupMap<TokenId, AccountId>,
    origins: LookupMap<TokenId, Origin>,
    wrap_credit: LookupMap<AccountId, u128>,
    /// Originals whose return transfer failed; `retry_release` sends them again.
    stuck: LookupMap<TokenId, AccountId>,
}

/// Layout of the first deployed version, read once by `migrate`.
#[near(serializers = [borsh])]
struct LeaseKeyV1 {
    tokens: NonFungibleToken,
    admin: AccountId,
    item_code: ItemCode,
    next_id: u64,
}

fn slug(name: &str) -> String {
    let mut out = String::new();
    for c in name.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
        if out.len() >= 24 {
            break;
        }
    }
    let out = out.trim_end_matches('-').to_string();
    if out.is_empty() {
        "item".to_string()
    } else {
        out
    }
}

struct NewItem {
    name: String,
    image: String,
    power: u32,
    price_per_hour: U128,
    max_secs: U64,
    royalty_bps: u16,
    owner: AccountId,
    creator: AccountId,
    max_durability: u32,
    description: String,
}

#[near]
impl LeaseKey {
    #[init]
    pub fn new(admin: Option<AccountId>) -> Self {
        Self {
            tokens: NonFungibleToken::new(
                StorageKey::Owners,
                env::current_account_id(),
                Some(StorageKey::TokenMetadata),
                Some(StorageKey::Enumeration),
                Some(StorageKey::Approvals),
            ),
            admin: admin.unwrap_or_else(env::predecessor_account_id),
            item_code: ItemCode::Unset,
            next_id: 1,
            games: IterableMap::new(StorageKey::Games),
            item_game: LookupMap::new(StorageKey::ItemGame),
            origins: LookupMap::new(StorageKey::Origins),
            wrap_credit: LookupMap::new(StorageKey::WrapCredit),
            stuck: LookupMap::new(StorageKey::Stuck),
        }
    }

    /// Upgrades state from the first version. Existing items are credited to
    /// the game named `game_name`, registered under this contract's account.
    #[private]
    #[init(ignore_state)]
    pub fn migrate(game_name: String) -> Self {
        let old: LeaseKeyV1 = env::state_read().unwrap_or_else(|| env::panic_str("no state"));
        let me = env::current_account_id();
        let mut games = IterableMap::new(StorageKey::Games);
        games.insert(me.clone(), Game { name: game_name, registered_at: U64(env::block_timestamp_ms()) });
        let mut item_game = LookupMap::new(StorageKey::ItemGame);
        for (token_id, _) in old.tokens.owner_by_id.iter() {
            item_game.insert(token_id, me.clone());
        }
        Self {
            tokens: old.tokens,
            admin: old.admin,
            item_code: old.item_code,
            next_id: old.next_id,
            games,
            item_game,
            origins: LookupMap::new(StorageKey::Origins),
            wrap_credit: LookupMap::new(StorageKey::WrapCredit),
            stuck: LookupMap::new(StorageKey::Stuck),
        }
    }

    // ---------------------------------------------------------------- admin

    /// Publish the item wasm (raw bytes as input) as a global contract.
    #[payable]
    pub fn publish_item_code_global(&mut self) -> Promise {
        self.assert_admin();
        let code = env::input().unwrap_or_default();
        require!(code.len() > 1000, "pass the item wasm as raw input");
        let hash = env::sha256_array(&code);
        self.item_code = ItemCode::Global(Base58CryptoHash::from(hash));
        Promise::new(env::current_account_id()).deploy_global_contract(code)
    }

    /// Point at an already published global contract hash.
    pub fn set_item_code_global(&mut self, code_hash: Base58CryptoHash) {
        self.assert_admin();
        self.item_code = ItemCode::Global(code_hash);
    }

    /// Store the item wasm (raw bytes as input) here; every mint deploys a copy.
    #[payable]
    pub fn store_item_code(&mut self) {
        self.assert_admin();
        let code = env::input().unwrap_or_default();
        require!(code.len() > 1000, "pass the item wasm as raw input");
        env::storage_write(CODE_KEY, &code);
        self.item_code = ItemCode::Embedded { bytes: code.len() as u64 };
    }

    // ---------------------------------------------------------------- games

    /// Registers the caller's account as a game studio. Only games can mint.
    #[payable]
    pub fn register_game(&mut self, name: String) -> GameView {
        require!(env::attached_deposit().as_yoctonear() >= GAME_DEPOSIT, "attach 0.01 NEAR to register");
        let name = name.trim().to_string();
        require!(!name.is_empty() && name.len() <= 40, "name must be 1..=40 chars");
        let id = env::predecessor_account_id();
        let game = Game { name, registered_at: U64(env::block_timestamp_ms()) };
        self.games.insert(id.clone(), game.clone());
        log!(
            r#"EVENT_JSON:{{"standard":"leasekey","version":"1.0.0","event":"game_registered","data":{{"game":"{}"}}}}"#,
            id
        );
        GameView { account_id: id, name: game.name, registered_at: game.registered_at }
    }

    pub fn get_games(&self) -> Vec<GameView> {
        self.games
            .iter()
            .map(|(id, g)| GameView { account_id: id.clone(), name: g.name.clone(), registered_at: g.registered_at })
            .collect()
    }

    pub fn get_game(&self, account_id: AccountId) -> Option<GameView> {
        self.games
            .get(&account_id)
            .map(|g| GameView { account_id, name: g.name.clone(), registered_at: g.registered_at })
    }

    // ----------------------------------------------------------------- mint

    /// Deposit needed to create one item in the current mode.
    pub fn mint_deposit(&self) -> U128 {
        let code = match &self.item_code {
            ItemCode::Embedded { bytes } => *bytes as u128 * YOCTO_PER_BYTE,
            _ => 0,
        };
        U128(ITEM_FLOAT + NFT_STORAGE + code)
    }

    /// A registered game mints an item to a player. The game is the creator:
    /// it earns the royalty and is recorded on the item.
    #[payable]
    pub fn mint(&mut self, args: MintArgs) -> Promise {
        let caller = env::predecessor_account_id();
        let creator = match args.creator.clone() {
            Some(c) if caller == self.admin => c,
            Some(_) => env::panic_str("only the admin can mint on behalf of another game"),
            None => caller.clone(),
        };
        require!(self.games.contains_key(&creator), "only registered games can mint items");
        let deposit = env::attached_deposit().as_yoctonear();
        let required = self.mint_deposit().0;
        require!(deposit >= required, format!("attach at least {required} yoctoNEAR"));
        require!(args.image.len() <= 256, "image too long");
        let item = NewItem {
            name: args.name,
            image: args.image,
            power: args.power,
            price_per_hour: args.price_per_hour,
            max_secs: args.max_secs,
            royalty_bps: args.royalty_bps,
            owner: args.owner.unwrap_or(caller),
            creator,
            max_durability: args.max_durability.unwrap_or(1000),
            description: "A LeaseKey item that rents itself out.".to_string(),
        };
        self.create_item(item, deposit, deposit, None, None)
    }

    /// Mints the NFT only if the item account was created and initialised.
    /// Otherwise the deposit goes back to `payer`.
    #[private]
    pub fn on_item_created(
        &mut self,
        token_id: TokenId,
        owner: AccountId,
        game: AccountId,
        metadata: TokenMetadata,
        deposit: U128,
        payer: AccountId,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> Option<ItemRef> {
        if result.is_err() {
            Promise::new(payer).transfer(NearToken::from_yoctonear(deposit.0)).detach();
            return None;
        }
        self.tokens.internal_mint_with_refund(token_id.clone(), owner, Some(metadata), None);
        self.item_game.insert(token_id.clone(), game);
        Some(self.item_ref(token_id))
    }

    // ----------------------------------------------------------------- wrap

    /// Prepay the deposit for wrapping an NFT (an NFT transfer carries no NEAR).
    #[payable]
    pub fn deposit_for_wrap(&mut self) -> U128 {
        let who = env::predecessor_account_id();
        let credit = self.wrap_credit.get(&who).copied().unwrap_or(0) + env::attached_deposit().as_yoctonear();
        self.wrap_credit.insert(who, credit);
        U128(credit)
    }

    pub fn get_wrap_credit(&self, account_id: AccountId) -> U128 {
        U128(self.wrap_credit.get(&account_id).copied().unwrap_or(0))
    }

    /// Withdraw unused wrap credit.
    pub fn withdraw_wrap_credit(&mut self) -> Promise {
        let who = env::predecessor_account_id();
        let credit = self.wrap_credit.remove(&who).unwrap_or(0);
        require!(credit > 0, "no wrap credit");
        Promise::new(who).transfer(NearToken::from_yoctonear(credit))
    }

    /// Wrapped item finished (or failed) creation. Returns whether the NFT
    /// should go back to its owner, as NEP-171 `nft_on_transfer` expects.
    #[private]
    pub fn on_wrap_created(
        &mut self,
        token_id: TokenId,
        owner: AccountId,
        origin: Origin,
        metadata: TokenMetadata,
        deposit: U128,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> bool {
        if result.is_err() {
            let credit = self.wrap_credit.get(&owner).copied().unwrap_or(0) + deposit.0;
            self.wrap_credit.insert(owner, credit);
            return true; // return the NFT
        }
        self.tokens.internal_mint_with_refund(token_id.clone(), owner.clone(), Some(metadata), None);
        self.item_game.insert(token_id.clone(), origin.contract.clone());
        log!(
            r#"EVENT_JSON:{{"standard":"leasekey","version":"1.0.0","event":"item_wrapped","data":{{"token_id":"{}","owner":"{}","origin_contract":"{}","origin_token_id":"{}"}}}}"#,
            token_id, owner, origin.contract, origin.token_id
        );
        self.origins.insert(token_id, origin);
        false // keep it in escrow
    }

    /// Give the original NFT back. Fails while the item is on lease: the
    /// owner cannot pull an item out from under a renter.
    #[payable]
    pub fn unwrap(&mut self, token_id: TokenId) -> Promise {
        assert_one_yocto();
        let owner = self.tokens.owner_by_id.get(&token_id).unwrap_or_else(|| env::panic_str("no such token"));
        require!(env::predecessor_account_id() == owner, "only the owner can unwrap");
        require!(self.origins.contains_key(&token_id), "this item was minted by a game, not wrapped");
        let me = env::current_account_id();
        // Both actions run in one receipt: if `unlist` fails (item on lease)
        // the ownership change is rolled back too.
        Promise::new(self.item_account(token_id.clone()))
            .function_call("set_owner".to_string(), json!({ "owner": me }).to_string().into_bytes(), NearToken::from_yoctonear(0), SET_OWNER_GAS)
            .function_call("unlist".to_string(), b"{}".to_vec(), NearToken::from_yoctonear(0), SET_OWNER_GAS)
            .then(Self::ext(me).with_static_gas(UNWRAP_GAS.saturating_add(NFT_TRANSFER_GAS).saturating_add(RELEASE_CALLBACK_GAS)).on_unwrap(token_id, owner))
    }

    #[private]
    pub fn on_unwrap(&mut self, token_id: TokenId, owner: AccountId, #[callback_result] result: Result<(), PromiseError>) {
        if result.is_err() {
            env::panic_str("cannot unwrap while the item is on lease, or before its lease is settled");
        }
        let me = env::current_account_id();
        // Retire the LeaseKey token: it now belongs to the factory and is hidden.
        self.tokens.internal_transfer_unguarded(&token_id, &owner, &me);
        let origin = self.origins.remove(&token_id).unwrap_or_else(|| env::panic_str("origin missing"));
        self.release(origin, token_id, owner);
    }

    #[private]
    pub fn on_release(&mut self, token_id: TokenId, owner: AccountId, origin: Origin, #[callback_result] result: Result<(), PromiseError>) {
        if result.is_err() {
            self.stuck.insert(token_id.clone(), owner);
            self.origins.insert(token_id, origin);
        }
    }

    /// Retry sending back an original whose return transfer failed.
    pub fn retry_release(&mut self, token_id: TokenId) {
        let owner = self.stuck.remove(&token_id).unwrap_or_else(|| env::panic_str("nothing to release"));
        let origin = self.origins.remove(&token_id).unwrap_or_else(|| env::panic_str("origin missing"));
        self.release(origin, token_id, owner);
    }

    /// Push the current NFT owner to the item account. Anyone may call it.
    pub fn sync_owner(&mut self, token_id: TokenId) -> Promise {
        let owner = self.tokens.owner_by_id.get(&token_id).unwrap_or_else(|| env::panic_str("no such token"));
        require!(owner != env::current_account_id(), "item is retired");
        Promise::new(self.item_account(token_id)).function_call(
            "set_owner".to_string(),
            json!({ "owner": owner }).to_string().into_bytes(),
            NearToken::from_yoctonear(0),
            SET_OWNER_GAS,
        )
    }

    // ---------------------------------------------------------------- views

    pub fn item_account(&self, token_id: TokenId) -> AccountId {
        format!("{token_id}.{}", env::current_account_id()).parse().unwrap()
    }

    /// Listing index: every live item with its account, owner, game and origin.
    pub fn get_items(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<ItemRef> {
        let me = env::current_account_id();
        self.tokens
            .nft_tokens(from_index, limit)
            .into_iter()
            .filter(|t| t.owner_id != me)
            .map(|t| self.item_ref(t.token_id))
            .collect()
    }

    pub fn get_item_ref(&self, token_id: TokenId) -> Option<ItemRef> {
        self.tokens.owner_by_id.get(&token_id).map(|_| self.item_ref(token_id))
    }

    /// Which LeaseKey item, if any, wraps a given NFT from another collection.
    /// Games use this to honour renters of their own NFTs.
    pub fn find_wrapped(&self, origin_contract: AccountId, origin_token_id: TokenId, from_index: Option<U128>, limit: Option<u64>) -> Option<ItemRef> {
        self.get_items(from_index, limit)
            .into_iter()
            .find(|r| r.origin.as_ref().is_some_and(|o| o.contract == origin_contract && o.token_id == origin_token_id))
    }

    pub fn get_config(&self) -> Config {
        Config {
            admin: self.admin.clone(),
            item_code: self.item_code.clone(),
            mint_deposit: self.mint_deposit(),
            total_items: self.next_id - 1,
        }
    }
}

impl LeaseKey {
    fn assert_admin(&self) {
        require!(env::predecessor_account_id() == self.admin, "only the admin");
    }

    fn item_ref(&self, token_id: TokenId) -> ItemRef {
        let game = self.item_game.get(&token_id).cloned();
        let game_name = game.as_ref().and_then(|g| self.games.get(g)).map(|g| g.name.clone());
        ItemRef {
            item_account: self.item_account(token_id.clone()),
            owner: self.tokens.owner_by_id.get(&token_id).unwrap_or_else(|| env::current_account_id()),
            origin: self.origins.get(&token_id).cloned(),
            game,
            game_name,
            token_id,
        }
    }

    fn release(&mut self, origin: Origin, token_id: TokenId, owner: AccountId) {
        Promise::new(origin.contract.clone())
            .function_call(
                "nft_transfer".to_string(),
                json!({ "receiver_id": owner, "token_id": origin.token_id, "memo": "unwrapped from LeaseKey" }).to_string().into_bytes(),
                NearToken::from_yoctonear(1),
                NFT_TRANSFER_GAS,
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(RELEASE_CALLBACK_GAS).on_release(token_id, owner, origin))
            .detach();
    }

    /// Creates `<token-id>.<this contract>`, attaches item code, initialises it,
    /// then calls back to mint the NFT (or to finish a wrap).
    fn create_item(&mut self, it: NewItem, deposit: u128, refund: u128, origin: Option<Origin>, payer: Option<AccountId>) -> Promise {
        require!(!it.name.is_empty() && it.name.len() <= 48, "name must be 1..=48 chars");
        let token_id = format!("{}-{}", slug(&it.name), self.next_id);
        self.next_id += 1;
        let item_account: AccountId = format!("{token_id}.{}", env::current_account_id()).parse().unwrap();
        let init = json!({ "init": {
            "token_id": token_id,
            "owner": it.owner,
            "creator": it.creator,
            "royalty_bps": it.royalty_bps,
            "name": it.name,
            "image": it.image,
            "power": it.power,
            "price_per_hour": it.price_per_hour,
            "max_secs": it.max_secs,
            "max_durability": it.max_durability,
        }})
        .to_string()
        .into_bytes();

        let create = Promise::new(item_account)
            .create_account()
            .transfer(NearToken::from_yoctonear(deposit - NFT_STORAGE));
        let with_code = match &self.item_code {
            ItemCode::Global(hash) => create.use_global_contract(<[u8; 32]>::from(*hash)),
            ItemCode::Embedded { .. } => create.deploy_contract(
                env::storage_read(CODE_KEY).unwrap_or_else(|| env::panic_str("item code missing")),
            ),
            ItemCode::Unset => env::panic_str("item code is not configured yet"),
        };
        let metadata = TokenMetadata {
            title: Some(it.name),
            description: Some(it.description),
            media: Some(it.image),
            media_hash: None,
            copies: Some(1),
            issued_at: Some(env::block_timestamp_ms().to_string()),
            expires_at: None,
            starts_at: None,
            updated_at: None,
            extra: Some(json!({ "power": it.power, "creator": it.creator }).to_string()),
            reference: None,
            reference_hash: None,
        };
        let created = with_code.function_call("new".to_string(), init, NearToken::from_yoctonear(0), INIT_GAS);
        let me = Self::ext(env::current_account_id()).with_static_gas(MINT_CALLBACK_GAS);
        match origin {
            Some(origin) => created.then(me.on_wrap_created(token_id, it.owner, origin, metadata, U128(refund))),
            None => created.then(me.on_item_created(
                token_id,
                it.owner,
                it.creator,
                metadata,
                U128(refund),
                payer.unwrap_or_else(env::predecessor_account_id),
            )),
        }
    }
}

// ------------------------------------------------- NEP-171 receiver (wrapping)

#[near]
impl NonFungibleTokenReceiver for LeaseKey {
    /// Receives an NFT from any NEP-171 collection and wraps it. `msg` is a
    /// JSON `WrapArgs`. Returns `true` (send the NFT back) if anything is off.
    fn nft_on_transfer(
        &mut self,
        sender_id: AccountId,
        previous_owner_id: AccountId,
        token_id: TokenId,
        msg: String,
    ) -> PromiseOrValue<bool> {
        let _ = sender_id;
        let origin_contract = env::predecessor_account_id();
        if origin_contract == env::current_account_id() {
            log!("LeaseKey items cannot be wrapped again");
            return PromiseOrValue::Value(true);
        }
        let args: WrapArgs = match near_sdk::serde_json::from_str(&msg) {
            Ok(a) => a,
            Err(_) => {
                log!("msg must be WrapArgs JSON");
                return PromiseOrValue::Value(true);
            }
        };
        if args.name.is_empty() || args.name.len() > 48 || args.image.as_ref().is_some_and(|i| i.len() > 256) {
            log!("bad name or image");
            return PromiseOrValue::Value(true);
        }
        let required = self.mint_deposit().0;
        let credit = self.wrap_credit.get(&previous_owner_id).copied().unwrap_or(0);
        if credit < required {
            log!("call deposit_for_wrap with {} yoctoNEAR first", required);
            return PromiseOrValue::Value(true);
        }
        if credit == required {
            self.wrap_credit.remove(&previous_owner_id);
        } else {
            self.wrap_credit.insert(previous_owner_id.clone(), credit - required);
        }
        let item = NewItem {
            name: args.name,
            image: args.image.unwrap_or_default(),
            power: args.power.unwrap_or(25),
            price_per_hour: args.price_per_hour,
            max_secs: args.max_secs.unwrap_or(U64(7200)),
            royalty_bps: args.royalty_bps.unwrap_or(0),
            owner: previous_owner_id,
            creator: origin_contract.clone(),
            max_durability: 1000,
            description: format!("Wrapped from {origin_contract} #{token_id}. Rentable on LeaseKey."),
        };
        let origin = Origin { contract: origin_contract, token_id };
        PromiseOrValue::Promise(self.create_item(item, required, required, Some(origin), None))
    }
}

// ------------------------------------------------------------------ NEP-171
// Transfers are allowed at any time. They never touch the rental: the item
// account keeps the renter's key and the escrowed rent, and the new owner
// simply inherits the lease. There is no burn method.

#[near]
impl NonFungibleTokenCore for LeaseKey {
    #[payable]
    fn nft_transfer(&mut self, receiver_id: AccountId, token_id: TokenId, approval_id: Option<u64>, memo: Option<String>) {
        require!(receiver_id != env::current_account_id(), "cannot transfer to the factory");
        self.tokens.nft_transfer(receiver_id, token_id.clone(), approval_id, memo);
        self.sync_owner(token_id).detach();
    }

    #[payable]
    fn nft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<bool> {
        require!(receiver_id != env::current_account_id(), "cannot transfer to the factory");
        let result = self.tokens.nft_transfer_call(receiver_id, token_id.clone(), approval_id, memo, msg);
        self.sync_owner(token_id).detach();
        result
    }

    fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        self.tokens.nft_token(token_id)
    }
}

#[near]
impl NonFungibleTokenResolver for LeaseKey {
    #[private]
    fn nft_resolve_transfer(
        &mut self,
        previous_owner_id: AccountId,
        receiver_id: AccountId,
        token_id: TokenId,
        approved_account_ids: Option<HashMap<AccountId, u64>>,
    ) -> bool {
        let kept = self.tokens.nft_resolve_transfer(previous_owner_id, receiver_id, token_id.clone(), approved_account_ids);
        // The transfer may have been rolled back: push the final owner again.
        self.sync_owner(token_id).detach();
        kept
    }
}

#[near]
impl NonFungibleTokenEnumeration for LeaseKey {
    fn nft_total_supply(&self) -> U128 {
        self.tokens.nft_total_supply()
    }

    fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.tokens.nft_tokens(from_index, limit)
    }

    fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        self.tokens.nft_supply_for_owner(account_id)
    }

    fn nft_tokens_for_owner(&self, account_id: AccountId, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.tokens.nft_tokens_for_owner(account_id, from_index, limit)
    }
}

#[near]
impl NonFungibleTokenMetadataProvider for LeaseKey {
    fn nft_metadata(&self) -> NFTContractMetadata {
        NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: "LeaseKey Items".to_string(),
            symbol: "LEASE".to_string(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::slug;

    #[test]
    fn slug_makes_valid_account_prefix() {
        assert_eq!(slug("Flame Sword"), "flame-sword");
        assert_eq!(slug("  Ice!! Bow  "), "ice-bow");
        assert_eq!(slug("???"), "item");
        assert!(slug("An Extremely Long Legendary Item Name Of Doom").len() <= 24);
    }
}
