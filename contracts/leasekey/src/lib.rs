//! LeaseKey factory + NEP-171 NFT contract.
//!
//! `mint` creates the NFT and a sub-account `<token-id>.<this contract>` that
//! runs the `item` contract. The item account has no full-access key, so only
//! its code (and through it the NFT owner) controls it.
//!
//! Item code can be attached in two ways:
//! * Global   - the item wasm is published once as a NEAR global contract and
//!              every item account references the same immutable code hash.
//! * Embedded - the wasm is stored here and deployed to every item account.
use std::collections::HashMap;

use near_contract_standards::non_fungible_token::core::{
    NonFungibleTokenCore, NonFungibleTokenResolver,
};
use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
use near_contract_standards::non_fungible_token::metadata::{
    NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata, NFT_METADATA_SPEC,
};
use near_contract_standards::non_fungible_token::{NonFungibleToken, Token, TokenId};
use near_sdk::json_types::{Base58CryptoHash, U128, U64};
use near_sdk::serde_json::json;
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
    PromiseError, PromiseOrValue,
};

/// NEAR left on every item account for its own storage and gas float.
pub const ITEM_FLOAT: u128 = 150_000_000_000_000_000_000_000; // 0.15 NEAR
/// Kept by the factory per mint to pay for NFT storage.
pub const NFT_STORAGE: u128 = 10_000_000_000_000_000_000_000; // 0.01 NEAR
/// Storage price: 1 NEAR per 100kb.
const YOCTO_PER_BYTE: u128 = 10_000_000_000_000_000_000;

const CODE_KEY: &[u8] = b"__item_code";
const INIT_GAS: Gas = Gas::from_tgas(15);
const MINT_CALLBACK_GAS: Gas = Gas::from_tgas(15);
const SET_OWNER_GAS: Gas = Gas::from_tgas(8);

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Owners,
    TokenMetadata,
    Enumeration,
    Approvals,
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

#[near(serializers = [json])]
pub struct MintArgs {
    pub name: String,
    pub image: String,
    pub power: u32,
    pub price_per_hour: U128,
    pub max_secs: U64,
    pub royalty_bps: u16,
    /// Game creator who receives the royalty. Defaults to the minter.
    pub creator: Option<AccountId>,
    pub max_durability: Option<u32>,
}

#[near(serializers = [json])]
pub struct ItemRef {
    pub token_id: TokenId,
    pub item_account: AccountId,
    pub owner: AccountId,
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
        }
    }

    // ---------------------------------------------------------------- admin

    /// Publish the item wasm (raw bytes as input) as a global contract.
    /// The attached deposit pays the publishing cost, which the protocol burns.
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

    // ----------------------------------------------------------------- mint

    /// Deposit needed for one mint in the current mode.
    pub fn mint_deposit(&self) -> U128 {
        let code = match &self.item_code {
            ItemCode::Embedded { bytes } => *bytes as u128 * YOCTO_PER_BYTE,
            _ => 0,
        };
        U128(ITEM_FLOAT + NFT_STORAGE + code)
    }

    /// Mint an item: creates `<token-id>.<this contract>`, attaches the item
    /// code, initialises it, then mints the NEP-171 token to the caller.
    #[payable]
    pub fn mint(&mut self, args: MintArgs) -> Promise {
        let deposit = env::attached_deposit().as_yoctonear();
        let required = self.mint_deposit().0;
        require!(deposit >= required, format!("attach at least {required} yoctoNEAR"));
        require!(!args.name.is_empty() && args.name.len() <= 48, "name must be 1..=48 chars");
        require!(args.image.len() <= 256, "image too long");

        let owner = env::predecessor_account_id();
        let token_id = format!("{}-{}", slug(&args.name), self.next_id);
        self.next_id += 1;
        let item_account: AccountId =
            format!("{token_id}.{}", env::current_account_id()).parse().unwrap();
        let creator = args.creator.clone().unwrap_or_else(|| owner.clone());
        let max_durability = args.max_durability.unwrap_or(1000);

        let init = json!({ "init": {
            "token_id": token_id,
            "owner": owner,
            "creator": creator,
            "royalty_bps": args.royalty_bps,
            "name": args.name,
            "image": args.image,
            "power": args.power,
            "price_per_hour": args.price_per_hour,
            "max_secs": args.max_secs,
            "max_durability": max_durability,
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
            title: Some(args.name),
            description: Some("A LeaseKey item that rents itself out.".to_string()),
            media: Some(args.image),
            media_hash: None,
            copies: Some(1),
            issued_at: Some(env::block_timestamp_ms().to_string()),
            expires_at: None,
            starts_at: None,
            updated_at: None,
            extra: Some(json!({ "power": args.power, "creator": creator }).to_string()),
            reference: None,
            reference_hash: None,
        };
        with_code
            .function_call("new".to_string(), init, NearToken::from_yoctonear(0), INIT_GAS)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(MINT_CALLBACK_GAS)
                    .on_item_created(token_id, owner, metadata, U128(deposit)),
            )
    }

    /// Mints the NFT only if the item account was created and initialised.
    /// Otherwise the whole deposit goes back to the minter.
    #[private]
    pub fn on_item_created(
        &mut self,
        token_id: TokenId,
        owner: AccountId,
        metadata: TokenMetadata,
        deposit: U128,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> Option<ItemRef> {
        if result.is_err() {
            Promise::new(owner).transfer(NearToken::from_yoctonear(deposit.0)).detach();
            return None;
        }
        self.tokens.internal_mint_with_refund(token_id.clone(), owner.clone(), Some(metadata), None);
        Some(ItemRef { item_account: self.item_account(token_id.clone()), token_id, owner })
    }

    /// Push the current NFT owner to the item account. Anyone may call it.
    pub fn sync_owner(&mut self, token_id: TokenId) -> Promise {
        let owner = self
            .tokens
            .owner_by_id
            .get(&token_id)
            .unwrap_or_else(|| env::panic_str("no such token"));
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

    /// Listing index: every item with its account and owner.
    pub fn get_items(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<ItemRef> {
        self.tokens
            .nft_tokens(from_index, limit)
            .into_iter()
            .map(|t| ItemRef {
                item_account: self.item_account(t.token_id.clone()),
                token_id: t.token_id,
                owner: t.owner_id,
            })
            .collect()
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
}

// ------------------------------------------------------------------ NEP-171
// Transfers are allowed at any time. They never touch the rental: the item
// account keeps the renter's key and the escrowed rent, and the new owner
// simply inherits the lease. There is no burn method.

#[near]
impl NonFungibleTokenCore for LeaseKey {
    #[payable]
    fn nft_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
    ) {
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
        let result =
            self.tokens.nft_transfer_call(receiver_id, token_id.clone(), approval_id, memo, msg);
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
        let kept = self.tokens.nft_resolve_transfer(
            previous_owner_id,
            receiver_id,
            token_id.clone(),
            approved_account_ids,
        );
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

    fn nft_tokens_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<U128>,
        limit: Option<u64>,
    ) -> Vec<Token> {
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
