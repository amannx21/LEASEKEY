# LeaseKey

**Game items that rent themselves out on NEAR. No collateral, no trust.**

Built at the NEAR Hackathon 2026.

## The problem

Renting an item in a Web3 game today means one of two bad deals:

- **Transfer it and trust the renter** to give it back. This is the "scholarship" model, where owners lost items and earnings.
- **Lock collateral** worth the whole item, which shuts out exactly the players who cannot afford the item.

Owners sit on idle items. Players who cannot afford them cannot play.

## The solution

1. **Every item is its own NEAR account.** Minting `Flame Sword` creates the NEP-171 token and the sub-account `flame-sword-1.<factory>.testnet`. That account runs the item contract, holds its own rent and state, and has **no full-access key**. Only its code controls it.
2. **Renting never moves the NFT.** The item account adds a **function-call access key** for the renter, restricted to `receiver_id = the item account` and `method_names = ["use_item"]`. The renter can play. The renter cannot transfer, sell, unlist or withdraw, because the protocol itself rejects those transactions.
3. **Expiry is enforced in code.** NEAR keys do not expire, so `use_item` checks the block time and the signing key. After expiry anyone can call `end_rental`, which deletes the key and pays everyone.
4. **Rent is escrowed in the item account** and split automatically between the owner and the game creator.
5. **Only games create items, scarcity is enforced, and any NFT can join.** Registered games define each item type once, with its stats and a hard cap on how many can ever exist, then mint editions to their players and earn a royalty on every rental. Nobody can mint past the cap or mint a stronger copy, so scarce items stay scarce and worth renting. Players can also **wrap** an NFT they already own in any NEAR game collection: LeaseKey holds the original in escrow, gives it a rentable account, and returns it on unwrap.
6. **Players never notice the chain.** The session key lives in the browser, signs as the item account, and the item account pays the gas. Every sword strike in the demo game is a real transaction with no wallet pop-up.

### Why this only works on NEAR

- **Named sub-accounts** let an asset be an account that owns money and state.
- **Function-call access keys** give a scoped, revocable permission at the protocol level, so "can play but cannot steal" needs no trust in our code path for transfers.
- **Global contracts** let every item account share one immutable code hash, so an item account costs about 0.15 NEAR instead of 1.8 NEAR.

## Live on NEAR testnet

