# Progress

Deadline: 14 Nov 2026, 23:59 UTC. Last updated: 14 Nov 2026.

## Decisions

- **Mode shipped:** per-item sub-accounts with a NEAR global contract referenced by code hash. Verified in the sandbox and on testnet. The single-contract fallback was not needed.
- **Gas model:** the session key signs as the item account, so the item pays gas. The renter prepays a gas budget, charged 0.0005 NEAR per use, with the rest refunded at settlement.
- **Transfers during a rental:** allowed, the lease carries over intact and rent goes to the owner at settlement.
- **Guest mode:** the frontend creates a throwaway testnet account in one click, so the demo needs no wallet. It uses the public faucet, and falls back to a small public guest bank account when the faucet is rate limited.
- **Build environment:** contracts build and test on Linux, macOS or WSL. The sandbox does not run on native Windows.

## P0

- [x] Mint item: NFT plus item sub-account with metadata
- [x] List and unlist
- [x] Rent: payment plus public key, restricted function-call key added
- [x] `use_item`: validates key and time, records usage, emits event
- [x] `end_rental`: anyone after expiry, deletes key, settles, no double settlement
- [x] Owner-can't-rug guarantee, with test
- [x] Early return with pro-rata refund, 5% fee
- [x] Revenue split: owner plus creator royalty, set at mint
- [x] Item ledger view `get_item`
- [x] near-workspaces tests for every P0 rule (20 passing, including games, wrapping, scarcity, open supply, rolled drops, key reset, retiring and loot drops)
- [x] Capped item types with fixed stats and editions; verified partner games
- [x] Loot drops earned by on-chain play
- [x] Scarcity-based price suggestion; Arena plays by item stats and game rules
- [x] Game registry: only games mint; items record their game
- [x] Wrap any NEP-171 NFT into a rentable item, unwrap it back
- [x] Testnet factory upgraded in place with a state migration
- [x] TypeScript SDK and developer page
- [x] docs/DESIGN-QA.md: every product question with answer and fix
- [x] Testnet deploy and seed script, 12 demo items live, including armour
- [x] Keeper script
- [x] Frontend: landing page with axe-throw hero and live charts, Armory with class filters and detail panel, Arena with eight attack styles and a rent-more-gear strip, My Items with wrapping and a game studio, developer page
- [x] End-to-end check against live testnet (`npm run e2e`)
- [x] README, DEMO.md, LICENSE, .env.example

## P1

- [x] Durability and wear, owner repair for a fee
- [x] Extend rental while active
- [ ] Renter reputation and `min_reputation` on listings
- [ ] Gasless renting via meta transactions (NEP-366) and a relayer

## P2

- [ ] Guild pools owned by a Sputnik DAO
- [ ] Rent in any token via NEAR Intents
- [ ] Per-match pricing, multi-item loadouts

## Still to do before submission

- [ ] Host the frontend (Vercel or Netlify) and add the link to the README. Needs the repo owner's hosting account.
- [x] Pushed to GitHub: https://github.com/amannx21/LEASEKEY
- [ ] Record the 90-second demo from DEMO.md.
- [ ] Test the wallet path (MyNearWallet, Meteor) by hand with a real testnet wallet.

## Biggest remaining risk

Public testnet rate limits during the live demo or the judges' run, on both the RPC and the faucet. The faucet blocked this machine for 8 hours after about ten accounts, which is why the guest bank exists. The scripts back off and retry, and the frontend fails over between two endpoints, but a private RPC URL in `VITE_RPC_URL` removes the risk.
