//! Sandbox tests for every P0 rule of LeaseKey.
//! Run `bash scripts/build.sh` first so `res/item.wasm` and `res/leasekey.wasm` exist.
use near_workspaces::network::Sandbox;
use near_workspaces::types::{KeyType, NearToken, SecretKey};
use near_workspaces::{Account, AccountId, Contract, Worker};
use serde_json::{json, Value};

const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const PRICE_PER_HOUR: u128 = NEAR; // 1 NEAR per hour keeps the math readable
const GAS_BUDGET: u128 = NEAR / 20; // 0.05 NEAR
const USE_FEE: u128 = NEAR / 2000;
const ROYALTY_BPS: u128 = 1000; // 10%

fn wasm(name: &str) -> Vec<u8> {
    let path = format!("{}/../res/{name}.wasm", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&path).unwrap_or_else(|_| panic!("{path} missing: run scripts/build.sh"))
}

struct Ctx {
    worker: Worker<Sandbox>,
    factory: Contract,
    owner: Account,
    creator: Account,
    renter: Account,
    item: AccountId,
    token_id: String,
}

#[derive(Clone, Copy, PartialEq)]
enum Mode {
    Embedded,
    Global,
}

async fn setup(mode: Mode) -> anyhow::Result<Ctx> {
    let worker = near_workspaces::sandbox().await?;
    let factory = worker.dev_deploy(&wasm("leasekey")).await?;
    factory.call("new").args_json(json!({})).transact().await?.into_result()?;

    let (method, deposit) = match mode {
        Mode::Embedded => ("store_item_code", 3 * NEAR),
        Mode::Global => ("publish_item_code_global", 30 * NEAR),
    };
    factory
        .call(method)
        .args(wasm("item"))
        .deposit(NearToken::from_yoctonear(deposit))
        .max_gas()
        .transact()
        .await?
        .into_result()?;

    let owner = worker.dev_create_account().await?;
    let creator = worker.dev_create_account().await?;
    let renter = worker.dev_create_account().await?;

    let mint_deposit: String = factory.view("mint_deposit").await?.json()?;
    let minted: Value = owner
        .call(factory.id(), "mint")
        .args_json(json!({ "args": {
            "name": "Flame Sword",
            "image": "flame-sword.svg",
            "power": 40,
            "price_per_hour": PRICE_PER_HOUR.to_string(),
            "max_secs": "7200",
            "royalty_bps": ROYALTY_BPS,
            "creator": creator.id(),
        }}))
        .deposit(NearToken::from_yoctonear(mint_deposit.parse()?))
        .max_gas()
        .transact()
        .await?
        .json()?;
    let token_id = minted["token_id"].as_str().expect("mint returned no item").to_string();
    let item: AccountId = minted["item_account"].as_str().unwrap().parse()?;

    owner.call(&item, "list").args_json(json!({})).transact().await?.into_result()?;
    Ok(Ctx { worker, factory, owner, creator, renter, item, token_id })
}

impl Ctx {
    async fn view(&self) -> anyhow::Result<Value> {
        Ok(self.worker.view(&self.item, "get_item").await?.json()?)
    }

    /// Balance after pending gas refunds from earlier calls have landed.
    async fn balance(&self, id: &AccountId) -> anyhow::Result<u128> {
        self.worker.fast_forward(3).await?;
        Ok(self.worker.view_account(id).await?.balance.as_yoctonear())
    }

    /// Rents for `secs` and returns the renter's session key, wrapped as an
    /// `Account` that signs AS the item account.
    async fn rent(&self, secs: u64) -> anyhow::Result<(Account, SecretKey)> {
        let sk = SecretKey::from_random(KeyType::ED25519);
        let cost = PRICE_PER_HOUR * secs as u128 / 3600;
        self.renter
            .call(&self.item, "rent")
            .args_json(json!({ "public_key": sk.public_key(), "duration_secs": secs.to_string() }))
            .deposit(NearToken::from_yoctonear(cost + GAS_BUDGET))
            .max_gas()
            .transact()
            .await?
            .into_result()?;
        Ok((Account::from_secret_key(self.item.clone(), sk.clone(), &self.worker), sk))
    }

    async fn use_item(&self, session: &Account) -> anyhow::Result<Value> {
        Ok(session
            .call(&self.item, "use_item")
            .args_json(json!({ "action": "attack" }))
            .transact()
            .await?
            .into_result()?
            .json()?)
    }

