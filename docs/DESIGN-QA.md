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

## 9. Does the landing page describe what LeaseKey actually does?

**Question:** The headline talked about bows and swords, and the copy predated games-only minting and wrapping.

**Fix:** the headline is now "Rent in-game gear", and every section was rewritten for the current design:

- The opening paragraph calls LeaseKey a rental layer for blockchain games, and says each item knows its game and pays both its owner and that game.
- The lease timeline starts with "Arrive": a partner game mints the item, or a player wraps an NFT they already own.
- The guarantees now include "the owner can never unwrap the original NFT mid-lease".

## 10. How do players see which items belong to which game, and how is it enforced?

**Fix:** a landing section, "Every item knows which game it belongs to", built from live chain data:

- Each registered game is listed with its items.
- Three worked examples show the rule: an item accepted in its own game, a different game's item rejected by default, and that same item accepted after a partnership.
- The enforcement is on chain. Only registered games mint, the game is written into the item at creation and can never change, and a game checks `canUse(item, player, { games: [itself] })` before honouring an item.

Every Armory card and item panel also shows the item's game.

## 11. Can LeaseKey become an economy with partner games, without losing focus on rentals?

**Answer:** Yes, and the incentive is built in. The game is the creator of the items it mints, so it earns a royalty on every lease without running a marketplace. LeaseKey stays a rental layer: it never sells items, it only lends them.

**Fix:** a landing section, "An economy games plug into", with the four partner steps: register, mint to players or let them wrap, players rent to each other, the game earns per lease. Beside it is a live table of partner games with their items, leases and royalties earned, plus a "Partner with LeaseKey" button that leads to the developer page.

**Remaining gap:** there is no revenue share to LeaseKey itself yet. A protocol fee on settlement is a single-line change in the item contract, but it would need the item code republished.

## 12. The hero animation

**Feedback:** replace the axe throw, and remove the stray circle.

**Fix:** a gauntlet snap. The Astral Gauntlet, an original design, lights its five stones and snaps. Sound-wave arcs roll out, ash and embers stream from the fingertips and bend as the wave passes, and the dust settles into "Rent in-game gear". An aftershock then shakes each letter in turn, and electric glow crackles down both sides of the text. A soft pulse repeats every 7 seconds. It is drawn on a canvas at device resolution, and reduced-motion users see the final frame.

## 13. Shouldn't minting be strictly limited? What is the NFT for?

**Question:** If any game can mint unlimited or overpowered items, why would anyone rent? The idea is to rent game-specific items that are hard or expensive to get, and the rent should reflect that.

**Answer:** Agreed. The NFT's job is to prove that a scarce in-game item exists and who owns it. LeaseKey rents that scarcity out. Without enforced scarcity there is nothing worth renting.

**Fix:**

- **Capped item types, enforced on chain.** A game defines each item type once, with its art, power and the maximum number that can ever exist. Every mint must name a type, and the contract refuses to mint past the cap. Power comes from the type, so a mint cannot ask for a stronger copy. A type can never be edited, not even by the game. Test: `supply_caps_fixed_power_and_verified_games`.
- **Editions.** Every item shows "Edition 2 of 5". The live demo items range from the one-of-a-kind Astral Gauntlet to 12 Guardian Shields.
- **Verified partner games.** Registration stays open, but the admin marks verified partners. The Armory shows only verified games by default, and other games are labelled "Unverified".
- **The demo Arena enforces game rules.** It honours only its own items and its partner's. Anything else is refused, with an explanation.
- **Rent follows scarcity.** Rarity tiers come from supply: one of a kind, Mythic, Legendary, Epic, Rare. Owners get a suggested price from supply and power, and the demo items are priced with it. The one-of-a-kind gauntlet rents for 0.22 NEAR an hour, a common shield for 0.01.

## 14. Items need real stats, depending on the game

**Question:** Items should have separate stats like attack, defence and endurance, defined by each game.

**Fix:** item types carry the game's own named stats, up to 8, such as attack, defence, speed and endurance. The game sets them once and the chain fixes them, like the supply cap. Wrapped NFTs can bring their original game's stats too. The Armory shows stat bars on every card and in the item panel. The demo Arena plays by them: attack sets damage, speed shortens the swing cooldown, defence blocks part of every hit, and endurance slowly heals.

## 15. The hero animation, third pass

