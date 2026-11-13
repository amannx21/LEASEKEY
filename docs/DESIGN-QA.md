# Design questions and answers

Hard questions about LeaseKey, each with the answer and what changed because of it. This log is kept up to date as new questions come in.

## 1. Who is LeaseKey for?

**Question:** Isn't this for people to rent their in-game items? Why NFTs?

**Answer:** It is for blockchain games, where players truly own their items. On a blockchain, that ownership record is an NFT. Players never need to see the word: the app talks about items, and play needs no wallet pop-ups.

In a normal game the company owns every item in its database, so it can add renting itself and there is no trust problem. The trust problem only appears when players own items outright, which is exactly when lending means handing the item to a stranger.

## 2. If anyone can mint a divine sword, why would anyone rent one?

**Question:** If people can easily create their own items on LeaseKey, why rent? Couldn't someone mint copies of other items?

**Answer:** They could, in the first version. That was a real flaw: free minting destroys scarcity, and scarcity is the only reason to rent.

**Fix:** players can no longer mint.

- Only **registered games** can mint, and they mint items to their players. Test: `only_registered_games_mint_and_items_record_their_game`.
- Every item permanently records the game that made it, and that game earns the royalty.
- Anyone can still register a "game" and mint a lookalike. But the lookalike is labelled with the copycat's game forever, and the real game only honours its own items. It is the same reason a fake skin does not work in Fortnite.

## 3. Can a player rent out an NFT they already own in another game?

**Question:** I want all NFT items to be usable. Why only items minted through LeaseKey?

**Answer:** In the first version, only LeaseKey items could be rented, because the rental logic lives in each item's own account.

**Fix:** wrapping.

- A player sends any NEP-171 NFT they own to LeaseKey with `nft_transfer_call`. LeaseKey holds the original in escrow and creates a rentable item account backed by it.
- The original collection is recorded as the item's game and can receive a royalty on every rental.
- The owner can **unwrap** it at any time it is not on lease, and gets the original NFT back. Unwrapping during a lease is rejected, so the owner cannot pull an item away from a renter.
- Test: `wrap_any_nft_rent_it_then_unwrap_it`. The demo collection "Ember Realms" (`contracts/demo-nft`) stands in for another game.

## 4. Can game A use an item made for game B?

**Answer:** Only if game A chooses to. LeaseKey is the rental layer, not the rulebook.

- Every item carries its game (`game` in `get_items`).
- A game checks access with the SDK's `canUse`. By default a game honours only its own items. A game may opt in to others, for example a partner game's weapons, by passing a list of allowed games.
- This mirrors how cross-game items work anywhere: the game that renders the item decides what it means.

## 5. Every game has different weapons. How can one rental system serve all of them?

**Answer:** LeaseKey does not define what a weapon does. It only answers three questions every game needs:

1. Who owns this item?
2. Who may use it right now, and until when?
3. Who gets paid when the lease ends?

Each game keeps its own stats, art and rules. The item account stores a generic `power` number and durability, and `use_item(action)` takes any action label, so a game logs "slash", "cast" or "drive" as it likes. A wrapped item keeps a pointer to its original NFT, so the game can read the full original metadata from its own collection.

**Remaining gap:** per-game stats are not stored on LeaseKey items. A game that wants them reads its own NFT (for wrapped items) or keeps them off-chain keyed by token id.

## 6. How do people list their items?

**Answer:** On **My Items**:

- Items a game gave you, and items you wrapped, appear with a price box and **List for rent**, **Update price** and **Unlist**. Unlist is blocked during a lease.
- **Bring an item from another game** wraps an NFT you own. The demo has a "claim a free Ember Realms item" button so judges can try the whole path.
- Game studios register and mint items to players from the **Game studio** panel.

## 7. Does the owner's name appear on every item?

**Answer:** Yes. Every Armory card shows the owner, with "You" on your own items, and the item's game. The detail panel links the owner, the item's own account and, for wrapped items, the original NFT. The Armory has an "Owned by me" filter.

## 8. How easily can other games integrate?

**Answer:** With the SDK in `sdk/`:

```ts
const lk = new LeaseKey({ factoryId: "leasekey-lq3d9s.testnet" });
const session = await lk.rent(playerAccount, itemId, 120);   // or lk.rentAction(...) for any wallet
await session.use("slash");                                   // no wallet pop-up
const { ok } = await lk.canUse(itemId, player, { games: [myGame] });
```

`npm run sdk:example` runs this against testnet. The app's "For game developers" page has the same walkthrough.

**Remaining gaps:** the SDK is not published to npm yet, and a game server that wants to verify moves must read `item_used` events through an indexer or RPC.