    /// Advances sandbox time until the current rental has expired.
    async fn expire(&self) -> anyhow::Result<()> {
        for _ in 0..40 {
            let v = self.view().await?;
            let now: u64 = v["now_ms"].as_str().unwrap().parse()?;
            let ends: u64 = v["ends_at"].as_str().unwrap().parse()?;
            if now >= ends {
                return Ok(());
            }
            self.worker.fast_forward(100).await?;
        }
        anyhow::bail!("rental never expired")
    }

    async fn has_key(&self, sk: &SecretKey) -> bool {
        self.worker.view_access_key(&self.item, &sk.public_key()).await.is_ok()
    }
}

fn err_text<T: std::fmt::Debug>(r: &T) -> String {
    format!("{r:?}")
}

#[tokio::test]
async fn mint_creates_item_account_and_nft() -> anyhow::Result<()> {
    let c = setup(Mode::Embedded).await?;
    let v = c.view().await?;
    assert_eq!(v["owner"], json!(c.owner.id()));
    assert_eq!(v["creator"], json!(c.creator.id()));
    assert_eq!(v["name"], "Flame Sword");
    assert_eq!(v["listed"], true);
    assert_eq!(v["renter"], Value::Null);
    assert_eq!(v["durability"], 1000);
    assert_eq!(v["rental_count"], 0);
    // The item is its own account, a sub-account of the factory.
    assert_eq!(c.item.as_str(), format!("{}.{}", c.token_id, c.factory.id()));
    // The NEP-171 token belongs to the minter.
    let token: Value =
        c.factory.view("nft_token").args_json(json!({ "token_id": c.token_id })).await?.json()?;
    assert_eq!(token["owner_id"], json!(c.owner.id()));
    let items: Value = c.factory.view("get_items").args_json(json!({})).await?.json()?;
    assert_eq!(items.as_array().unwrap().len(), 1);
    Ok(())
}

#[tokio::test]
async fn rent_adds_restricted_session_key_and_use_item_works() -> anyhow::Result<()> {
    let c = setup(Mode::Embedded).await?;
    let (session, sk) = c.rent(120).await?;

    let key = c.worker.view_access_key(&c.item, &sk.public_key()).await?;
    let perm = format!("{:?}", key.permission);
    assert!(perm.contains("FunctionCall"), "{perm}");
    assert!(perm.contains("use_item"), "{perm}");
    assert!(perm.contains(c.item.as_str()), "{perm}");
    assert!(!perm.contains("FullAccess"), "{perm}");

    let out = session
        .call(&c.item, "use_item")
        .args_json(json!({ "action": "attack" }))
        .transact()
        .await?;
    // The item account pays this gas. USE_FEE must cover it at testnet's gas price.
    let burnt = out.total_gas_burnt.as_gas() as u128;
    let cost_on_testnet = burnt * 100_000_000;
    println!("use_item burnt {burnt} gas = {cost_on_testnet} yoctoNEAR at testnet gas price");
    assert!(cost_on_testnet < USE_FEE, "USE_FEE does not cover gas: {cost_on_testnet}");
    let used: Value = out.json()?;
    assert_eq!(used["power"], 40);
    assert_eq!(used["uses"], 1);
    assert_eq!(used["durability"], 999);

    let v = c.view().await?;
    assert_eq!(v["renter"], json!(c.renter.id()));
    assert_eq!(v["rental_active"], true);
    assert_eq!(v["uses"], 1);
    // The NFT did not move.
    assert_eq!(v["owner"], json!(c.owner.id()));
    Ok(())
}

#[tokio::test]
async fn renter_cannot_transfer_sell_or_withdraw() -> anyhow::Result<()> {
    let c = setup(Mode::Embedded).await?;
    let (session, _) = c.rent(120).await?;
    let thief = c.worker.dev_create_account().await?;

    // Session key cannot call the NFT contract at all (wrong receiver).
    let r = session
        .call(c.factory.id(), "nft_transfer")
        .args_json(json!({ "receiver_id": thief.id(), "token_id": c.token_id }))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await;
    assert!(r.is_err() || r.unwrap().is_failure(), "session key reached nft_transfer");

    // Session key cannot call any other method on the item account.
    for method in ["unlist", "end_rental", "return_early", "claim", "set_owner", "list"] {
        let r = session
            .call(&c.item, method)
            .args_json(json!({ "owner": thief.id() }))
            .transact()
            .await;
        assert!(r.is_err() || r.unwrap().is_failure(), "session key could call {method}");
    }

    // Session key cannot move NEAR out of the item account.
    let r = session.transfer_near(thief.id(), NearToken::from_millinear(10)).await;
    assert!(r.is_err() || r.unwrap().is_failure(), "session key could transfer NEAR");

    // The renter's own wallet cannot transfer the NFT either: it never owned it.
    let r = c
        .renter
        .call(c.factory.id(), "nft_transfer")
        .args_json(json!({ "receiver_id": thief.id(), "token_id": c.token_id }))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?;
    assert!(r.is_failure());

    let token: Value =
        c.factory.view("nft_token").args_json(json!({ "token_id": c.token_id })).await?.json()?;
    assert_eq!(token["owner_id"], json!(c.owner.id()));
    assert_eq!(c.view().await?["owner"], json!(c.owner.id()));
    Ok(())
}