**Feedback:** the animation repeated, the gauntlet looked unreal, and the side lightning sat at the window edges instead of being part of the scene.

**Fix:** a knight raises the Thunder Hammer, it charges with sparks, he swings, and an electric beam blasts into the headline. The beam breaks into dust that settles into the grainy "Rent in-game gear". Branching thunder strikes around the knight and the words. Every bolt and flash is drawn as added light on a transparent canvas that extends past the content column, so it blends into the page with no visible edge. A final bolt jolts the letters. The sequence plays once on load, then stops, and replays only on request.

## 16. The hero lagged, and the knight's arm looked wrong

**Feedback:** the animation was laggy and the arm was far too long.

**Cause and fix:**

- **Lag.** Each frame redrew the hammer's vector art under a heavy blur, blurred every lightning bolt three times, and changed fill style for each of about 5,000 dust grains. Now the hammer is rasterised once with its glow baked in. Lightning glow is layered wide, faint strokes under additive blending instead of blur. Dust is drawn in ten colour batches, and resolution is capped at 2x. Measured over a full replay: 15.9 ms average frame, worst 31 ms, no frame over 33 ms, so a steady 60 fps.
- **Arm.** It was one straight bar from the shoulder to wherever the hand had to be. It is now an upper arm and a forearm with fixed lengths and a bending elbow, solved each frame. A glove grips the handle, and the hammer is a little smaller.

## 17. Have we actually solved the renting problem? Where do hard-to-get items come from, and what is the NFT for?

**Question:** Items are valuable because they are hard to get. If nobody can mint for free, players grind until they earn a good item. Does LeaseKey really address renting those items, and what role does the NFT play?

**Answer:**

- **The renting problem is solved and proven.** An owner lends an item without handing it over and without collateral. The renter's key can only use it, it stops at expiry, and payment settles itself. This is covered by 16 sandbox tests and verified live on testnet.
- **Grinding is what creates the market.** Some players have time: they grind and earn rare drops. Others have little time, or are new. Renting connects them. The grinder earns from a rare item while they are offline, and the newcomer uses it for an hour instead of grinding for weeks or buying it outright. Supply caps keep earned items scarce, so they stay worth renting.
- **What the NFT does.**
  1. Proof the player owns the earned item, outside the game company's database.
  2. A standard any marketplace or tool, LeaseKey included, can read without the game building a rental system.
  3. Movable: it can be sold or lent, and LeaseKey lends it without moving it.

**Gap:** in the demo, items reach the demo owner through a seed script, not through play, so the "earned through grinding" step is simulated. Proposed fix: rare drops in the Arena. Defeating the King Slime has a small chance to mint a capped item to the player, signed by the game's key on a small server, the way a real game would do it.

## 18. If it is about money, why not just grind instead of renting?

**Answer:** for common items, players will grind, and those items rent cheaply for that reason. For the items that matter, grinding is not a real alternative:

1. **Capped items run out.** Once every edition of a type exists, grinding cannot produce another, and the contract enforces it. After that the only ways to use one are to buy it or rent it, and renting costs a small fraction of buying.
2. **Time has a price.** A rare drop can take weeks to grind, while an hour's rent costs cents. Time-rich and money-rich players trade with each other.
3. **Short-term needs.** A raid, a tournament, or trying a weapon before buying. Nobody grinds for weeks for one evening.
4. **Renting helps grinding.** A rented strong weapon makes grinding faster, so grinders are customers too.

**Design consequence:** rent should cost far less than the time to grind or the price to buy. The price suggestion already scales with scarcity, so the scarcest items cost the most to rent.

## 19. How does each item apply to its own specific game?

**Answer:** the item is bound to its game on chain, and the game decides what it does. LeaseKey never needs to understand a game's rules.

1. **The game defines the item type** once: name, art, supply cap and up to 8 stats under names the game chooses. A racing game might use speed and handling, an RPG attack and defence.
2. **The game is written into every item** at creation and cannot change.
3. **The game checks before honouring an item:** `canUse(item, player, { games: [itself] })` answers whether the player owns or rents it right now and whether it is one of the game's own.
4. **The game applies its own rules.** It reads the stats and grants the item's effects. When the lease ends the check fails and the game removes it.
5. **Usage is logged with the game's own action labels** through `use_item(action)`.

Consequences: an item from Game A does nothing in Game B unless B opts in by adding A to its accepted list. Wrapped NFTs stay linked to their original collection, and a game can find the wrapper of its own NFT with `find_wrapped`.

