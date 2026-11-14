import { useEffect, useState } from "react";
import { ARENA_GAME, FACTORY_ID, view, type ItemRef, type ItemView } from "./near";
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
  "your-game-items.testnet", tokenId, { pricePerHour: 10n ** 23n },   // stats come from your catalogue
);
// Later, your game finds the wrapper of its own NFT:
const wrapped = await lk.findWrapped("your-game-items.testnet", tokenId);`;

const CUSTOM = "__custom__";
/** Public RPCs drop the odd request; try a read a few times before giving up. */
async function retry<T>(read: () => Promise<T>, tries = 4): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await read();
    } catch (e) {
      if (i >= tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
    }
  }
}
const STRANGER = "stranger.testnet";

export function Build() {
  const c = useChain();
  const [itemId, setItemId] = useState(c.items[0]?.account_id ?? "");
  const [player, setPlayer] = useState(c.me?.accountId ?? "");
  const [typing, setTyping] = useState(false);
  // Items load after the page opens: pick the first one once they arrive.
  useEffect(() => {
    if (c.items.length && !c.items.some((i) => i.account_id === itemId)) setItemId(c.items[0].account_id);
  }, [c.items, itemId]);
  // Ready-made players for the chosen item, so it is obvious the check works for anyone.
  const picked = c.items.find((i) => i.account_id === itemId);
  const playerChoices: [string, string][] = [];
  const addChoice = (id: string | null | undefined, label: string) => {
    if (id && !playerChoices.some(([x]) => x === id)) playerChoices.push([id, `${label}: ${id}`]);
  };
  addChoice(c.me?.accountId, "You");
  if (picked?.rental_active) addChoice(picked.renter, "Current renter");
  addChoice(picked?.owner, "Owner");
  addChoice(STRANGER, "A stranger");
  useEffect(() => {
    if (!typing && !playerChoices.some(([x]) => x === player)) setPlayer(playerChoices[0]?.[0] ?? "");
  }, [itemId, typing, c.me?.accountId]); // eslint-disable-line react-hooks/exhaustive-deps
  // The game doing the check, and the list of games it has chosen to accept.
  const [chainGames, setChainGames] = useState<{ account_id: string; name: string }[]>([]);
  // Until the registry answers, list the games the loaded items already name, so the picker is never empty.
  const allGames = chainGames.length ? chainGames : [
    ...new Map(c.items.filter((i) => i.game).map((i) => [i.game!, { account_id: i.game!, name: i.game_name || i.game! }])).values(),
    ...(ARENA_GAME && !c.items.some((i) => i.game === ARENA_GAME) ? [{ account_id: ARENA_GAME, name: "Slime Arena" }] : []),
  ];
  const [checker, setChecker] = useState(ARENA_GAME);
  const [accepts, setAccepts] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    retry(() => view<{ account_id: string; name: string }[]>(FACTORY_ID, "get_games"))
      .then((g) => live && g?.length && setChainGames(g), () => {});
    return () => { live = false; };
  }, []);
  useEffect(() => {
    // Slime Arena publishes its accepted list on chain. Any other game accepts only its own items by default.
    if (checker === ARENA_GAME) retry(() => view<{ accepted_games: string[] }>(ARENA_GAME, "get_rules")).then((r) => setAccepts(r.accepted_games), () => setAccepts([checker]));
    else setAccepts([checker]);
  }, [checker]);
  const nameOf = (id: string) => allGames.find((g) => g.account_id === id)?.name ?? id;
  const [result, setResult] = useState<string | null>(null);

  const check = async () => {
    setResult("Checking on testnet…");
    try {
      const [i, ref] = await Promise.all([
        view<ItemView>(itemId, "get_item"),
        view<ItemRef | null>(FACTORY_ID, "get_item_ref", { token_id: itemId.split(".")[0] }),
      ]);
      const game = ref?.game ?? null;
      if (!game || !accepts.includes(game)) {
        setResult(`No. ${i.name} belongs to ${ref?.game_name ?? game ?? "an unregistered game"}, and ${nameOf(checker)} does not accept that game's items.`);
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
              {c.items.map((i) => (
                <option key={i.account_id} value={i.account_id}>
                  {i.name}{i.max_supply && i.max_supply > 1 ? ` · edition ${i.edition} of ${i.max_supply}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>Player account
            <select value={typing ? CUSTOM : player} onChange={(e) => {
              const v = e.target.value;
              setTyping(v === CUSTOM);
              setPlayer(v === CUSTOM ? "" : v);
            }}>
              {playerChoices.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              <option value={CUSTOM}>Type another account…</option>
            </select>
            {typing && (
              <input autoFocus value={player} onChange={(e) => setPlayer(e.target.value.trim())} placeholder="any-account.testnet" />
            )}
          </label>
          <label>Game doing the check
            <select value={checker} onChange={(e) => setChecker(e.target.value)}>
              {allGames.map((g) => <option key={g.account_id} value={g.account_id}>{g.name}</option>)}
            </select>
          </label>
        </div>
        <p className="fine">
          {nameOf(checker)} accepts items from: {accepts.map(nameOf).join(", ") || "…"}.
          {checker === ARENA_GAME ? " It chose this list itself and stores it on chain." : " By default a game accepts only its own items."}
        </p>
        <button className="primary" onClick={check} disabled={!itemId || !player}>Can this player use it in {nameOf(checker)}?</button>
        {result && <p className="check-out" role="status">{result}</p>}
        <p className="fine">
          The SDK lives in <code>sdk/</code> of the repo. Run <code>npm run sdk:example</code> for a full rent, play and return
          against <AccountLink id={FACTORY_ID} />. The answers to common design questions are in <code>docs/DESIGN-QA.md</code>.
        </p>
      </section>
    </div>
  );
}
