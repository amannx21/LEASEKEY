# LeaseKey demo: 90-second shot list

## Setup before recording

- `npm run dev`, open http://localhost:5173 in **two browser profiles** (or one normal and one incognito window). Each gets its own guest account.
- Window A is the **owner**. Window B is the **renter**.
- In both windows click **Play as guest** and wait for the account name to appear.
- Keep a tab open on https://testnet.nearblocks.io for the explorer shot.
- Optional: `npm run keeper` in a terminal, so expired leases settle even if the renter closes the tab.

## Shots

| # | Time | Window | Action | What to say |
|---|---|---|---|---|
| 1 | 0:00 | A | **My Items**, name the item "Flame Sword", click **Mint and list**. Click the item's account link to open it on the explorer. | "Minting creates the NFT and its own NEAR account. The sword is an account. It has no owner key, only code." |
| 2 | 0:15 | A | In the item row set the price to `0.1` NEAR/hr and click **Update price**. | "The owner lists it at 0.1 NEAR per hour." |
| 3 | 0:25 | B | **Marketplace**, click **Rent** on that sword, choose **2 min**, confirm. | "The renter pays rent and a small gas budget. No collateral. The NFT does not move. The sword's account adds a key for this browser that can only call use_item." |
| 4 | 0:40 | B | The Slime Arena opens. Press Space repeatedly. Point at the on-chain feed filling with transactions. | "Every strike is a real transaction, signed by the session key. No wallet pop-ups, and the sword pays its own gas." |
| 5 | 0:55 | B | Under **Try to cheat** click **Transfer the NFT to myself**, then the other two buttons. | "Same key, trying to steal. The NEAR protocol rejects it: this key can only play." |
| 5b | 1:05 | A | **My Items**, click **Try to unlist (will be rejected)**. | "The owner cannot rug the renter either. No unlist, no revoke, until the lease ends." |
| 6 | 1:10 | B | Wait for the countdown to hit zero. The sword disappears and the banner reads "Your lease on Flame Sword ended". The settlement line appears. | "Time is up. The sword stops, the rental settles on chain, the key is deleted." |
| 7 | 1:20 | A | **My Items** shows earnings on the sword. | "The owner earned rent, the game creator got a royalty, the renter got unused gas back. Nobody trusted anybody." |

## If something goes wrong on camera

- **"Rate limits exceeded"**: public testnet RPC throttling. Wait 30 seconds, or set `VITE_RPC_URL` in `web/.env.local` to your own endpoint and restart `npm run dev`.
- **Faucet refuses a guest account**: use the pre-seeded items instead of minting. Window A can be skipped, since the Marketplace already has five listed items.
- **Lease shows "awaiting settlement"**: click **Settle lease**, or run `npm run keeper -- --once`.

## X post draft

> Built at NEAR HACKATHON: LeaseKey, game items that rent themselves out.
>
> Every item NFT is its own NEAR account. Renting adds a session key that can only call use_item. No collateral, no trust, no wallet pop-ups while you play. When the lease ends, the sword stops and the rent splits on chain.
>
> @NEARProtocol #NEARHackathon
>
> [repo link] [demo video]
