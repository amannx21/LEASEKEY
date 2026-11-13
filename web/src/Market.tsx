import { useEffect, useMemo, useState } from "react";
import { CLASSES, artUrl, lookOf, rarityOf, type ItemClass } from "./catalog";
import { GAS_BUDGET, fmtNear, sessionKeyFor, type ItemView } from "./near";
import { useChain } from "./store";
import { AccountLink, Countdown, Durability, Icon, StatusBadge, statusOf } from "./ui";

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
  const [q, setQ] = useState("");

  const counts = useMemo(() => {
    const m = new Map<string, number>([["All", c.items.length]]);
    for (const i of c.items) m.set(lookOf(i.image).cls, (m.get(lookOf(i.image).cls) ?? 0) + 1);
    return m;
  }, [c.items]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = c.items.filter(
      (i) =>
        (cls === "All" || lookOf(i.image).cls === cls) &&
        (!onlyFree || statusOf(i) === "available") &&
        (!term || i.name.toLowerCase().includes(term) || lookOf(i.image).homage.includes(term)),
    );
    const price = (i: ItemView) => BigInt(i.price_per_hour);
    return list.sort((a, b) => {
      if (sort === "power") return b.power - a.power;
      if (sort === "popular") return b.rental_count - a.rental_count;
      const d = price(a) - price(b);
      return (sort === "price-asc" ? 1 : -1) * (d > 0n ? 1 : d < 0n ? -1 : 0);
    });
  }, [c.items, cls, sort, onlyFree, q]);

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
        <label className="search">
          <Icon name="spark" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the armory" aria-label="Search items" />
        </label>
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
          <button className="ghost" onClick={() => { setCls("All"); setOnlyFree(false); setQ(""); }}>Show everything</button>
        </div>
      )}

      <div className="gallery">
        {shown.map((item) => <ItemCard key={item.account_id} item={item} onOpen={() => c.openItem(item.account_id)} />)}
      </div>

      {open && <ItemSheet item={open} onClose={() => c.openItem(null)} />}
    </div>
  );
}

function ItemCard({ item, onOpen }: { item: ItemView; onOpen: () => void }) {
  const look = lookOf(item.image);
  const r = rarityOf(item.power);
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
      <span className="item-tag">{look.tagline}</span>
      <span className="item-power" aria-label={`Power ${item.power}`}>
        <span className="pw-track"><span style={{ width: `${Math.min(100, (item.power / 80) * 100)}%` }} /></span>
        <span className="num">{item.power}</span>
      </span>
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
  const r = rarityOf(item.power);
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

          <dl className="stats">
            <div><dt>Power</dt><dd className="num">{item.power}</dd></div>
            <div><dt>Price</dt><dd><b className="num">{fmtNear(item.price_per_hour)}</b> NEAR / hr</dd></div>
            <div><dt>Durability</dt><dd><Durability item={item} /></dd></div>
            <div><dt>Leases so far</dt><dd className="num">{item.rental_count}</dd></div>
            <div><dt>Owner</dt><dd><AccountLink id={item.owner} />{mine && " (you)"}</dd></div>
            <div><dt>Its own account</dt><dd><AccountLink id={item.account_id} /></dd></div>
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
              <p>The lease has ended. Anyone can settle it, which pays the owner and frees the item.</p>
              <button className="primary wide" onClick={() => c.endRental(item)} disabled={!!c.busy}>Settle the lease</button>
            </div>
          )}
          {status === "available" && mine && <p className="muted">You own this item. Manage it under My Items.</p>}
          {(status === "unlisted" || status === "broken") && <p className="muted">Not available for rent right now.</p>}
        </div>
      </aside>
    </div>
  );
}
