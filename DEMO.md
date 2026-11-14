# LeaseKey demo: 90-second shot list

## Setup before recording

- Use the live site https://leasekey.vercel.app (or `npm run dev` and http://localhost:5173) in **two browser profiles** (or one normal and one incognito window). Each gets its own guest account.
- Window A is the **owner**. Window B is the **renter**.
- In both windows click **Play as guest** and wait for the account name to appear.
- In window A, prepare an item to lend: **My Items**, **Bring an item from another game**, **Claim Ember Greataxe**, select it, **Wrap and make rentable**. This takes about 20 seconds, so do it before recording.
- Optional: `npm run keeper` in a terminal, so expired leases settle even if the renter closes the tab.

## Shots

| # | Time | Window | Action | What to say |
|---|---|---|---|---|
| 1 | 0:00 | A | Reload the landing page and let the hammer strike play. Scroll to "Every item knows which game it belongs to". | "LeaseKey is a rental layer for blockchain games. Games create scarce items, players own them, and each item is its own NEAR account." |
| 2 | 0:12 | A | **My Items**. Show the wrapped Ember Greataxe. Click **Suggest**, then **List for rent**. Click the item's account link to show it on the explorer. | "This player owns an item from another game. They wrapped it, and now it has its own account. They list it at a price based on how scarce it is." |
| 3 | 0:25 | B | **Armory**. Point at editions, stats and the game label. Open the one-of-a-kind item, then open a cheaper one, choose **2 min**, **Rent and fight**. | "Every item shows its game, its stats and how many exist. The renter pays rent and a small gas budget. No collateral, and the item never leaves its owner." |
| 4 | 0:40 | B | The Arena opens. Press Space repeatedly. Point at the on-chain feed. | "Every strike is a real transaction signed by a key in this browser. No wallet pop-ups, and the item pays its own gas." |
| 5 | 0:52 | B | Under **Try to cheat**, click all three buttons. | "Same key, trying to steal. NEAR rejects it: this key can only play." |
| 6 | 1:00 | B | Keep striking until the **Slime Arena reward** bar reaches 20, then **Claim reward roll**. | "Slime Arena is its own contract. It rewards its player by minting a rare item, the way any partner game would. Supply is capped on chain, so it stays scarce, and the player can rent it out through LeaseKey." |
| 7 | 1:12 | A | **My Items**, on a leased item click **Try to unlist (will be rejected)**. | "The owner cannot pull the item back mid-lease either." |
| 8 | 1:18 | B | Wait for the countdown. The item drops from the hero's hand and the settlement line appears. | "Time is up. The item stops working, the lease settles on chain, and the key is deleted." |
| 9 | 1:26 | A | **My Items** shows earnings. Landing page, "An economy games plug into" table. | "The owner earned rent and the game earned its royalty. Nobody trusted anybody." |

## If something goes wrong on camera

- **"Rate limits exceeded"**: public testnet RPC throttling. Wait 30 seconds, or set `VITE_RPC_URL` in `web/.env.local` to your own endpoint and restart `npm run dev`.
- **A strike fails with an allowance error**: you clicked faster than transactions confirm. Pause a second and continue.
- **No reward**: 60% of rolls miss. Each lease gets one roll, so rent again, or run `npx tsx scripts/drop-check.ts` beforehand to see a win in the terminal.
- **Lease shows "Lease ended"**: click **Settle the lease** in the item panel, or run `npm run keeper -- --once`.

## X post draft

> Built at NEAR HACKATHON: LeaseKey, a rental layer for blockchain games.
>
> Every in-game item is its own NEAR account. Rent it with no collateral: you get a session key that can only use the item, the owner keeps ownership, and rent splits on chain between the owner and the game. Supply caps keep rare items rare.
>
> @NEARProtocol #NEARHackathon
>
> https://leasekey.vercel.app · https://github.com/amannx21/LEASEKEY [demo video]