**Remaining gap:** the demo has one playable game. Ember Realms is a second collection without its own game, so cross-game rules are shown by the Arena refusing foreign items, not by a second game accepting its own.

## 20. The earning loop is now real

**Gap (from entry 17):** items reached players only through a seed script.

**Fix:** loot drops, fully on chain with no server. A renter who lands 20 on-chain strikes with a house item in one lease earns one roll (`claim_drop`). A win mints the next edition of a capped item type to the player, paid by the game's treasury. Scarcer types are less likely and a sold-out type can never drop. The winner owns the item and can rent it out. Test: `playing_earns_a_loot_roll_that_can_drop_a_capped_item`. Verified on testnet: a fresh player won Flame Sword edition 2 of 5.

**Limit:** the contract counts strikes, which proves paid play, not skill. A real game would sign drops from its server after judging the play.

## 21. How exactly is the NFT used in the project?

1. **Ownership record.** Each item is a NEP-171 token on the factory contract. The token says who owns the item, and standard wallets and explorers can read it.
2. **Control of the item's account.** Each token has a matching NEAR account that holds the rent and the lease. Whoever owns the token controls that account's listing and receives its earnings. Transferring the token hands all of that over, with any running lease intact.
3. **Scarcity.** Tokens are minted only as numbered editions of a capped type, so the token is the proof that an item is, say, 2 of 5.
4. **Game identity.** The token's record names the game that made it, which is how a game recognises its own items.
5. **Bridge to existing games.** A player can deposit any NEP-171 token from another collection, and LeaseKey issues a rentable token backed by it, redeemable for the original.

What the NFT is not used for: it is never transferred to a renter. Renting uses an access key on the item's account, and that is the whole point.

## 22. Isn't giving out items the game's job, not LeaseKey's?

**Answer:** yes. Games decide how items are earned and mint them to their players; only registered games can mint. LeaseKey never hands out items. It only makes the items games create rentable.

The loot roll is the demo game "LeaseKey Arena" rewarding its own players, as a stand-in for a partner game's boss drop or quest reward. It shows the full loop: a game rewards a player, the player owns a scarce item, the player rents it out.

**Fix:** the Arena panel, README and demo script now label it as the demo game's reward and state that handing out items is the game's job.

**Remaining gap:** the reward logic sits in the factory contract because the demo game shares the factory's account. The clean design is a separate game contract with its own account that calls the standard `mint`. That is a refactor for after the hackathon.

## 23. So how do items get onto LeaseKey, if players cannot mint?

Players never mint. Items arrive in two ways:

1. **A game mints to a player.** The game registers, defines capped item types with stats, and calls `mint` naming the player as owner whenever the player earns an item. A real game does this from its server through the SDK. The Game studio tab is the same call as a manual form.
2. **A player wraps an NFT they already own** from a game's existing collection. The original is held in escrow and returned on unwrap, so no new supply is created.

A player calling `mint` is rejected. Anyone can register a "game", but its items carry that game's name, are marked unverified, are hidden by default in the Armory, and are ignored by real games. A player's actions are: receive, wrap, list, rent, unlist.

## 24. Can items minted elsewhere be listed for rent?

**Answer:** yes, if the item is a standard NEP-171 NFT on NEAR. The owner wraps it under My Items: the original goes into escrow, a rentable item backed by it is created, and unwrapping returns the original when it is not on lease. Test: `wrap_any_nft_rent_it_then_unwrap_it`.

**Limits:**

- NEAR only. NFTs on Ethereum, Ronin, Immutable or Solana would need a cross-chain bridge, which is not built.
- The original game must honour the lease. It can find the wrapper of its own NFT with `findWrapped` and check access with `canUse`. Without that integration the lease is valid but the game ignores it.
- Stats are entered by the owner at wrap time. LeaseKey does not yet read them from the original NFT's metadata, so an owner could overstate them. A game should trust its own data for wrapped items.
- Wrapping costs about 0.16 NEAR for the item's account, refunded on failure.

## 25. Gap review of the last answers, and the fixes

A second look at entries 19 to 24 found three places where the answer was weaker than the claim.