#[tokio::test]
async fn use_item_rejects_strangers_and_wrong_keys() -> anyhow::Result<()> {
    let c = setup(Mode::Embedded).await?;
    let (_session, _) = c.rent(120).await?;

    // A normal account calling use_item directly is rejected by the contract.
    let stranger = c.worker.dev_create_account().await?;
    let r = stranger.call(&c.item, "use_item").args_json(json!({ "action": "attack" })).transact().await?;
    assert!(r.is_failure());
    assert!(err_text(&r).contains("renter session key"), "{}", err_text(&r));
    // Even the renter's wallet account cannot: only the session key plays.
    let r = c.renter.call(&c.item, "use_item").args_json(json!({ "action": "attack" })).transact().await?;
    assert!(r.is_failure());

    // A key that was never added to the item account cannot sign for it.
    let fake = Account::from_secret_key(
        c.item.clone(),
        SecretKey::from_random(KeyType::ED25519),
        &c.worker,
    );
    let r = fake.call(&c.item, "use_item").args_json(json!({ "action": "attack" })).transact().await;
    assert!(r.is_err() || r.unwrap().is_failure());
    assert_eq!(c.view().await?["uses"], 0);
    Ok(())
}

#[tokio::test]
async fn key_rejected_after_expiry() -> anyhow::Result<()> {
    let c = setup(Mode::Embedded).await?;
    let (session, sk) = c.rent(60).await?;
    c.use_item(&session).await?;
    c.expire().await?;

    // The key still exists on chain (NEAR keys never expire by themselves)...
    assert!(c.has_key(&sk).await);
    // ...but the contract refuses it.
    let r = session.call(&c.item, "use_item").args_json(json!({ "action": "attack" })).transact().await?;
    assert!(r.is_failure());
    assert!(err_text(&r).contains("lease expired"), "{}", err_text(&r));
    assert_eq!(c.view().await?["uses"], 1);
    assert_eq!(c.view().await?["rental_active"], false);
    Ok(())
}

#[tokio::test]
async fn end_rental_deletes_key_splits_revenue_and_never_settles_twice() -> anyhow::Result<()> {
    let c = setup(Mode::Embedded).await?;
    let secs = 60u64;
    let rent = PRICE_PER_HOUR * secs as u128 / 3600;
    let (session, sk) = c.rent(secs).await?;
    for _ in 0..3 {
        c.use_item(&session).await?;
    }
    let keeper = c.worker.dev_create_account().await?;

    // Nobody can end it early, not even the owner.
    let r = keeper.call(&c.item, "end_rental").transact().await?;
    assert!(r.is_failure());
    assert!(err_text(&r).contains("not expired"), "{}", err_text(&r));

    c.expire().await?;
    let owner_before = c.balance(c.owner.id()).await?;
    let creator_before = c.balance(c.creator.id()).await?;
    let renter_before = c.balance(c.renter.id()).await?;

    // Anyone (here: a keeper bot) can end an expired rental.
    let s: Value = keeper.call(&c.item, "end_rental").max_gas().transact().await?.json()?;
    let creator_cut = rent * ROYALTY_BPS / 10_000;
    let owner_cut = rent - creator_cut;
    let gas_refund = GAS_BUDGET - 3 * USE_FEE;
    assert_eq!(s["rent_earned"], rent.to_string());
    assert_eq!(s["owner_cut"], owner_cut.to_string());
    assert_eq!(s["creator_cut"], creator_cut.to_string());
    assert_eq!(s["renter_refund"], gas_refund.to_string());

    // Split math: exact amounts arrive.
    assert_eq!(c.balance(c.owner.id()).await? - owner_before, owner_cut);
    assert_eq!(c.balance(c.creator.id()).await? - creator_before, creator_cut);
    assert_eq!(c.balance(c.renter.id()).await? - renter_before, gas_refund);

    // The session key is gone from the account.
    assert!(!c.has_key(&sk).await);
    let r = session.call(&c.item, "use_item").args_json(json!({ "action": "attack" })).transact().await;
    assert!(r.is_err() || r.unwrap().is_failure());

    // No double settlement.
    let r = keeper.call(&c.item, "end_rental").transact().await?;
    assert!(r.is_failure());
    assert_eq!(c.balance(c.owner.id()).await? - owner_before, owner_cut);

    let v = c.view().await?;
    assert_eq!(v["renter"], Value::Null);
    assert_eq!(v["lifetime_earnings"], rent.to_string());
    assert_eq!(v["owner_earnings"], owner_cut.to_string());
    assert_eq!(v["creator_earnings"], creator_cut.to_string());
    assert_eq!(v["rental_count"], 1);
    assert_eq!(v["listed"], true);

    // And the item can be rented again.
    c.rent(60).await?;
    assert_eq!(c.view().await?["rental_count"], 2);
    Ok(())
}

