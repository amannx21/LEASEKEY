import { useEffect, useMemo, useState } from "react";
import { CLASSES, artUrl, lookOf, rarityOf, type ItemClass } from "./catalog";
import { GAS_BUDGET, fmtNear, sessionKeyFor, short, usableInArena, type ItemView } from "./near";
import { useChain } from "./store";
import { AccountLink, Countdown, Durability, Icon, StatBars, StatusBadge, statusOf } from "./ui";

const DURATIONS: [number, string][] = [
  [120, "2 min"],
  [300, "5 min"],
  [1800, "30 min"],
  [3600, "1 hour"],
];

type Sort = "power" | "price-asc" | "price-desc" | "popular";

export function Market() {
  const c = useChain();
  const [cls, setCls] = useState<ItemClass | "All">("All");
  const [sort, setSort] = useState<Sort>("power");
  const [onlyFree, setOnlyFree] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const [onlyVerified, setOnlyVerified] = useState(true);
  const me = c.me?.accountId;
  const [q, setQ] = useState("");

  // unlisted items show only to their owner; unverified games only on request
  const visible = useMemo(
    () => c.items.filter((i) => (i.listed || i.renter || i.owner === me) && (!onlyVerified || i.verified || i.owner === me)),
    [c.items, me, onlyVerified],
  );
  const counts = useMemo(() => {
    const m = new Map<string, number>([["All", visible.length]]);
    for (const i of visible) m.set(lookOf(i.image).cls, (m.get(lookOf(i.image).cls) ?? 0) + 1);
    return m;
  }, [visible]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = visible.filter(
      (i) =>
        (cls === "All" || lookOf(i.image).cls === cls) &&
        (!onlyFree || statusOf(i) === "available") &&
        (!onlyMine || i.owner === me || i.renter === me) &&
        (!term || i.name.toLowerCase().includes(term) || lookOf(i.image).homage.includes(term)),
    );
    const price = (i: ItemView) => BigInt(i.price_per_hour);
    return list.sort((a, b) => {
      if (sort === "power") return b.power - a.power;
      if (sort === "popular") return b.rental_count - a.rental_count;
      const d = price(a) - price(b);
      return (sort === "price-asc" ? 1 : -1) * (d > 0n ? 1 : d < 0n ? -1 : 0);
    });
  }, [visible, cls, sort, onlyFree, onlyMine, me, q]);

  const open = c.items.find((i) => i.account_id === c.openId) ?? null;

  return (
    <div className="armory">
      <header className="armory-head">
        <div>
          <h1>The Armory</h1>
          <p className="section-lede">
            Weapons and armour that rent themselves out. Pick one, choose how long, and fight. The item never leaves its
            owner.
          </p>
        </div>
        <div className="head-actions">
          <button className="ghost" onClick={() => c.setPage("mine")}>List your item</button>
        <label className="search">
          <Icon name="spark" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the armory" aria-label="Search items" />
        </label>
        </div>
      </header>

      <div className="toolbar" role="toolbar" aria-label="Filter items">
        <div className="chips">
          {(["All", ...CLASSES] as const).map((k) => (
            <button key={k} className={`chip ${cls === k ? "on" : ""}`} onClick={() => setCls(k)} disabled={!counts.get(k)}>
              {k === "All" ? "Everything" : k === "Armor" ? "Armour" : k}
              <span className="num">{counts.get(k) ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="tools">
          {me && (
            <label className="toggle">
              <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
              <span>Mine</span>
            </label>
          )}
          <label className="toggle" title="Only show items from games LeaseKey has verified">
            <input type="checkbox" checked={onlyVerified} onChange={(e) => setOnlyVerified(e.target.checked)} />
            <span>Verified games</span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} />
            <span>Available now</span>
          </label>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort items">
            <option value="power">Most powerful</option>
            <option value="price-asc">Cheapest first</option>
            <option value="price-desc">Priciest first</option>
            <option value="popular">Most rented</option>
          </select>
        </div>
      </div>

      {c.loading && <p className="muted">Reading the armory from NEAR testnet…</p>}
      {!c.loading && shown.length === 0 && (
        <div className="empty-inline">
          <p>Nothing matches. {onlyFree ? "Everything in this class is on lease right now." : "Try another class."}</p>
          <button className="ghost" onClick={() => { setCls("All"); setOnlyFree(false); setOnlyMine(false); setQ(""); }}>Show everything</button>
        </div>
      )}

      <div className="gallery">
        {shown.map((item) => <ItemCard key={item.account_id} item={item} me={me} onOpen={() => c.openItem(item.account_id)} />)}
      </div>

      {open && <ItemSheet item={open} onClose={() => c.openItem(null)} />}
    </div>
  );
}

function gameLabel(item: ItemView) {
  if (item.origin) return `${item.game_name ?? short(item.origin.contract)} · wrapped`;
  return item.game_name ?? "Unregistered game";
}

function ItemCard({ item, me, onOpen }: { item: ItemView; me?: string; onOpen: () => void }) {
  const look = lookOf(item.image);
  const r = rarityOf(item.power, item.max_supply);
  const status = statusOf(item);
  return (
    <button
      className={`item ${status}`}
      onClick={onOpen}
      style={{ ["--c1" as string]: look.colors[0], ["--c2" as string]: look.colors[1], ["--c3" as string]: look.colors[2] }}
    >
      <span className="item-art">
        <img src={artUrl(item.image)} alt="" loading="lazy" />
      </span>
      <span className="item-top">
        <span className="rarity" style={{ color: r.color }}>{r.name}</span>
        <span className="cls">{look.cls === "Armor" ? "Armour" : look.cls}</span>
      </span>
      <b className="item-name">{item.name}</b>
      {item.edition && item.max_supply ? (
        <span className="edition num">Edition {item.edition} of {item.max_supply}{item.max_supply === 1 ? ", the only one" : ""}</span>
      ) : item.origin ? (
        <span className="edition">{item.stats.length ? "Rated by its game" : "Awaiting rating from its game"} · original in escrow</span>
      ) : null}
      <span className="item-tag">{look.tagline}</span>
      <span className="item-meta">
        <span className={item.verified ? "verified" : "unverified"} title={item.verified ? "Verified LeaseKey partner game" : "This game is not verified by LeaseKey"}>
          {item.verified ? "✓ " : "Unverified · "}{gameLabel(item)}
        </span>
        <span className={item.owner === me ? "yours" : ""}>{item.owner === me ? "Yours" : `Owner ${short(item.owner)}`}</span>
      </span>
      {item.stats.length ? (
        <StatBars stats={item.stats} compact />
      ) : (
        <span className="item-power" aria-label={`Power ${item.power}`}>
          <span className="pw-track"><span style={{ width: `${Math.min(100, (item.power / 80) * 100)}%` }} /></span>
          <span className="num">{item.power}</span>
        </span>
      )}
      <span className="item-foot">
        <span><b className="num">{fmtNear(item.price_per_hour)}</b> NEAR / hr</span>
        {status === "rented" ? (
          <span className="badge rented"><Countdown endsAt={item.ends_at} /></span>
        ) : (
          <StatusBadge item={item} />
        )}
      </span>
    </button>
  );
}

function ItemSheet({ item, onClose }: { item: ItemView; onClose: () => void }) {
  const c = useChain();
  const look = lookOf(item.image);
  const r = rarityOf(item.power, item.max_supply);
  const status = statusOf(item);
  const mine = c.me?.accountId === item.owner;
  const iRent = c.me?.accountId === item.renter && !!sessionKeyFor(item);
  const options = DURATIONS.filter(([s]) => s <= Number(item.max_secs));
  const [secs, setSecs] = useState(120);
  const cost = (BigInt(item.price_per_hour) * BigInt(secs)) / 3600n;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="sheet-back" onClick={onClose}>
      <aside
        className="sheet"
        role="dialog"
        aria-label={item.name}
        onClick={(e) => e.stopPropagation()}
        style={{ ["--c1" as string]: look.colors[0], ["--c2" as string]: look.colors[1], ["--c3" as string]: look.colors[2] }}
      >
        <button className="close" onClick={onClose} aria-label="Close">×</button>
        <div className="sheet-art"><img src={artUrl(item.image)} alt={item.name} /></div>
        <div className="sheet-body">
          <p className="sheet-r"><span style={{ color: r.color }}>{r.name}</span> {look.cls === "Armor" ? "armour" : look.cls.toLowerCase()} · inspired by {look.homage}</p>
          <h2>{item.name}</h2>
          <p className="sheet-tag">{look.tagline}</p>

          {item.stats.length > 0 && (
            <div className="sheet-stats">
              <h3>{item.game_name ?? "Game"} stats</h3>
              <StatBars stats={item.stats} />
            </div>
          )}
          <dl className="stats">
            <div><dt>Power</dt><dd className="num">{item.power}</dd></div>
            <div><dt>Price</dt><dd><b className="num">{fmtNear(item.price_per_hour)}</b> NEAR / hr</dd></div>
            <div><dt>Durability</dt><dd><Durability item={item} /></dd></div>
            <div><dt>Leases so far</dt><dd className="num">{item.rental_count}</dd></div>
            <div><dt>Owner</dt><dd><AccountLink id={item.owner} />{mine && " (you)"}</dd></div>
            <div><dt>Its own account</dt><dd><AccountLink id={item.account_id} /></dd></div>
            <div><dt>Supply</dt><dd className="num">{item.max_supply ? `Edition ${item.edition} of ${item.max_supply} ever made` : item.origin ? "Set by its original collection" : "Unique"}</dd></div>
            <div><dt>Works in Slime Arena</dt><dd>{usableInArena(item) ? "Yes" : "No, it belongs to another game"}</dd></div>
            <div><dt>Game</dt><dd>{item.verified ? "✓ " : "Unverified · "}{item.origin ? <>Wrapped from <AccountLink id={item.origin.contract} /></> : item.game_name ?? "Unregistered"}</dd></div>
            {item.origin && <div><dt>Original NFT</dt><dd className="num">#{item.origin.token_id}, held in escrow</dd></div>}
          </dl>

          {status === "available" && !mine && (
            <div className="rent-box">
              <h3>Rent it</h3>
              <div className="seg" role="radiogroup" aria-label="Lease length">
                {options.map(([s, label]) => (
                  <button key={s} role="radio" aria-checked={s === secs} className={s === secs ? "on" : ""} onClick={() => setSecs(s)}>{label}</button>
                ))}
              </div>
              <table className="bill">
                <tbody>
                  <tr><td>Rent</td><td className="num">{fmtNear(cost, 5)} NEAR</td></tr>
                  <tr><td>Gas budget, unused part refunded</td><td className="num">{fmtNear(GAS_BUDGET)} NEAR</td></tr>
                  <tr><td>Collateral</td><td>none</td></tr>
                  <tr className="total"><td>You pay now</td><td className="num">{fmtNear(cost + GAS_BUDGET, 5)} NEAR</td></tr>
                </tbody>
              </table>
              {!c.me && <p className="warn">Choose “Play as guest” at the top right to get a free testnet account first.</p>}
              <button className="primary big wide" disabled={!c.me || !!c.busy}
                onClick={async () => { if (await c.rent(item, secs)) onClose(); }}>
                Rent and fight <Icon name="arrow" />
              </button>
              <p className="fine">The owner cannot cancel or revoke your lease. Return early any time for a refund of unused time.</p>
            </div>
          )}
          {status === "rented" && (
            <div className="rent-box">
              <p>On lease to <AccountLink id={item.renter!} /> for another <Countdown endsAt={item.ends_at} />.</p>
              {iRent && <button className="primary big wide" onClick={() => c.playWith(item.account_id)}>Fight with it</button>}
            </div>
          )}
          {status === "expired" && (
            <div className="rent-box">
              <p>Time is up. Close the lease to pay the owner and the game, refund the renter's unused gas budget, and free the item for the next renter. Anyone can do this.</p>
              <button className="primary wide" onClick={() => c.endRental(item)} disabled={!!c.busy}>Close lease and pay out</button>
            </div>
          )}
          {status === "available" && mine && <p className="muted">You own this item. Manage it under My Items.</p>}
          {(status === "unlisted" || status === "broken") && <p className="muted">Not available for rent right now.</p>}
        </div>
      </aside>
    </div>
  );
}