**1. "Handing out items is the game's job" (entries 20 and 22).** The reward roll had only been relabelled; its logic still lived in LeaseKey's factory contract. **Fixed:** Slime Arena is now its own contract with its own account (`contracts/arena-game`). It is a registered game with its own capped reward types, it keeps its own list of games it honours, and it rewards players by calling the factory's ordinary `mint`, paid from its own balance. The factory no longer contains any reward logic. Test: `a_separate_game_contract_rewards_its_players_through_public_mint`, which also shows the arena refusing an item from a game it does not accept. Verified on testnet.

**2. "Items minted elsewhere can be listed" (entry 24).** The owner typed the wrapped item's power and stats, so they could overstate them. **Fixed:** the wrap message's power and stats are ignored. A wrapped item starts at base power with no stats, and only the account of the NFT's original collection can rate it, once (`rate_wrapped`). The Armory shows "Awaiting rating from its game" until then.

**3. "Real games already do this" (unlogged answer).** It was given from memory and the comparison was missing from the README. **Fixed:** the claims about ERC-4907, reNFT and Splinterlands were checked against public sources, and the README has a "How this compares" section. It also states what LeaseKey shares with those approaches: the game must integrate for a lease to matter.

**Also found while testing:** strikes sent in parallel could reach the network out of order and be rejected. The app and the SDK now resync and retry such a strike automatically.

**Still open after this review:**

- Slime Arena is one game. A second, different game would show cross-game rules from both sides.
- The factory account doubles as the launch collection "LeaseKey Originals", so the platform's admin key can still mint launch items.
- Only NEAR NFTs can be wrapped.

## 26. If wrapped items start at base power, how does a renter know which is better?

**Question:** LeaseKey only works for integrated games, so their items' stats should be known beforehand and applied when the owner lists the item, not left unrated.

**Answer:** agreed. "Base power until the game rates it" left renters unable to compare items.

**Fix:** catalogue-based wrapping.

- An integrated game publishes its catalogue once: an item type per kind of item, with name, art, power and stats.
- When a player wraps an NFT, LeaseKey asks the NFT's own collection what the item is (`nft_token`), finds the game's catalogue entry for that title, and applies the game's name, art, power and stats. The owner sets only the price.
- A collection that is not a registered game is refused, and so is an item the game has not catalogued. The NFT bounces back and the deposit is untouched.
- The wrap panel shows the game's stats for the item before the owner confirms.

Test: `wrap_any_nft_rent_it_then_unwrap_it`. Verified on testnet: an "Abyssal Trident" wrapped with a requested power of 99 received Ember Realms' catalogue stats instead.

## 27. So minting only ever creates items a game already defined?

**Answer:** yes. `mint` takes an item type and nothing else about the item. The name, art, power, stats and supply cap all come from the type the game defined in advance, and each mint creates the next numbered edition until the cap is reached. Nobody can generate a new kind of item for a game: only that game's own account can define its types, and nobody, the game included, can change a type afterwards.

## 28. The "Games your game accepts" field was confusing

**Fix:** the developer page's access check now has a "Game doing the check" dropdown with game names. Under it, the page states which games that game accepts. Slime Arena's list is read from its contract; any other game accepts only its own items.

## 29. Renting failed with "Exceeded 2 providers to execute request"

**Answer:** that message hid the real cause. The NEAR client's failover treats every error as a dead server, so when the chain answered "this account does not have enough balance", it tried the next server, got the same answer, and reported "Exceeded N providers". The guest that hit it had been funded with 0.5 NEAR by the guest bank and had spent down to 0.10 NEAR. A lease needs the rent, the 0.05 NEAR refundable gas budget, and about 0.1 NEAR of gas reserved up front (mostly refunded), so it did not fit. Loading every item's details at once also made public servers drop requests, which produced genuine "busy" failures on top.

**Fix:**
- Failover now moves to the next server only on network trouble. A real answer from the chain (low balance, a contract panic) is shown as is.
- Before any paid action the app checks the balance against deposit plus the gas reserve. Guests are refilled from the same guest bank that created them; wallet users get a plain "this needs about X NEAR" message.
- Reads are queued so at most four are in flight, and background refresh pauses while a transaction is being sent and runs every 15 seconds instead of 8.
- The deprecated `rpc.testnet.near.org` (always 429) was replaced by `rpc.testnet.fastnear.com`, and per-server retries were shortened so one bad server cannot stall a click.

Verified in the browser: the same guest at 0.10 NEAR was refilled, rented the Aegis Plate, and landed in the arena with no console errors.