| What | Where |
|---|---|
| Factory and NEP-171 contract | [`leasekey-lq3d9s.testnet`](https://testnet.nearblocks.io/address/leasekey-lq3d9s.testnet) |
| Example item account | [`flame-sword-1.leasekey-lq3d9s.testnet`](https://testnet.nearblocks.io/address/flame-sword-1.leasekey-lq3d9s.testnet) |
| Demo item owner | `owner.leasekey-lq3d9s.testnet` |
| Launch collection (mints the demo items) | "LeaseKey Originals", the factory account |
| Demo game, its own contract and registered game | [`arena.leasekey-lq3d9s.testnet`](https://testnet.nearblocks.io/address/arena.leasekey-lq3d9s.testnet), "Slime Arena" |
| Demo "other game" collection for wrapping | [`ember.leasekey-lq3d9s.testnet`](https://testnet.nearblocks.io/address/ember.leasekey-lq3d9s.testnet), "Ember Realms" |
| Item code mode | Global contract, referenced by code hash |
| Frontend | Run locally with `npm run dev` (see below). Hosted link: not deployed yet, see "Known limitations". |

The IDs are also in [`web/src/deployment.json`](web/src/deployment.json) and [`.env.example`](.env.example). The frontend reads them by default, so a fresh clone talks to this deployment with no configuration.

## How it works

```mermaid
sequenceDiagram
    autonumber
    participant G as Game
    participant O as Owner (player)
    participant F as Factory (NEP-171)
    participant I as Item account
    participant R as Renter wallet
    participant K as Session key (browser)
    participant A as Anyone / keeper

    G->>F: register_game, define_item_type(stats, max_supply)
    G->>F: mint(item_type) to a player, or the player earns it as a loot drop
    F->>I: create sub-account, attach item code, init
    F-->>O: NFT edition minted to the player
    Note over O,F: or: the player wraps an NFT they already own
    O->>I: list(price_per_hour)
    R->>I: rent(public_key, duration) + rent + gas budget
    I->>I: add function-call key (use_item only)
    loop every attack, no wallet pop-up
        K->>I: use_item("slash") signed as the item account
        I-->>K: power, uses left, durability (event logged)
    end
    Note over I: block time passes ends_at
    K-xI: use_item rejected: "lease expired"
    A->>I: end_rental()
    I->>I: delete session key
    I-->>O: owner share of rent
    I-->>G: game royalty
    I-->>R: unused gas budget
```

## Run it

### Prerequisites

| Tool | Version tested | Needed for |
|---|---|---|
| Node.js | 22 or 24 | frontend, deploy, keeper, testnet check |
| Rust | 1.98.1 (pinned in `rust-toolchain.toml`, installed automatically by rustup) | building and testing contracts |
| cargo-near | 0.23.0 | building contracts |
| OS | Linux, macOS, or Windows with WSL2 | the contract sandbox tests do not run on native Windows |

The built contracts are committed in `res/`, so the frontend, the deploy script and the testnet check need **only Node.js**.

Install cargo-near (only for building contracts):

```bash
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/cargo-near/releases/latest/download/cargo-near-installer.sh | sh
```

### 1. Install

```bash
git clone <this repo> leasekey && cd leasekey
npm install
npm --prefix web install
```

### 2. Run the frontend against the live testnet deployment

```bash
npm run dev
```

Open http://localhost:5173. The landing page explains the idea. Click **Play as guest**, open the **Armory**, rent any of the 12 weapons and armour pieces for 2 minutes, and fight in the **Arena**. Each item has its own attack style. On **My Items** you can also claim an item from the demo game "Ember Realms" and wrap it to rent it out. No wallet is needed: guest mode creates a throwaway testnet account from the public faucet. If the faucet is rate limited, the deployment's guest bank account funds it instead.

### 3. Verify the live deployment from the command line (about 90 seconds)

```bash
npm run e2e
```

This rents an item for 60 seconds with a fresh throwaway account, strikes three times with the session key, proves the key cannot do anything else, waits for expiry, and settles. It prints `PASS` per check and ends with `E2E OK`.

### 4. Build and test the contracts

```bash
bash scripts/build.sh          # writes res/item.wasm and res/leasekey.wasm
cd tests && cargo test         # 17 sandbox integration tests
cd .. && cargo test            # unit tests for the rent, refund and split math
```

The first `cargo test` in `tests/` downloads the NEAR sandbox binary and takes a few minutes to compile.

### 5. Deploy your own copy to testnet (optional)

```bash
bash scripts/deploy.sh                 # global-contract mode, 12 demo items
MODE=embedded bash scripts/deploy.sh   # fallback: copy the wasm into every item account
```

The script creates throwaway faucet accounts, deploys, seeds demo items, and rewrites `web/src/deployment.json`. Keys are stored in `.leasekey/keys`, which is git-ignored. It never touches mainnet.

### 6. Run the keeper (optional)

```bash
npm run keeper            # loops, ends every expired rental
npm run keeper -- --once  # single pass
```

## Features and how to verify them

Sandbox tests live in [`tests/tests/p0.rs`](tests/tests/p0.rs) and [`tests/tests/games.rs`](tests/tests/games.rs). "Demo" refers to the steps in [DEMO.md](DEMO.md).

| Feature | How to verify |
|---|---|
| Mint creates the NFT and the item's own account | test `mint_creates_item_account_and_nft`, demo step 1 |
| List and unlist | test `rent_validates_payment_listing_and_duration`, My Items page |
| Rent adds a key restricted to `use_item` on the item account | test `rent_adds_restricted_session_key_and_use_item_works` |
| `use_item` works only with the renter's key | test `use_item_rejects_strangers_and_wrong_keys` |
| Renter cannot transfer, sell or withdraw | test `renter_cannot_transfer_sell_or_withdraw`, demo step 5, `npm run e2e` |
| Key is rejected after expiry | test `key_rejected_after_expiry`, demo step 6 |
| `end_rental` by anyone deletes the key and settles | test `end_rental_deletes_key_splits_revenue_and_never_settles_twice` |
| No double settlement | same test, `npm run e2e` |
| Revenue split, owner plus creator royalty | same test, unit test `split_math` |
| Owner cannot rug during a rental | test `owner_cannot_rug_during_rental` |
| A transfer of the NFT carries the lease over intact | test `owner_cannot_rug_during_rental` |
| Early return with pro-rata refund, 5% fee | test `early_return_refunds_unused_time_pro_rata`, unit test `pro_rata_refund_math` |
| Item ledger view `get_item` | every test reads it; Marketplace page |
| Global-contract mode | test `global_contract_mode_mints_and_rents` |
| Durability and repair (P1) | test `durability_wears_down_and_owner_repairs` |
| Extend a running lease (P1) | test `extend_adds_time_and_rent`, "+2 min" in the game |
| Gameplay with no wallet pop-ups | demo step 4: the on-chain feed shows one transaction per strike |
| 12 items with eight distinct attack styles | Armory page, then fight in the Arena |
| Only registered games can mint; items record their game | test `only_registered_games_mint_and_items_record_their_game`; My Items, Game studio |
| Hard supply caps per item type, power fixed by the type, editions like "2 of 5", types can never change | test `supply_caps_fixed_power_and_verified_games`; Armory cards |
| Game-defined stats (attack, defence, speed, endurance…), fixed once set, used by the Arena | same test; Armory cards and item panel; Arena |
| Verified partner games, shown by default in the Armory | same test; "Verified games" filter |
| The demo Arena only honours its own and its partner's items | Arena: items from other games are refused with a reason |
| Rent guided by scarcity | My Items: "Suggest" price from supply and power |
| A game is a separate contract using only LeaseKey's public interface: Slime Arena chooses which games' items it honours and rewards its players by calling the ordinary `mint`. LeaseKey itself never hands out items | test `a_separate_game_contract_rewards_its_players_through_public_mint`; Arena "Slime Arena reward"; `npx tsx scripts/drop-check.ts` |
| Owners cannot rate their own wrapped items: only the original game sets stats, once | test `wrap_any_nft_rent_it_then_unwrap_it` |
| Wrap any NEP-171 NFT, rent it, unwrap it; no unwrap during a lease | test `wrap_any_nft_rent_it_then_unwrap_it`; My Items, "Bring an item from another game" |
| Factory upgraded in place without losing items | test `migrate_from_v1_keeps_items_and_credits_them_to_the_house_game` |
| Owner and game shown on every item; "Mine" filter | Armory page |
| Game integration SDK | `npm run sdk:example`; "For game devs" page |
| Live economy charts read from chain | landing page, "The economy, live from testnet" |

## Architecture

| Path | What it is |
|---|---|
| `contracts/item` | Item contract on every item account: rental state, `use_item`, `end_rental`, early return, extend, durability, earnings and split |
| `contracts/leasekey` | Factory and NEP-171 NFT contract: game registry, game-only minting, wrapping and unwrapping of external NFTs, transfer, enumeration, listing index |
| `contracts/demo-nft` | A plain NEP-171 collection standing in for another game's items |
| `contracts/arena-game` | Slime Arena, the demo game: its own contract and registered game, integrating through LeaseKey's public interface only |
| `sdk/` | TypeScript SDK for games: rent, session keys, `canUse`, wrapping |
| `docs/DESIGN-QA.md` | Hard design questions, with answers and the fixes they led to |
| `tests/` | near-workspaces sandbox tests for every P0 rule |
| `web/` | Vite, React, TypeScript: landing page, Armory, Arena, My Items |
| `scripts/` | `build.sh`, `deploy.sh`, `deploy.ts`, `upgrade.ts`, `keeper.ts`, `e2e.ts` |
| `res/` | Built wasm files |
| `assets/` | Original CC0 item art |

**Mode shipped: per-item sub-accounts with a global contract.** The fallback single-contract mode was not needed. The factory also supports an embedded mode that copies the wasm into each item account, and the sandbox tests run in both modes.

**Money flow.** `rent` takes the rent plus a gas budget of at least 0.01 NEAR. Each `use_item` is charged a flat 0.0005 NEAR against that budget, which covers the measured gas cost of about 0.0002 NEAR that the item account pays. At settlement the unused budget returns to the renter. Every payout uses a callback, and a failed transfer is credited to a `claim()` balance, so funds cannot get stuck.

## Security notes

**What the renter's session key can do**

- Call `use_item` on the one item account it was added to, until the lease expires or the gas budget is used up.

**What it cannot do, enforced by the NEAR protocol**

- Call any other method on the item account.
- Call any other contract, including the NFT contract.
- Attach or transfer any NEAR. Function-call keys cannot carry a deposit.
- Spend more gas than its allowance, which equals the gas budget the renter paid.

**What the owner cannot do during a rental**

- Unlist, change the price, end the rental early, or revoke the key. There is no burn method.
- Unwrap a wrapped NFT. The factory changes the item's owner and unlists it in one receipt, so if a lease exists the whole step reverts.
- The owner may transfer the NFT. The lease continues unchanged and the rent goes to whoever owns the NFT at settlement.

**Known limitations**

- The factory account still has a full-access key held by the deployer, and was used once to upgrade the factory in place. A malicious deployer could upgrade it again and reassign item owners or release escrowed NFTs. Production would remove that key or hand it to a DAO. Item code itself is immutable because it is referenced by hash.
- After expiry the key stays on the account until someone calls `end_rental`. The contract rejects it in the meantime. The keeper and the game client both call `end_rental`.
- The session key is stored in the browser's `localStorage`. It can only play, so a leak costs at most the remaining gas budget.
- The shortest rental is 60 seconds, the longest is set per item, 2 hours for the demo items.
- Guest mode uses the public testnet faucet, which is rate limited per address. As a fallback, `web/src/deployment.json` contains the key of a small testnet-only guest bank account that creates guest accounts. That key is public on purpose, holds only a few testnet NEAR, and anyone could drain it. `npm run bank -- 5` refills it from the factory.
- Public testnet RPC endpoints are rate limited. Set `VITE_RPC_URL` or `NEAR_RPC_URL` to use your own.
- The wallet path uses NEAR Wallet Selector with MyNearWallet and Meteor. The automated checks and our manual run-through exercised the guest path; the wallet path is implemented but less tested.
- The frontend is not hosted yet. It is a static Vite build, so `npm run build:web` and any static host will serve `web/dist`.
- Wrapping costs the same as a mint and is prepaid with `deposit_for_wrap`, because an NFT transfer carries no NEAR. Unused credit can be withdrawn.
- Items store a generic `power` and durability. Game-specific stats stay with the game, or in the original NFT for wrapped items.
- Slime Arena's reward rolls prove paid play, not skill: the contract counts on-chain strikes, which a script could send. Rewards are bounded by the supply caps and paid from the game contract's own balance.
- The session key's gas allowance covers roughly eight strikes in flight at once. Faster bursts fail until earlier ones confirm.
- Not audited. Testnet only.

## How this compares

NFT rental is not new, and games minting items is standard. What LeaseKey adds is how the lease is enforced.

| Approach | How the renter gets access | What it leaves open |
|---|---|---|
| Transfer and trust (Axie-style scholarships) | The item or account is handed over | The renter can keep or misuse it |
| Collateralized rental (for example reNFT's default mode) | The renter posts collateral worth the item | Shuts out players who cannot afford the item |
| A "user" role on the token (ERC-4907) or a rental registry (reNFT collateral-free) | A temporary role the game reads | In the ERC-4907 reference flow the lender can reset the user and end the rental early |
| A game's own rental market (Splinterlands) | Built into that one game | Works only inside that game |
| **LeaseKey** | A NEAR access key on the item's own account that can only call `use_item` | See below |

What is specific to LeaseKey:

- **The renter's actions are real signed transactions with no wallet and no gas for the player.** The key lives on the item's account, so the item pays.
- **The owner cannot end a lease early.** There is no revoke, unlist, unwrap or burn path while a lease runs.
- **The item is an account.** It escrows its own rent and pays the owner and the game itself.
- **Scarcity and game identity are part of the protocol:** capped item types, editions, and a game recorded on every item.

What LeaseKey shares with the others: the game still has to integrate. Like ERC-4907 and reNFT's collateral-free mode, a lease only matters if the game checks it.

## Target tracks

- **NFTs That Do Something.** The NFT is an account. It owns money, earns rent, pays royalties and hands out scoped access rights by itself.
- **Games With Real Economies.** The loop is a game first: rent a sword, fight slimes, lose the sword when the lease ends. Durability and repair fees are a sink. Players never see a wallet during play.
- **Social Money.** Rent splits between owner and creator on every settlement, and lending needs no collateral or trust, which is the basis for guild and scholarship lending.

## What's next

See [docs/DESIGN-QA.md](docs/DESIGN-QA.md) for the design questions behind these.

- Publish the SDK to npm.
- Several royalty receivers per item, for items honoured by more than one game.
- A protocol fee on settlement, so LeaseKey itself is sustainable.
- A second playable game, to show cross-game rules from both sides.
- Renter reputation with a minimum-reputation setting per listing.
- Gasless renting through meta transactions (NEP-366) and a relayer, so the renter needs no NEAR at all.
- Guild pools owned by a Sputnik DAO, with a rent share to the treasury.
- Rent paid in any token through NEAR Intents.
- Remove the factory's full-access key and move upgrades to a DAO.
- Shrink the item wasm, currently 182 KB.

## License

MIT. Item art is original and CC0. Item designs are original pieces inspired by well-known archetypes, not copies of any franchise's assets. Fonts are Cinzel and Manrope, both under the SIL Open Font License.
