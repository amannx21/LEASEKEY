//! Game registry, wrapping NFTs from other collections, and the v1 -> v2 migration.
//! Run `bash scripts/build.sh` first.
use near_workspaces::network::Sandbox;
use near_workspaces::types::{KeyType, NearToken, SecretKey};
use near_workspaces::{Account, AccountId, Contract, Worker};
use serde_json::{json, Value};

const NEAR: u128 = 1_000_000_000_000_000_000_000_000;

fn wasm(name: &str) -> Vec<u8> {
    let path = format!("{}/../res/{name}.wasm", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&path).unwrap_or_else(|_| panic!("{path} missing: run scripts/build.sh"))
}

async fn factory(worker: &Worker<Sandbox>) -> anyhow::Result<Contract> {
    let f = worker.dev_deploy(&wasm("leasekey")).await?;
    f.call("new").args_json(json!({})).transact().await?.into_result()?;
    f.call("store_item_code").args(wasm("item")).deposit(NearToken::from_near(3)).max_gas().transact().await?.into_result()?;
    Ok(f)
}

async fn mint_deposit(f: &Contract) -> anyhow::Result<NearToken> {
    let d: String = f.view("mint_deposit").await?.json()?;
    Ok(NearToken::from_yoctonear(d.parse()?))
}

fn item_args(name: &str, owner: Option<&AccountId>) -> Value {
    json!({ "args": {
        "name": name, "image": "flame-sword.svg", "power": 40, "price_per_hour": NEAR.to_string(),
        "max_secs": "7200", "royalty_bps": 1000, "owner": owner,
    }})
}

#[tokio::test]
async fn only_registered_games_mint_and_items_record_their_game() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let f = factory(&worker).await?;
    let game = worker.dev_create_account().await?;
    let player = worker.dev_create_account().await?;
    let copycat = worker.dev_create_account().await?;
    let dep = mint_deposit(&f).await?;

    // A player cannot mint their own "Flame Sword": only games create items.
    let r = player.call(f.id(), "mint").args_json(item_args("Flame Sword", None)).deposit(dep).max_gas().transact().await?;
    assert!(r.is_failure());
    assert!(format!("{r:?}").contains("only registered games"));

    game.call(f.id(), "register_game").args_json(json!({ "name": "Slime Arena" }))
        .deposit(NearToken::from_millinear(10)).transact().await?.into_result()?;
    let minted: Value = game.call(f.id(), "mint").args_json(item_args("Flame Sword", Some(player.id())))
        .deposit(dep).max_gas().transact().await?.json()?;
    assert_eq!(minted["owner"], json!(player.id()));
    assert_eq!(minted["game"], json!(game.id()));
    assert_eq!(minted["game_name"], "Slime Arena");
    let item: AccountId = minted["item_account"].as_str().unwrap().parse()?;
    let v: Value = worker.view(&item, "get_item").await?.json()?;
    assert_eq!(v["owner"], json!(player.id()));
    assert_eq!(v["creator"], json!(game.id()), "the game earns the royalty");

    // A copycat can register its own "game" and mint a lookalike, but the item
    // is permanently labelled with the copycat's game, so Slime Arena ignores it.
    copycat.call(f.id(), "register_game").args_json(json!({ "name": "Totally Slime Arena" }))
        .deposit(NearToken::from_millinear(10)).transact().await?.into_result()?;
    let fake: Value = copycat.call(f.id(), "mint").args_json(item_args("Flame Sword", None))
        .deposit(dep).max_gas().transact().await?.json()?;
    assert_eq!(fake["game"], json!(copycat.id()));
    assert_ne!(fake["game"], minted["game"]);

    // Only the admin may mint on behalf of another game.
    let mut spoof = item_args("Flame Sword", None);
    spoof["args"]["creator"] = json!(game.id());
    let r = copycat.call(f.id(), "mint").args_json(spoof).deposit(dep).max_gas().transact().await?;
    assert!(r.is_failure());

    let games: Value = f.view("get_games").await?.json()?;
    assert_eq!(games.as_array().unwrap().len(), 2);
    Ok(())
}

async fn rent(worker: &Worker<Sandbox>, renter: &Account, item: &AccountId, secs: u64) -> anyhow::Result<Account> {
    let sk = SecretKey::from_random(KeyType::ED25519);
    let price: String = worker.view(item, "quote").args_json(json!({ "duration_secs": secs.to_string() })).await?.json()?;
    renter.call(item, "rent")
        .args_json(json!({ "public_key": sk.public_key(), "duration_secs": secs.to_string() }))
        .deposit(NearToken::from_yoctonear(price.parse::<u128>()? + NEAR / 20))
        .max_gas().transact().await?.into_result()?;
    Ok(Account::from_secret_key(item.clone(), sk, worker))
}