## 30. What is "Settle the lease"?

**Answer:** when a lease's time runs out, the renter's key still exists on the item until someone closes the lease. Closing calls `end_rental`, which deletes the renter's key, pays the owner their rent, pays the game its royalty, refunds the renter's unused gas budget, and frees the item for the next renter. Anyone can call it, so an owner never depends on the renter showing up.

**Fix:** the wording. The buttons now say "Close lease and pay out" (item page), "Close lease and get paid" (owner) and "Close lease and get my refund" (renter), with one line explaining what happens. The arena closes guests' finished leases automatically, and `scripts/keeper.ts` closes any expired lease on a schedule.

## 31. "Internal server error" when closing a lease

**Answer:** the lease had closed. The public server failed while waiting for the result, after the transaction had already run on chain, so the error was about the server, not the action. Retrying blindly would be worse: a second attempt could run the action twice.

**Fix:** when renting or closing a lease ends in an error, the app asks the chain whether it happened (is this item now leased to me, or is the lease closed) before reporting anything. If it did, the user sees the success message. This also covers pressing "Close lease" on a lease that the arena or the keeper already closed. Automatic retries are now limited to explicit rate-limit refusals, which never reach the chain. "Internal server error" moves reads on to the next server.

Verified: an expired Aegis Plate lease closed from the item panel in about 5 seconds and split the rent between the owner (90%) and the game (10%).

## 32. Dragons flew too high for any attack to reach

**Fix:** a dragon now dives to just above head height as it passes over the hero to breathe fire, then climbs away. Every weapon can hit it while it is low: sword, hammer, shield bash and fists in melee, the wave as it passes under, and arrows and blaster shots aim ahead of it and fly over the slimes instead of being caught by them. Lightning and the beam reach it at any height. The arrival message says "Hit it when it swoops low".

## 33. The access check's player field looked fixed to my own account

**Fix:** "Player account" is now a list built from the chosen item: you, the current renter (when it is leased), the owner, a stranger, or "Type another account…". Trying each one shows who the game would let use the item.

## 34. The access check's game list was empty

**Fix:** the list was filled by one read of the game registry, and if a public server dropped that read it stayed empty. The list now fills straight away from the games the loaded items already name, and the registry and Slime Arena's rules are retried a few times. The item picker also selects the first item once items load, and copies of the same item are labelled by edition.

## 35. How does it work when a few people hold the same rare item?

**Answer:** every copy is its own edition, minted under the item type's supply cap ("Edition 2 of 5 ever made"), and every edition is its own NEAR account with its own owner. Each owner lists their copy independently, sets their own price, and earns from their own leases. Copies never share a lease, so two players can rent two copies of the same sword at the same time. The game sees the same item type and the same stats for every copy, because stats belong to the type, not to the owner. The cap is what keeps it rare: once all editions exist, no more can be made.

**Gap found:** the item page did not show the other copies, so a renter could not compare them.

**Fix:** the item page now lists "Other copies of this item" with edition, owner, price and status, available copies first, cheapest first. Clicking one opens it.

## 36. Games don't know how many weapons they will have; drops are random

**Answer:** right, and the chain does not need a count. Every copy is already its own token with its own ID and its own NEAR account, tied to whoever owns it, so ten players holding a "Goblin Axe" are ten different IDs with ten different owners. What a type fixes is only what the item *is* (look, power, stats), so nobody can mint a stronger fake.

**Fix:**
- No fixed count is now the default. A game defines a type without saying how many will exist (`max_supply: 0`) and mints a copy to a player each time one drops. Each copy is labelled "Copy #7 · 12 exist so far", and rent suggestions and rarity follow that live count.
- A fixed limit is optional ("Limited edition"), for items a game deliberately makes scarce, like a 1 of 1 legendary.
- `seal_supply` lets a game close the count later, for example at season end. It is one way: a sealed or limited type can never mint again or be raised.
- Common loot does not need to go on chain at all. Creating a copy costs about 0.16 NEAR of storage, so a game mints a drop when its player wants to rent it out; everything else stays in the game's own inventory.

Test: `open_supply_for_random_drops_then_seal_it`. Live on testnet: the factory reports `minted` for every item.

## 37. Judge review: questions a judge is likely to ask, and the gaps they exposed

Every question above came from trying the product. Read the same way a judge would, they point to a few more, and three of them exposed real gaps.