#[tokio::test]
async fn owner_cannot_rug_during_rental() -> anyhow::Result<()> {
    let c = setup(Mode::Embedded).await?;
    let secs = 60u64;
    let rent = PRICE_PER_HOUR * secs as u128 / 3600;
    let (session, sk) = c.rent(secs).await?;

    // Owner cannot unlist, re-price, or end the rental early.
    for (method, args) in [
        ("unlist", json!({})),
        ("list", json!({ "price_per_hour": "1" })),
        ("end_rental", json!({})),
        ("return_early", json!({})),
    ] {
        let r = c.owner.call(&c.item, method).args_json(args).transact().await?;
        assert!(r.is_failure(), "owner could call {method} mid-rental");
    }
    // Owner has no key on the item account, so cannot delete the renter's key
    // or pull the escrowed rent. There is no burn method at all.
    for method in ["nft_burn", "burn", "revoke", "withdraw"] {
        let r = c.owner.call(c.factory.id(), method).args_json(json!({ "token_id": c.token_id })).transact().await?;
        assert!(r.is_failure(), "factory exposes {method}");
        let r = c.owner.call(&c.item, method).args_json(json!({})).transact().await?;
        assert!(r.is_failure(), "item exposes {method}");
    }
    assert!(c.has_key(&sk).await);
    c.use_item(&session).await?;

    // Owner may sell the NFT, but the lease carries over intact.
    let buyer = c.worker.dev_create_account().await?;
    c.owner
        .call(c.factory.id(), "nft_transfer")
        .args_json(json!({ "receiver_id": buyer.id(), "token_id": c.token_id }))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    let v = c.view().await?;
    assert_eq!(v["owner"], json!(buyer.id()));
    assert_eq!(v["renter"], json!(c.renter.id()));
    assert_eq!(v["rental_active"], true);
    assert!(c.has_key(&sk).await);
    let used = c.use_item(&session).await?;
    assert_eq!(used["uses"], 2);

    // The previous owner lost control; the new owner cannot rug either.
    let r = c.owner.call(&c.item, "list").args_json(json!({})).transact().await?;
    assert!(r.is_failure());
    let r = buyer.call(&c.item, "unlist").transact().await?;
    assert!(r.is_failure());

    // Rent goes to whoever owns the NFT at settlement.
    c.expire().await?;
    let buyer_before = c.balance(buyer.id()).await?;
    c.renter.call(&c.item, "end_rental").max_gas().transact().await?.into_result()?;
    let owner_cut = rent - rent * ROYALTY_BPS / 10_000;
    assert_eq!(c.balance(buyer.id()).await? - buyer_before, owner_cut);
    Ok(())
}

#[tokio::test]
async fn early_return_refunds_unused_time_pro_rata() -> anyhow::Result<()> {
    let c = setup(Mode::Embedded).await?;
    let secs = 3600u64;
    let rent = PRICE_PER_HOUR; // one hour
    let (session, sk) = c.rent(secs).await?;
    c.use_item(&session).await?;

    // Only the renter can return early.
    let r = c.owner.call(&c.item, "return_early").transact().await?;
    assert!(r.is_failure());

    let owner_before = c.balance(c.owner.id()).await?;
    let creator_before = c.balance(c.creator.id()).await?;
    let out = c.renter.call(&c.item, "return_early").max_gas().transact().await?;
    let s: Value = out.json()?;
    let earned: u128 = s["rent_earned"].as_str().unwrap().parse()?;
    let refund: u128 = s["renter_refund"].as_str().unwrap().parse()?;
    let rent_refund = refund - (GAS_BUDGET - USE_FEE);
    assert_eq!(s["early"], true);

    // Money is conserved, and almost the whole hour was unused.
    assert_eq!(earned + rent_refund, rent);
    // unused share is refunded minus the 5% early-return fee
    assert!(rent_refund > rent * 90 / 100, "refund too small: {rent_refund}");
    assert!(rent_refund <= rent * 95 / 100, "refund ignores the 5% fee: {rent_refund}");

    // Earned part is split like any rent.
    let creator_cut = earned * ROYALTY_BPS / 10_000;
    assert_eq!(c.balance(c.owner.id()).await? - owner_before, earned - creator_cut);
    assert_eq!(c.balance(c.creator.id()).await? - creator_before, creator_cut);

    // Lease is over: key deleted, cannot be used or settled again.
    assert!(!c.has_key(&sk).await);
    let r = session.call(&c.item, "use_item").args_json(json!({ "action": "attack" })).transact().await;
    assert!(r.is_err() || r.unwrap().is_failure());
    let r = c.renter.call(&c.item, "return_early").transact().await?;
    assert!(r.is_failure());
    let r = c.renter.call(&c.item, "end_rental").transact().await?;
    assert!(r.is_failure());
    assert_eq!(c.view().await?["renter"], Value::Null);
    Ok(())
}

