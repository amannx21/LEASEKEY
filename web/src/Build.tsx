import { useState } from "react";
import { FACTORY_ID, HOUSE_GAME, view, type ItemRef, type ItemView } from "./near";
import { useChain } from "./store";
import { AccountLink } from "./ui";

const SNIPPET_RENT = `import { LeaseKey, LeaseSession } from "@leasekey/sdk";

const lk = new LeaseKey({ factoryId: "${FACTORY_ID}" });

// 1. Rent: the player's wallet signs once. The session key stays on the device.
const key = LeaseSession.generate();
const call = await lk.rentAction(itemId, key.getPublicKey().toString(), 120);
await wallet.signAndSendTransaction(call);           // any NEAR wallet
const session = lk.session(itemId, key.toString());

// 2. Play: every action is a transaction, with no wallet pop-up.
await session.use("slash");`;

const SNIPPET_CHECK = `// 3. Honour it: your game decides which items count.
const access = await lk.canUse(itemId, player, { games: ["your-game.testnet"] });
if (access.ok) equip(itemId, access.power, access.endsAt);`;

const SNIPPET_WRAP = `// Players can bring NFTs they already own in YOUR collection:
const [deposit, transfer] = await lk.wrapActions(
  "your-game-items.testnet", tokenId, { name: "Dragon Lance", pricePerHour: 10n ** 23n },
);
// Later, your game finds the wrapper of its own NFT:
const wrapped = await lk.findWrapped("your-game-items.testnet", tokenId);`;

export function Build() {
  const c = useChain();
  const [itemId, setItemId] = useState(c.items[0]?.account_id ?? "");
  const [player, setPlayer] = useState(c.me?.accountId ?? "");
  const [games, setGames] = useState(HOUSE_GAME);
  const [result, setResult] = useState<string | null>(null);

  const check = async () => {
    setResult("Checking on testnet…");
    try {
      const [i, ref] = await Promise.all([
        view<ItemView>(itemId, "get_item"),
        view<ItemRef | null>(FACTORY_ID, "get_item_ref", { token_id: itemId.split(".")[0] }),
      ]);
      const allowed = games.split(",").map((g) => g.trim()).filter(Boolean);
      const game = ref?.game ?? null;
      if (allowed.length && (!game || !allowed.includes(game))) {
        setResult(`No. ${i.name} belongs to ${ref?.game_name ?? game ?? "an unregistered game"}, which your game does not accept.`);
      } else if (i.renter === player && i.rental_active) {
        setResult(`Yes, as renter until ${new Date(Number(i.ends_at)).toLocaleTimeString()}. Power ${i.power}.`);
      } else if (i.owner === player && !i.renter) {
        setResult(`Yes, as owner. Power ${i.power}.`);
      } else {
        setResult(`No. ${i.renter ? "It is leased to someone else." : "This player neither owns nor rents it."}`);
      }
    } catch (e) {
      setResult(`Could not read that item: ${(e as Error).message.slice(0, 120)}`);
    }
  };

  return (
    <div className="build">
      <header>
        <h1>Add rentals to your game</h1>
        <p className="section-lede">
          LeaseKey is a rental layer for NEAR games. Your game keeps its own weapons, stats and rules. LeaseKey answers
          three questions: who owns this item, who may use it right now, and who gets paid.
        </p>
      </header>

      <section className="build-steps">
        <div>
          <h2>Rent and play</h2>
          <p className="muted">
            The renter's key can only call <code>use_item</code> on that one item account. Expiry, payment and your
            royalty are enforced on chain.
          </p>
          <pre><code>{SNIPPET_RENT}</code></pre>
        </div>
        <div>
          <h2>Decide what counts</h2>
          <p className="muted">
            Every item records the game that made it, or the collection it was wrapped from. Your game honours its own
            items by default, and can opt in to a partner's.
          </p>
          <pre><code>{SNIPPET_CHECK}</code></pre>
          <h2>Bring existing NFTs</h2>
          <p className="muted">Already have an NFT collection? Players wrap their items and rent them out. Unwrapping returns the original.</p>
          <pre><code>{SNIPPET_WRAP}</code></pre>
        </div>
      </section>

      <section className="panel checker">
        <h3>Try the access check live</h3>
        <div className="checker-grid">
          <label>Item account
            <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
              {c.items.map((i) => <option key={i.account_id} value={i.account_id}>{i.name}</option>)}
            </select>
          </label>
          <label>Player account<input value={player} onChange={(e) => setPlayer(e.target.value)} placeholder="player.testnet" /></label>
          <label>Games your game accepts<input value={games} onChange={(e) => setGames(e.target.value)} placeholder="comma separated, blank for any" /></label>
        </div>
        <button className="primary" onClick={check} disabled={!itemId || !player}>Can this player use it?</button>
        {result && <p className="check-out" role="status">{result}</p>}
        <p className="fine">
          The SDK lives in <code>sdk/</code> of the repo. Run <code>npm run sdk:example</code> for a full rent, play and return
          against <AccountLink id={FACTORY_ID} />. The answers to common design questions are in <code>docs/DESIGN-QA.md</code>.
        </p>
      </section>
    </div>
  );
}