#[tokio::test]
async fn wrap_any_nft_rent_it_then_unwrap_it() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let f = factory(&worker).await?;
    let other_game = worker.dev_deploy(&wasm("demo-nft")).await?;
    other_game.call("new").args_json(json!({ "name": "Ember Realms" })).transact().await?.into_result()?;
    let player = worker.dev_create_account().await?;
    let renter = worker.dev_create_account().await?;

    // The player owns an item in another game's collection.
    let token: Value = player.call(other_game.id(), "claim").args_json(json!({ "title": "Ember Greataxe" }))
        .deposit(NearToken::from_millinear(20)).transact().await?.json()?;
    let tid = token["token_id"].as_str().unwrap().to_string();
    let owner_of = |w: &Worker<Sandbox>, c: AccountId, t: String| {
        let w = w.clone();
        async move {
            let v: Value = w.view(&c, "nft_token").args_json(json!({ "token_id": t })).await?.json()?;
            anyhow::Ok(v["owner_id"].as_str().unwrap_or_default().to_string())
        }
    };
    let msg = json!({ "name": "Ember Greataxe", "price_per_hour": NEAR.to_string(), "power": 50, "royalty_bps": 500 }).to_string();
    let wrap = |m: String| {
        player.call(other_game.id(), "nft_transfer_call")
            .args_json(json!({ "receiver_id": f.id(), "token_id": tid, "msg": m }))
            .deposit(NearToken::from_yoctonear(1)).max_gas().transact()
    };

    // Without prepaid wrap credit the NFT bounces straight back.
    wrap(msg.clone()).await?.into_result()?;
    assert_eq!(owner_of(&worker, other_game.id().clone(), tid.clone()).await?, player.id().as_str());

    let dep = mint_deposit(&f).await?;
    player.call(f.id(), "deposit_for_wrap").deposit(dep).transact().await?.into_result()?;
    wrap(msg).await?.into_result()?;
    // The original now sits in LeaseKey's escrow, and a rentable item exists.
    assert_eq!(owner_of(&worker, other_game.id().clone(), tid.clone()).await?, f.id().as_str());
    let found: Value = f.view("find_wrapped")
        .args_json(json!({ "origin_contract": other_game.id(), "origin_token_id": tid })).await?.json()?;
    assert_eq!(found["owner"], json!(player.id()));
    assert_eq!(found["origin"]["contract"], json!(other_game.id()));
    assert_eq!(found["game"], json!(other_game.id()));
    let item: AccountId = found["item_account"].as_str().unwrap().parse()?;
    let v: Value = worker.view(&item, "get_item").await?.json()?;
    assert_eq!(v["creator"], json!(other_game.id()), "the origin collection earns the royalty");

    // It rents like any item.
    player.call(&item, "list").args_json(json!({})).transact().await?.into_result()?;
    let session = rent(&worker, &renter, &item, 60).await?;
    session.call(&item, "use_item").args_json(json!({ "action": "cleave" })).transact().await?.into_result()?;

    // The owner cannot pull the original out from under the renter.
    let r = player.call(f.id(), "unwrap").args_json(json!({ "token_id": found["token_id"] }))
        .deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;
    assert!(r.is_failure(), "unwrap during a lease must fail");
    assert_eq!(owner_of(&worker, other_game.id().clone(), tid.clone()).await?, f.id().as_str());
    // Nor can anyone else unwrap it.
    let r = renter.call(f.id(), "unwrap").args_json(json!({ "token_id": found["token_id"] }))
        .deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;
    assert!(r.is_failure());

    // After the lease settles, unwrapping returns the original.
    for _ in 0..40 {
        let v: Value = worker.view(&item, "get_item").await?.json()?;
        if !v["rental_active"].as_bool().unwrap() { break; }
        worker.fast_forward(100).await?;
    }
    renter.call(&item, "end_rental").max_gas().transact().await?.into_result()?;
    player.call(f.id(), "unwrap").args_json(json!({ "token_id": found["token_id"] }))
        .deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
    worker.fast_forward(3).await?;
    assert_eq!(owner_of(&worker, other_game.id().clone(), tid.clone()).await?, player.id().as_str());

    // The wrapper is retired: gone from the index, and it cannot be rented again.
    let items: Value = f.view("get_items").args_json(json!({})).await?.json()?;
    assert!(items.as_array().unwrap().is_empty());
    let v: Value = worker.view(&item, "get_item").await?.json()?;
    assert_eq!(v["listed"], false);
    assert_eq!(v["owner"], json!(f.id()));
    let r = rent(&worker, &renter, &item, 60).await;
    assert!(r.is_err());
    Ok(())
}

#[tokio::test]
async fn migrate_from_v1_keeps_items_and_credits_them_to_the_house_game() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let v1 = std::fs::read(format!("{}/leasekey-v1.wasm", env!("CARGO_MANIFEST_DIR")))?;
    let f = worker.dev_deploy(&v1).await?;
    f.call("new").args_json(json!({})).transact().await?.into_result()?;
    f.call("store_item_code").args(wasm("item")).deposit(NearToken::from_near(3)).max_gas().transact().await?.into_result()?;
    let player = worker.dev_create_account().await?;
    let dep = mint_deposit(&f).await?;
    // v1 allowed anyone to mint
    let minted: Value = player.call(f.id(), "mint")
        .args_json(json!({ "args": { "name": "Old Sword", "image": "flame-sword.svg", "power": 10,
            "price_per_hour": NEAR.to_string(), "max_secs": "7200", "royalty_bps": 0 } }))
        .deposit(dep).max_gas().transact().await?.json()?;
    let token_id = minted["token_id"].as_str().unwrap().to_string();

    f.as_account().deploy(&wasm("leasekey")).await?.into_result()?;
    f.call("migrate").args_json(json!({ "game_name": "LeaseKey Arena" })).max_gas().transact().await?.into_result()?;

    let items: Value = f.view("get_items").args_json(json!({})).await?.json()?;
    assert_eq!(items[0]["token_id"], token_id);
    assert_eq!(items[0]["owner"], json!(player.id()));
    assert_eq!(items[0]["game"], json!(f.id()));
    assert_eq!(items[0]["game_name"], "LeaseKey Arena");
    // After migration minting is game-only.
    let r = player.call(f.id(), "mint").args_json(item_args("New Sword", None)).deposit(dep).max_gas().transact().await?;
    assert!(r.is_failure());
    // The house game (the factory itself) can still mint, e.g. for the demo seed.
    f.call("mint").args_json(item_args("House Sword", Some(player.id()))).deposit(dep).max_gas().transact().await?.into_result()?;
    let items: Value = f.view("get_items").args_json(json!({})).await?.json()?;
    assert_eq!(items.as_array().unwrap().len(), 2);
    Ok(())
}