**"A lease expired and nobody closed it. Can I rent the item?"** It used to show only "Close lease", so the next renter had to settle a stranger's lease first. **Fix:** an expired item now shows "Rent it"; renting closes the old lease (paying its owner and game) and starts the new one in the same click. "Available now" includes these items. Verified on testnet with the Frost Bow, twice.

**"I paid for a lease, then switched phones or cleared my browser."** The play key lives in the browser, so the lease was stuck on one device. **Fix:** "Play on another device" in the Arena copies a link that carries only that lease's play key, in the URL fragment, which browsers never send to a server. Opening it stores the key and opens the Arena with the item. A leaked link can at most play out the rest of that lease. Without the link, the renter's own account can still return the item early for a refund. Verified: a tab with the key deleted got it back from the link.

**"Real drops have random stats. Are all copies of an item identical?"** They were. **Fix:** `mint` takes an optional roll for that copy. Each rolled stat must be a stat of the type and no higher than the type's value, so the type is the ceiling and no copy can be stronger than the item it is. The Studio has "Random drop: roll this copy's stats". Test: `drops_roll_their_own_stats_but_never_above_the_type`. Live on testnet.

Also hardened: every read now retries a few times when all public servers are busy, since a read changes nothing.

Questions with existing answers, now also in the README's "Questions you might ask": what the NFT does, fakes, common items, several owners of one item, renter keeping the item, owner pulling it, who settles, cross-game use, cost per item, and how LeaseKey makes money (it does not yet; a settlement fee is on the roadmap).

**Not fixed, on purpose:**
- Items run immutable code referenced by hash, so lease rules for existing items can never change under an owner or renter. The flip side is that item-level features (for example renter-side key rotation in the contract) only reach new items; the device link covers that need without a contract change.
- Retiring an item to recover its ~0.16 NEAR of storage is not built. Items are meant to live on.

## 38. Closing the three gaps left open in 37

**Business model.** Items created from now on pay LeaseKey 2% of earned rent at settlement, to the factory. The owner keeps the rest after the game's royalty, and renters pay nothing extra. Settlements report `protocol_cut`.

**Lost play key.** New items have `reset_key`: during an active lease the renter's own account swaps the play key for a new one with what is left of the gas budget, and the old key stops working at once. My Items shows "Get a new play key here" when the lease's key is in another browser. The device link from 37 still works for every item.

**Retiring an item.** `retire` on the factory, owner only, not while leased or owing payouts: the item account is deleted, its balance including the ~0.15 NEAR storage deposit goes to the owner, and the NFT is retired like an unwrapped one. Wrapped items keep using `unwrap`, which also returns the original NFT.

These live in the item contract, so they apply to items created after the new item code was published (global contract `4bDc4x…`). Earlier items keep the rules they were made with; the app explains this if someone tries.

Tests: `renter_resets_a_lost_key_then_owner_retires_the_item` plus the fee in the settlement tests and `split_math`; 20 sandbox tests pass. Live on testnet: `npx tsx scripts/lifecycle.ts` minted a Frost Bow copy, rented it, reset its key (new key plays, old key rejected), settled with the fee, and retired it, returning 0.149 NEAR to the owner.

## 39. "We should have an earning model"

**Answer:** LeaseKey now earns two ways, both enforced by contracts, and every party's share is visible.

| Who | Earns |
|---|---|
| Item owners | Rent from every lease, minus the game's royalty and LeaseKey's 2% |
| Games | The royalty they choose (up to 50%) on every lease of their items, in any game that honours them |
| LeaseKey | 2% of each rent at settlement (item code, from 38) and 0.01 NEAR per item created or wrapped (factory) |
| Renters | Pay rent and a refundable gas budget; no collateral and no fee on top |

The creation fee is part of `mint_deposit`, so games, the Arena's rewards and wrapping pay it automatically, and a failed creation refunds it with the rest. The factory counts it on chain: `get_earnings` returns the fee, the rental share and the totals. The developer page has a "Who earns what" calculator (items, price, hours leased, royalty) with the live counter. Test: the earnings assertions in `open_supply_for_random_drops_then_seal_it`.

Why these two: the rental share grows with real usage, and the creation fee grows with the catalogue, which covers LeaseKey's costs even before an item is first rented. Both are small enough that listing on LeaseKey stays cheaper than building a rental system.
