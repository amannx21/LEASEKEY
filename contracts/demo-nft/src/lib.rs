//! A plain NEP-171 collection standing in for "another game's items".
//! Anyone can claim an item for a small storage deposit, so the wrap flow can
//! be demoed: claim here, then wrap it into LeaseKey and rent it out.
use std::collections::HashMap;

use near_contract_standards::non_fungible_token::core::{NonFungibleTokenCore, NonFungibleTokenResolver};
use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
use near_contract_standards::non_fungible_token::metadata::{
    NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata, NFT_METADATA_SPEC,
};
use near_contract_standards::non_fungible_token::{NonFungibleToken, Token, TokenId};
use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, BorshStorageKey, PanicOnDefault, PromiseOrValue};

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Owners,
    Metadata,
    Enumeration,
    Approvals,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct DemoNft {
    tokens: NonFungibleToken,
    name: String,
    next_id: u64,
}

#[near]
impl DemoNft {
    #[init]
    pub fn new(name: String) -> Self {
        Self {
            tokens: NonFungibleToken::new(
                StorageKey::Owners,
                env::current_account_id(),
                Some(StorageKey::Metadata),
                Some(StorageKey::Enumeration),
                Some(StorageKey::Approvals),
            ),
            name,
            next_id: 1,
        }
    }

    /// Claim an item into the caller's inventory. Attach ~0.01 NEAR for storage.
    #[payable]
    pub fn claim(&mut self, title: String, media: Option<String>) -> Token {
        require!(!title.is_empty() && title.len() <= 48, "title must be 1..=48 chars");
        let id = self.next_id.to_string();
        self.next_id += 1;
        let metadata = TokenMetadata {
            title: Some(title),
            description: Some(format!("An item from {}", self.name)),
            media,
            media_hash: None,
            copies: Some(1),
            issued_at: Some(env::block_timestamp_ms().to_string()),
            expires_at: None,
            starts_at: None,
            updated_at: None,
            extra: None,
            reference: None,
            reference_hash: None,
        };
        self.tokens.internal_mint_with_refund(id, env::predecessor_account_id(), Some(metadata), None)
    }
}

#[near]
impl NonFungibleTokenCore for DemoNft {
    #[payable]
    fn nft_transfer(&mut self, receiver_id: AccountId, token_id: TokenId, approval_id: Option<u64>, memo: Option<String>) {
        self.tokens.nft_transfer(receiver_id, token_id, approval_id, memo)
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
        self.tokens.nft_transfer_call(receiver_id, token_id, approval_id, memo, msg)
    }

    fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        self.tokens.nft_token(token_id)
    }
}

#[near]
impl NonFungibleTokenResolver for DemoNft {
    #[private]
    fn nft_resolve_transfer(
        &mut self,
        previous_owner_id: AccountId,
        receiver_id: AccountId,
        token_id: TokenId,
        approved_account_ids: Option<HashMap<AccountId, u64>>,
    ) -> bool {
        self.tokens.nft_resolve_transfer(previous_owner_id, receiver_id, token_id, approved_account_ids)
    }
}

#[near]
impl NonFungibleTokenEnumeration for DemoNft {
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
impl NonFungibleTokenMetadataProvider for DemoNft {
    fn nft_metadata(&self) -> NFTContractMetadata {
        NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: self.name.clone(),
            symbol: "RELIC".to_string(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        }
    }
}
