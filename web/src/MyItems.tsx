import { useCallback, useEffect, useState } from "react";
import { ART_KEYS, artUrl, lookOf } from "./catalog";
import {
  DEMO_COLLECTION, FACTORY_ID, TGAS, call, fmtNear, parseNear, sessionKeyFor, suggestedPrice, view,
  type ItemView, type Settlement,
} from "./near";
import { useChain } from "./store";
import { AccountLink, Countdown, Durability, Icon, StatBars, StatusBadge, statusOf } from "./ui";

type Tab = "own" | "rent" | "wrap" | "studio";

export function MyItems() {
  const c = useChain();
  const [tab, setTab] = useState<Tab>("own");
  if (!c.me) {
    return (
      <section className="empty">
        <h2>My Items</h2>
        <p>Choose “Play as guest” or connect a wallet to see items you own or rent.</p>
        <button className="primary" onClick={c.guestLogin} disabled={!!c.busy}>Play as guest</button>
      </section>
    );
  }
  const me = c.me.accountId;
  const owned = c.items.filter((i) => i.owner === me);
  const rented = c.items.filter((i) => i.renter === me);
  const total = owned.reduce((sum, i) => sum + BigInt(i.owner_earnings), 0n);

  const tabs: [Tab, string, number | null][] = [
    ["own", "Items I own", owned.length],
    ["rent", "Items I rent", rented.length],
    ["wrap", "Bring an item from another game", null],
    ["studio", "Game studio", null],
  ];

  return (
    <div className="mine">
      <header className="mine-head">
        <div>
          <h1>My Items</h1>
          <p className="section-lede">
            Earned so far: <b className="num">{fmtNear(total, 4)} NEAR</b>. Rent is paid to you automatically when a lease
            settles.
          </p>
        </div>
      </header>
      <div className="chips" role="tablist">
        {tabs.map(([t, label, n]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`chip ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
            {label}{n !== null && <span className="num">{n}</span>}
          </button>
        ))}
      </div>

      <div className="mine-body">
        {tab === "own" && (
          <>
            {owned.length === 0 && (
              <div className="empty-inline">
                <p>You own no items yet. Items come from games, or you can bring one you already own from another game.</p>
                <button className="primary" onClick={() => setTab("wrap")}>Bring an item from another game</button>
              </div>
            )}
            {owned.map((item) => <OwnedRow key={item.account_id} item={item} />)}
          </>
        )}
        {tab === "rent" && (
          <>
            {rented.length === 0 && (
              <div className="empty-inline">
                <p>No active leases.</p>
                <button className="primary" onClick={() => c.setPage("market")}>Find something to rent</button>
              </div>
            )}
            {rented.map((item) => <RentedRow key={item.account_id} item={item} />)}
          </>
        )}
        {tab === "wrap" && <WrapPanel onDone={() => setTab("own")} />}
        {tab === "studio" && <StudioPanel />}
      </div>
    </div>
  );
}

function OwnedRow({ item }: { item: ItemView }) {
  const c = useChain();
  const status = statusOf(item);
  const [price, setPrice] = useState(fmtNear(item.price_per_hour, 4));
  const act = (label: string, method: string, args: Record<string, unknown> = {}, deposit = 0n) =>
    c.run(label, (me) => call(me, item.account_id, method, args, deposit));

  return (
    <div className="row">
      <img src={artUrl(item.image)} alt="" />
      <div className="row-main">
        <div className="row-title">
          <b>{item.name}</b> <StatusBadge item={item} />
        </div>
        <p className="row-game">
          {item.origin ? (
            <>Wrapped from {item.game_name ?? "another game"} (<AccountLink id={item.origin.contract} /> #{item.origin.token_id})</>
          ) : (
            <>From {item.game_name ?? "an unregistered game"}</>
          )}
          {" · "}<AccountLink id={item.account_id} />
        </p>
        <div className="stats">
          <span>Earned <b className="num">{fmtNear(item.owner_earnings, 4)}</b> NEAR</span>
          <span>{item.rental_count} {item.rental_count === 1 ? "lease" : "leases"}</span>
          <span>{item.total_uses} uses</span>
          <Durability item={item} />
        </div>
        {status === "rented" && (
          <p className="lease">
            Leased to <AccountLink id={item.renter!} /> · <Countdown endsAt={item.ends_at} /> left · escrowed rent{" "}
            {fmtNear(item.rent_paid, 4)} NEAR. You cannot unlist, revoke or unwrap until it ends.
          </p>
        )}
      </div>
      <div className="row-actions">
        {status === "expired" && (
          <button className="primary" onClick={() => c.endRental(item)} disabled={!!c.busy}>Settle and get paid</button>
        )}
        {(status === "available" || status === "unlisted") && (
          <>
            <label className="inline">
              <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" aria-label="Price per hour" />
              <span>NEAR/hr</span>
            </label>
            <button
              className="link"
              title="Based on how many of this item can ever exist and its power"
              onClick={() => setPrice(fmtNear(suggestedPrice(item.power, item.max_supply), 4))}
            >
              Suggest {fmtNear(suggestedPrice(item.power, item.max_supply), 3)}
              {item.max_supply ? ` · ${item.max_supply === 1 ? "only one exists" : `${item.max_supply} exist`}` : ""}
            </button>
            <button disabled={!!c.busy} onClick={() => act("Listing…", "list", { price_per_hour: parseNear(price).toString() })}>
              {item.listed ? "Update price" : "List for rent"}
            </button>
            {item.listed && (
              <button className="ghost" disabled={!!c.busy} onClick={() => act("Unlisting…", "unlist")}>Unlist</button>
            )}
          </>
        )}
        {item.origin && !item.renter && (
          <button
            className="ghost"
            disabled={!!c.busy}
            title="Get the original NFT back. Only possible while the item is not on lease."
            onClick={() =>
              c.run("Unwrapping…", async (me) => {
                await call(me, FACTORY_ID, "unwrap", { token_id: item.token_id }, 1n, 150n * TGAS);
                c.toast("ok", `${item.name} is back in your ${item.origin!.contract} inventory.`);
              })}
          >
            Unwrap
          </button>
        )}
        {status === "rented" && (
          <button className="ghost" disabled={!!c.busy} onClick={() => act("Trying to unlist…", "unlist")}>
            Try to unlist (will be rejected)
          </button>
        )}
        {!item.renter && item.durability < item.max_durability && (
          <button
            className="ghost"
            disabled={!!c.busy}
            onClick={() => act("Repairing…", "repair", {}, BigInt(item.max_durability - item.durability) * 10n ** 20n)}
          >
            Repair ({fmtNear(BigInt(item.max_durability - item.durability) * 10n ** 20n, 4)} NEAR)
          </button>
        )}
      </div>
    </div>
  );
}

function RentedRow({ item }: { item: ItemView }) {
  const c = useChain();
  const status = statusOf(item);
  const hasKey = !!sessionKeyFor(item);
  return (
    <div className="row">
      <img src={artUrl(item.image)} alt="" />
      <div className="row-main">
        <div className="row-title">
          <b>{item.name}</b> <StatusBadge item={item} />
        </div>
        <p className="row-game">Owned by <AccountLink id={item.owner} /></p>
        <div className="stats">
          {status === "rented" && <span><Countdown endsAt={item.ends_at} /> left</span>}
          <span>{item.uses} uses · {item.uses_left} left in gas budget</span>
          <span>Rent paid {fmtNear(item.rent_paid, 4)} NEAR</span>
        </div>
        {!hasKey && <p className="warn">The session key for this lease is in another browser.</p>}
      </div>
      <div className="row-actions">
        {status === "rented" && hasKey && (
          <button className="primary" onClick={() => c.playWith(item.account_id)}>Fight</button>
        )}
        {status === "rented" && (
          <button
            disabled={!!c.busy}
            onClick={() =>
              c.run("Extending lease…", (me) =>
                call(me, item.account_id, "extend", { extra_secs: "300" }, (BigInt(item.price_per_hour) * 300n) / 3600n + 1n))}
          >
            Extend 5 min
          </button>
        )}
        {status === "rented" && (
          <button
            disabled={!!c.busy}
            onClick={async () => {
              const s = await c.run("Returning early…", (me) => call<Settlement>(me, item.account_id, "return_early"));
              if (s) c.toast("ok", `Returned early. Refund ${fmtNear(s.renter_refund, 4)} NEAR for unused time and gas.`);
            }}
          >
            Return early
          </button>
        )}
        {status === "expired" && <button onClick={() => c.endRental(item)} disabled={!!c.busy}>Settle lease</button>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- wrapping

type Nft = { token_id: string; metadata?: { title?: string; media?: string } };
type CatalogEntry = { type_id: string; name: string; image: string; power: number; stats: { name: string; value: number }[] };
/** Same slug rule as the contract: a game's catalogue id is the slug of the NFT's title. */
const slugOf = (s: string) => {
  let out = "";
  for (const ch of s.toLowerCase()) {
    if (/[a-z0-9]/.test(ch)) out += ch;
    else if (out && !out.endsWith("-")) out += "-";
    if (out.length >= 24) break;
  }
  return out.replace(/-+$/, "") || "item";
};

const EMBER_RELICS = [
  ["Ember Greataxe", "flame-sword"],
  ["Abyssal Trident", "tide-trident"],
  ["Starforged Gauntlet", "astral-gauntlet"],
  ["Halo of the Seraph", "seraph-helm"],
] as const;

function WrapPanel({ onDone }: { onDone: () => void }) {
  const c = useChain();
  const me = c.me!.accountId;
  const [collection, setCollection] = useState(DEMO_COLLECTION);
  const [nfts, setNfts] = useState<Nft[] | null>(null);
  const [pick, setPick] = useState<Nft | null>(null);
  const [price, setPrice] = useState("0.08");
  // The game's catalogue: what each of its items is, with stats. Null when the collection is not integrated.
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null);
  const [gameName, setGameName] = useState<string | null>(null);
  useEffect(() => {
    setCatalog(null);
    setGameName(null);
    if (!collection) return;
    view<{ name: string } | null>(FACTORY_ID, "get_game", { account_id: collection }).then(async (g) => {
      if (!g) return;
      setGameName(g.name);
      const types = await view<CatalogEntry[]>(FACTORY_ID, "get_item_types", { game: collection });
      const withStats = await Promise.all(types.map(async (t) => ({
        ...t, stats: await view<{ name: string; value: number }[]>(FACTORY_ID, "get_type_stats", { game: collection, type_id: t.type_id }),
      })));
      setCatalog(withStats);
    }, () => {});
  }, [collection]);
  const entry = pick ? catalog?.find((t) => t.type_id === slugOf(pick.metadata?.title ?? "")) ?? null : null;

  const load = useCallback(async () => {
    setNfts(null);
    try {
      setNfts(await view<Nft[]>(collection, "nft_tokens_for_owner", { account_id: me, limit: 50 }));
    } catch {
      setNfts([]);
    }
  }, [collection, me]);
  useEffect(() => { if (collection) load(); }, [load, collection]);

  const claim = async (title: string, look: string) => {
    await c.run(`Claiming ${title}…`, (who) =>
      call(who, DEMO_COLLECTION, "claim", { title, media: `${look}.svg` }, 2n * 10n ** 22n));
    await load();
  };

  const wrap = async () => {
    if (!pick) return;
    const ok = await c.run(`Wrapping ${pick.metadata?.title}…`, async (who) => {
      const deposit = BigInt(await view<string>(FACTORY_ID, "mint_deposit"));
      const credit = BigInt(await view<string>(FACTORY_ID, "get_wrap_credit", { account_id: who.accountId }));
      if (credit < deposit) await call(who, FACTORY_ID, "deposit_for_wrap", {}, deposit - credit, 10n * TGAS);
      await call(who, collection, "nft_transfer_call", {
        receiver_id: FACTORY_ID,
        token_id: pick.token_id,
        msg: JSON.stringify({ price_per_hour: parseNear(price).toString(), royalty_bps: 500 }),
      }, 1n, 150n * TGAS);
      return true;
    });
    if (ok) {
      c.toast("ok", "Wrapped. The original is held in escrow and your item has its own rentable account. List it to earn.");
      onDone();
    }
  };

  return (
    <div className="wrap-grid">
      <section className="panel">
        <h3>Bring an item you already own</h3>
        <p className="muted">
          Pick an item you own in a game that is integrated with LeaseKey. LeaseKey holds it in escrow and gives it its own rentable account, with the stats that game defined.
          Unwrap it any time it is not on lease to get the original back. Costs about 0.16 testnet NEAR, refunded if
          anything fails.
        </p>
        <label>Game collection contract
          <input value={collection} onChange={(e) => setCollection(e.target.value.trim())} placeholder="game-items.testnet" />
        </label>
        {nfts === null && <p className="muted">Reading your inventory…</p>}
        {nfts && nfts.length === 0 && <p className="muted">You own nothing in this collection yet.</p>}
        <div className="nft-pick">
          {nfts?.map((n) => (
            <button key={n.token_id} className={pick?.token_id === n.token_id ? "on" : ""}
              onClick={() => setPick(n)}>
              <img src={artUrl(n.metadata?.media ?? "")} alt="" />
              <span>{n.metadata?.title ?? `#${n.token_id}`}</span>
            </button>
          ))}
        </div>
        {collection && !gameName && (
          <p className="warn">This collection is not integrated with LeaseKey yet, so its items cannot be rented here.</p>
        )}
        {pick && gameName && !entry && (
          <p className="warn">{gameName} has not added “{pick.metadata?.title}” to its catalogue yet, so it cannot be wrapped.</p>
        )}
        {pick && entry && (
          <div className="wrap-form">
            <div className="sheet-stats">
              <h3>{entry.name}, as defined by {gameName}</h3>
              <StatBars stats={entry.stats} />
            </div>
            <label>Your price per hour (NEAR)<input value={price} inputMode="decimal" onChange={(e) => setPrice(e.target.value)} /></label>
            <p className="fine">
              You only set the price. The name, art, power and stats come from {gameName}'s own catalogue, so every
              renter sees the real item.
            </p>
            <button className="primary big wide" disabled={!!c.busy} onClick={wrap}>Wrap and make rentable <Icon name="arrow" /></button>
            <p className="fine">Two signatures: a refundable deposit for the item's account, then the NFT transfer into escrow.</p>
          </div>
        )}
      </section>

      {DEMO_COLLECTION && collection === DEMO_COLLECTION && (
        <aside className="panel">
          <h3>Try it with Ember Realms</h3>
          <p className="muted">
            Ember Realms is a stand-in for another game's item collection on testnet. Claim a free item into your
            inventory there, then wrap it here.
          </p>
          <div className="claim-list">
            {EMBER_RELICS.map(([title, look]) => (
              <button key={title} disabled={!!c.busy} onClick={() => claim(title, look)}>
                <img src={`/items/${look}.svg`} alt="" /> Claim {title}
              </button>
            ))}
          </div>
        </aside>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ studio

function StudioPanel() {
  const c = useChain();
  const me = c.me!.accountId;
  const [game, setGame] = useState<{ name: string } | null | undefined>(undefined);
  const [gameName, setGameName] = useState("");

  const load = useCallback(() => view<{ name: string } | null>(FACTORY_ID, "get_game", { account_id: me }).then(setGame, () => setGame(null)), [me]);
  useEffect(() => { load(); }, [load]);

  if (game === undefined) return <p className="muted">Checking your studio…</p>;

  if (!game) {
    return (
      <section className="panel studio">
        <h3>Register your game</h3>
        <p className="muted">
          Only registered games can create items. Your account becomes the game: it mints items to players, earns a
          royalty on every rental, and is shown on every item it makes. Players cannot mint copies of your items.
        </p>
        <label>Game name<input value={gameName} maxLength={40} onChange={(e) => setGameName(e.target.value)} placeholder="My Fantasy Game" /></label>
        <button className="primary" disabled={!!c.busy || !gameName.trim()}
          onClick={async () => { await c.run("Registering…", (who) => call(who, FACTORY_ID, "register_game", { name: gameName }, 10n ** 22n)); load(); }}>
          Register for 0.01 NEAR
        </button>
      </section>
    );
  }

  return <Studio gameName={game.name} me={me} />;
}

type ItemType = { type_id: string; name: string; image: string; power: number; max_supply: number; minted: number };

function Studio({ gameName, me }: { gameName: string; me: string }) {
  const c = useChain();
  const [types, setTypes] = useState<ItemType[]>([]);
  const [name, setName] = useState("Ember Blade");
  const [art, setArt] = useState("flame-sword");
  const [power, setPower] = useState(35);
  const [supply, setSupply] = useState(5);
  const [pick, setPick] = useState("");
  const [player, setPlayer] = useState("");
  const [royalty, setRoyalty] = useState(10);

  const load = useCallback(
    () => view<ItemType[]>(FACTORY_ID, "get_item_types", { game: me }).then((t) => { setTypes(t); setPick((p) => p || t[0]?.type_id || ""); }, () => setTypes([])),
    [me],
  );
  useEffect(() => { load(); }, [load]);

  const define = async () => {
    await c.run(`Defining ${name}…`, (who) =>
      call(who, FACTORY_ID, "define_item_type", { type_id: name, name, image: `${art}.svg`, power, max_supply: supply }, 10n ** 22n));
    await load();
  };

  const chosen = types.find((t) => t.type_id === pick);
  const mint = () =>
    c.run(`Minting ${chosen?.name}…`, async (who) => {
      const deposit = BigInt(await view<string>(FACTORY_ID, "mint_deposit"));
      const owner = player.trim() || me;
      const minted = await call<{ token_id: string; item_account: string; edition: number } | null>(who, FACTORY_ID, "mint", {
        args: {
          item_type: pick, price_per_hour: suggestedPrice(chosen!.power, chosen!.max_supply).toString(), max_secs: "7200",
          royalty_bps: Math.round(royalty * 100), owner,
        },
      }, deposit, 150n * TGAS);
      if (!minted) throw new Error("mint failed, deposit refunded");
      if (owner === me) await call(who, minted.item_account, "list", {});
      c.toast("ok", `${chosen!.name} edition ${minted.edition} of ${chosen!.max_supply} minted to ${owner}.`);
      await load();
    });

  return (
    <div className="wrap-grid">
      <section className="panel studio">
        <h3>1. Define an item type</h3>
        <p className="muted">
          Decide once what this item is and how many can ever exist. The chain enforces the cap and the power, and the
          type can never be edited, not even by you. Scarcer items rent for more.
        </p>
        <label>Item name<input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></label>
        <label>Look</label>
        <div className="art-pick">
          {ART_KEYS.map((a) => (
            <button key={a} className={a === art ? "on" : ""} onClick={() => setArt(a)} title={lookOf(`${a}.svg`).tagline}>
              <img src={`/items/${a}.svg`} alt={a} />
            </button>
          ))}
        </div>
        <label>Power: {power}<input type="range" min={5} max={80} value={power} onChange={(e) => setPower(Number(e.target.value))} /></label>
        <label>Only {supply} will ever exist<input type="range" min={1} max={50} value={supply} onChange={(e) => setSupply(Number(e.target.value))} /></label>
        <p className="fine">Suggested rent: {fmtNear(suggestedPrice(power, supply), 3)} NEAR per hour.</p>
        <button className="primary" disabled={!!c.busy || !name.trim()} onClick={define}>Define for 0.01 NEAR</button>
      </section>

      <section className="panel studio">
        <h3>2. Mint to a player</h3>
        <p className="muted">{gameName} item types and how many of each exist so far.</p>
        {types.length === 0 && <p className="muted">No item types yet. Define one first.</p>}
        <div className="type-list">
          {types.map((t) => (
            <button key={t.type_id} className={pick === t.type_id ? "on" : ""} onClick={() => setPick(t.type_id)} disabled={t.minted >= t.max_supply}>
              <img src={artUrl(t.image)} alt="" />
              <span><b>{t.name}</b><small className="num">{t.minted} of {t.max_supply} minted · power {t.power}</small></span>
            </button>
          ))}
        </div>
        {chosen && (
          <>
            <label>Give it to player (account ID, blank for yourself)<input value={player} onChange={(e) => setPlayer(e.target.value)} placeholder="player.testnet" /></label>
            <label>Your royalty on every rental: {royalty}%<input type="range" min={0} max={30} value={royalty} onChange={(e) => setRoyalty(Number(e.target.value))} /></label>
            <button className="primary" disabled={!!c.busy || chosen.minted >= chosen.max_supply} onClick={mint}>
              {chosen.minted >= chosen.max_supply ? "Sold out: the cap is reached" : `Mint edition ${chosen.minted + 1} of ${chosen.max_supply}`}
            </button>
          </>
        )}
      </section>
    </div>
  );
}