#[tokio::test]
async fn rent_validates_payment_listing_and_duration() -> anyhow::Result<()> {
    let c = setup(Mode::Embedded).await?;
    let sk = SecretKey::from_random(KeyType::ED25519);
    let try_rent = |secs: u64, deposit: u128| {
        c.renter
            .call(&c.item, "rent")
            .args_json(json!({ "public_key": sk.public_key(), "duration_secs": secs.to_string() }))
            .deposit(NearToken::from_yoctonear(deposit))
            .max_gas()
            .transact()
    };
    let before = c.balance(c.renter.id()).await?;
    assert!(try_rent(120, 1000).await?.is_failure(), "underpaid rent accepted");
    assert!(try_rent(10, NEAR).await?.is_failure(), "too short accepted");
    assert!(try_rent(999_999, 500 * NEAR / 100).await?.is_failure(), "too long accepted");
    // Failed attempts refund the deposit (only gas is lost).
    assert!(before - c.balance(c.renter.id()).await? < NEAR / 50);

    // Second renter cannot take an item that is already rented.
    c.rent(120).await?;
    assert!(try_rent(120, NEAR).await?.is_failure(), "double rent accepted");

    // Unlisted items cannot be rented.
    c.expire().await?;
    c.owner.call(&c.item, "end_rental").max_gas().transact().await?.into_result()?;
    c.owner.call(&c.item, "unlist").transact().await?.into_result()?;
    assert!(try_rent(120, NEAR).await?.is_failure(), "unlisted item rented");
    // Only the owner lists.
    assert!(c.renter.call(&c.item, "list").args_json(json!({})).transact().await?.is_failure());
    Ok(())
}

#[tokio::test]
async fn durability_wears_down_and_owner_repairs() -> anyhow::Result<()> {
    let c = setup(Mode::Embedded).await?;
    let (session, _) = c.rent(60).await?;
    c.use_item(&session).await?;
    c.use_item(&session).await?;
    assert_eq!(c.view().await?["durability"], 998);
    c.expire().await?;
    c.owner.call(&c.item, "end_rental").max_gas().transact().await?.into_result()?;

    assert!(c.renter.call(&c.item, "repair").deposit(NearToken::from_near(1)).transact().await?.is_failure());
    let creator_before = c.balance(c.creator.id()).await?;
    c.owner
        .call(&c.item, "repair")
        .deposit(NearToken::from_millinear(10))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    assert_eq!(c.view().await?["durability"], 1000);
    // Repair fee (2 points) is a sink paid to the game creator.
    assert_eq!(c.balance(c.creator.id()).await? - creator_before, 2 * NEAR / 10_000);
    Ok(())
}

/// Same flow with the item code published once as a NEAR global contract:
/// every item account references one shared, immutable code hash.
#[tokio::test]
async fn global_contract_mode_mints_and_rents() -> anyhow::Result<()> {
    let c = setup(Mode::Global).await?;
    let cfg: Value = c.factory.view("get_config").await?.json()?;
    assert!(cfg["item_code"]["Global"].is_string(), "{cfg}");
    // Global mode needs no per-item code storage: the mint deposit is tiny.
    let deposit: u128 = cfg["mint_deposit"].as_str().unwrap().parse()?;
    assert!(deposit < NEAR / 2);

    let (session, sk) = c.rent(60).await?;
    assert_eq!(c.use_item(&session).await?["uses"], 1);
    c.expire().await?;
    c.owner.call(&c.item, "end_rental").max_gas().transact().await?.into_result()?;
    assert!(!c.has_key(&sk).await);
    Ok(())
}
