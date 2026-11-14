import { useEffect, useMemo, useRef, useState } from "react";
import { CLASSES, artUrl, lookOf, rarityOf, type ItemClass } from "./catalog";
import { FACTORY_ID, fmtNear, short, view, type ItemView } from "./near";
import { HeroSnap } from "./HeroSnap";
import { useChain } from "./store";
import { AccountLink, Icon, statusOf } from "./ui";

/** Adds `in` to an element once it scrolls into view, for one-shot reveals. */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && (setShown(true), io.disconnect()), {
      threshold: 0.25,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, shown] as const;
}

type GameInfo = { account_id: string; name: string };

export function Home() {
  const c = useChain();
  const [games, setGames] = useState<GameInfo[]>([]);
  useEffect(() => {
    view<GameInfo[]>(FACTORY_ID, "get_games").then(setGames, () => setGames([]));
  }, []);
  return (
    <div className="home">
      <HeroSnap onEnter={() => c.setPage("market")} onArena={() => c.setPage("arena")} />
      <Problem />
      <Flow />
      <GameBound items={c.items} games={games} />
      <Guarantees />
      <Partners items={c.items} games={games} onPartner={() => c.setPage("build")} />
      <Economy items={c.items} />
      <Featured items={c.items} onOpen={(id) => c.openItem(id)} onAll={() => c.setPage("market")} />
    </div>
  );
}

// ---------------------------------------------------------------- problem

function Problem() {
  const [ref, shown] = useReveal<HTMLElement>();
  return (
    <section ref={ref} className={`problem ${shown ? "in" : ""}`}>
      <h2>Lending in-game items has always meant trusting a stranger.</h2>
      <p className="section-lede">
        In blockchain games, players truly own their items. That is exactly what makes lending them risky.
      </p>
      <div className="problem-grid">
        <div className="old">
          <h3>Until now, an owner could</h3>
          <p>
            <b>Hand the item over</b> and hope it comes back. Scholarship programs lost items and earnings this way.
          </p>
          <p>
            <b>Demand collateral</b> worth the whole item. That shuts out exactly the players who cannot afford it.
          </p>
        </div>
        <div className="new">
          <h3>With LeaseKey</h3>
          <p>
            The item stays with its owner. The renter gets a <b>key that can only use it in the game</b>, until the clock
            runs out.
          </p>
          <p>
            No collateral and no trust. When time is up, anyone can close the lease, and the rent splits itself between
            the owner and the game.
          </p>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------- flow

const STEPS = [
  { name: "Arrive", text: "A partner game mints the item to a player, or a player wraps an NFT they already own. Either way it gets its own account." },
  { name: "List", text: "The owner sets a price per hour. The item waits in the armory, labelled with its game." },
  { name: "Rent", text: "A renter pays rent plus a small refundable gas budget. No collateral." },
  { name: "Play", text: "The item adds a key for the renter's device that can only call use_item. The game checks the item is one of its own." },
  { name: "Settle", text: "When time is up the key is deleted. Rent splits between the owner and the game's royalty." },
];

function Flow() {
  const [ref, shown] = useReveal<HTMLElement>();
  return (
    <section ref={ref} className={`flow ${shown ? "in" : ""}`} id="how">
      <h2>How a lease works</h2>
      <p className="section-lede">Five steps, all on NEAR testnet, none of them needing trust.</p>
      <div className="flow-track">
        <div className="flow-line"><span className="flow-key"><Icon name="key" size={20} /></span></div>
        <ol>
          {STEPS.map((s, i) => (
            <li key={s.name} style={{ ["--i" as string]: i }}>
              <span className="flow-dot" />
              <h3>{s.name}</h3>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// ------------------------------------------------------------- guarantees

function Guarantees() {
  const [ref, shown] = useReveal<HTMLElement>();
  const yes = ["Use the item in its game", "Play without a wallet pop-up on every action", "Return early and get unused time back"];
  const no = ["Transfer or sell the item", "Withdraw the item's earnings", "Call any other contract", "Keep playing after the lease ends"];
  const game = ["Mint past an item's supply cap", "Mint a stronger copy than the type allows", "Change an item type once it exists"];
  const owner = ["Cancel or unlist mid-lease", "Revoke the renter's key", "Unwrap the original NFT mid-lease", "Burn the item"];
  return (
    <section ref={ref} className={`guarantees ${shown ? "in" : ""}`}>
      <h2>Enforced by the chain, not by promises</h2>
      <div className="guar-grid">
        <div className="guar yes">
          <h3><Icon name="key" /> The renter's key can</h3>
          <ul>{yes.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
        <div className="guar no">
          <h3><Icon name="lock" /> The renter's key can never</h3>
          <ul>{no.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
        <div className="guar no">
          <h3><Icon name="shield" /> The owner can never</h3>
          <ul>{owner.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
        <div className="guar no">
          <h3><Icon name="spark" /> Even the game can never</h3>
          <ul>{game.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------- items know games

function GameBound({ items, games }: { items: ItemView[]; games: GameInfo[] }) {
  const [ref, shown] = useReveal<HTMLElement>();
  const byGame = games
    .map((g) => ({ ...g, items: items.filter((i) => i.game === g.account_id) }))
    .filter((g) => g.items.length);
  const home = byGame[0];
  const other = byGame.find((g) => g.account_id !== home?.account_id);
  const homeItem = home?.items[0];
  const otherItem = other?.items[0];

  return (
    <section ref={ref} className={`gamebound ${shown ? "in" : ""}`}>
      <h2>Every item knows which game it belongs to</h2>
      <p className="section-lede">
        Only registered games can create items. Each game defines an item type once, with its power and a hard cap on
        how many can ever exist, and the chain enforces it. The game is written into every item and can never change,
        so nobody can mint a stronger or extra copy and pass it off as the real thing.
      </p>

      <div className="gb-grid">
        <div className="gb-games">
          {byGame.map((g) => (
            <div key={g.account_id} className="gb-game">
              <div className="gb-head">
                <b>{g.name}</b>
                <AccountLink id={g.account_id} />
              </div>
              <div className="gb-items">
                {g.items.slice(0, 8).map((i) => (
                  <img key={i.account_id} src={artUrl(i.image)} alt={i.name} title={i.name} />
                ))}
                {g.items.length > 8 && <span className="num">+{g.items.length - 8}</span>}
              </div>
              <small>
                {g.items.length} {g.items.length === 1 ? "item" : "items"}
                {g.items.some((i) => i.origin) && " · includes NFTs wrapped from this game's own collection"}
              </small>
            </div>
          ))}
        </div>

        <div className="gb-rules">
          <h3>What a game accepts is its own choice</h3>
          {homeItem && home && (
            <div className="rule ok">
              <img src={artUrl(homeItem.image)} alt="" />
              <p><b>{homeItem.name}</b> in <b>{home.name}</b><span>Accepted. It is one of {home.name}'s own items.</span></p>
            </div>
          )}
          {otherItem && other && home && (
            <div className="rule no">
              <img src={artUrl(otherItem.image)} alt="" />
              <p><b>{otherItem.name}</b> in <b>{home.name}</b><span>Rejected by default. It belongs to {other.name}.</span></p>
            </div>
          )}
          {otherItem && other && home && (
            <div className="rule ok">
              <img src={artUrl(otherItem.image)} alt="" />
              <p><b>{otherItem.name}</b> in <b>{home.name}</b>, after a partnership<span>Accepted, because {home.name} chose to add {other.name} to its list.</span></p>
            </div>
          )}
          <p className="fine">
            A game runs one check before honouring an item: <code>canUse(item, player, {"{ games: [itself] }"})</code>.
            Try it on the developer page.
          </p>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- partners

function Partners({ items, games, onPartner }: { items: ItemView[]; games: GameInfo[]; onPartner: () => void }) {
  const [ref, shown] = useReveal<HTMLElement>();
  const rows = games.map((g) => {
    const mine = items.filter((i) => i.game === g.account_id);
    return {
      ...g,
      items: mine.length,
      leases: mine.reduce((s, i) => s + i.rental_count, 0),
      royalty: mine.reduce((s, i) => s + BigInt(i.creator_earnings), 0n),
    };
  });
  return (
    <section ref={ref} className={`partners ${shown ? "in" : ""}`}>
      <div className="pt-grid">
        <div>
          <h2>An economy games plug into</h2>
          <p className="section-lede">
            LeaseKey stays focused on one job: renting. Games bring the items, and every lease pays them.
          </p>
          <ol className="pt-steps">
            <li><b>Register your game.</b> One call, 0.01 NEAR. Your account becomes the game's identity.</li>
            <li><b>Mint your in-game items to players,</b> or let players wrap the NFTs they already own from your collection.</li>
            <li><b>Players rent them to each other.</b> Owners earn from idle items, newcomers play without buying in.</li>
            <li><b>You earn a royalty on every lease,</b> paid automatically when it settles. No marketplace to run.</li>
          </ol>
          <button className="primary big" onClick={onPartner}>Partner with LeaseKey <Icon name="arrow" /></button>
        </div>
        <figure className="chart pt-table">
          <figcaption>Partner games, live from testnet</figcaption>
          <table>
            <thead>
              <tr><th scope="col">Game</th><th scope="col">Items</th><th scope="col">Leases</th><th scope="col">Royalties earned</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.account_id}>
                  <td><b>{r.name}</b><small>{short(r.account_id)}</small></td>
                  <td className="num">{r.items}</td>
                  <td className="num">{r.leases}</td>
                  <td className="num">{fmtNear(r.royalty, 5)} NEAR</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={4} className="muted">Loading partner games…</td></tr>}
            </tbody>
          </table>
        </figure>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- economy

function Economy({ items }: { items: ItemView[] }) {
  const [ref, shown] = useReveal<HTMLElement>();
  const totals = useMemo(() => {
    let earned = 0n;
    let rentals = 0;
    let uses = 0;
    for (const i of items) {
      earned += BigInt(i.lifetime_earnings);
      rentals += i.rental_count;
      uses += i.total_uses;
    }
    return { earned, rentals, uses, live: items.filter((i) => statusOf(i) === "rented").length };
  }, [items]);

  return (
    <section ref={ref} className={`economy ${shown ? "in" : ""}`}>
      <div className="econ-head">
        <h2>The economy, live from testnet</h2>
        <p className="section-lede">
          Read straight from the item accounts of <AccountLink id={FACTORY_ID} />. Each colour is one item.
        </p>
        <p className="econ-sum">
          <span><b className="num">{items.length}</b> items</span>
          <span><b className="num">{totals.rentals}</b> leases</span>
          <span><b className="num">{fmtNear(totals.earned, 4)}</b> NEAR paid to owners and creators</span>
          <span><b className="num">{totals.uses}</b> on-chain strikes</span>
          <span><b className="num">{totals.live}</b> on lease right now</span>
        </p>
      </div>
      <div className="charts">
        <figure className="chart wide">
          <figcaption>Rent earned per item, NEAR</figcaption>
          <EarningsBars items={items} />
        </figure>
        <figure className="chart">
          <figcaption>Arsenal by class</figcaption>
          <ClassDonut items={items} />
        </figure>
        <figure className="chart">
          <figcaption>Price per hour against power</figcaption>
          <PricePower items={items} />
        </figure>
      </div>
    </section>
  );
}

function EarningsBars({ items }: { items: ItemView[] }) {
  const rows = [...items].sort((a, b) => Number(BigInt(b.lifetime_earnings) - BigInt(a.lifetime_earnings)));
  const max = rows.reduce((m, i) => (BigInt(i.lifetime_earnings) > m ? BigInt(i.lifetime_earnings) : m), 1n);
  return (
    <div className="bars" role="list">
      {rows.map((i) => {
        const [a, b] = lookOf(i.image).colors;
        const pct = Number((BigInt(i.lifetime_earnings) * 1000n) / max) / 10;
        return (
          <div className="bar-row" role="listitem" key={i.account_id}>
            <img src={artUrl(i.image)} alt="" />
            <span className="bar-name">{i.name}</span>
            <span className="bar-track">
              <span className="bar-fill" style={{ width: `${Math.max(pct, 1.5)}%`, background: `linear-gradient(90deg, ${a}, ${b})` }} />
            </span>
            <span className="bar-val num">{fmtNear(i.lifetime_earnings, 4)}</span>
            <span className="bar-sub num">{i.rental_count} {i.rental_count === 1 ? "lease" : "leases"}</span>
          </div>
        );
      })}
    </div>
  );
}

const CLASS_COLORS: Record<ItemClass, string> = {
  Blade: "#ff7a3d", Ranged: "#5cc8ff", Heavy: "#b79bff", Arcane: "#ffc83a", Armor: "#3fd68e",
};

function ClassDonut({ items }: { items: ItemView[] }) {
  const counts = CLASSES.map((cls) => ({ cls, n: items.filter((i) => lookOf(i.image).cls === cls).length })).filter((x) => x.n);
  const total = counts.reduce((s, x) => s + x.n, 0) || 1;
  const R = 70;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="donut">
      <svg viewBox="0 0 200 200" role="img" aria-label="Items by class">
        <circle cx="100" cy="100" r={R} fill="none" stroke="var(--line)" strokeWidth="26" />
        {counts.map(({ cls, n }) => {
          const len = (n / total) * C;
          const el = (
            <circle key={cls} cx="100" cy="100" r={R} fill="none" stroke={CLASS_COLORS[cls]} strokeWidth="26"
              strokeDasharray={`${Math.max(len - 3, 0)} ${C}`} strokeDashoffset={-offset} transform="rotate(-90 100 100)" />
          );
          offset += len;
          return el;
        })}
        <text x="100" y="98" textAnchor="middle" className="donut-n">{items.length}</text>
        <text x="100" y="122" textAnchor="middle" className="donut-l">items</text>
      </svg>
      <ul className="legend">
        {counts.map(({ cls, n }) => (
          <li key={cls}><i style={{ background: CLASS_COLORS[cls] }} />{cls}<b className="num">{n}</b></li>
        ))}
      </ul>
    </div>
  );
}

function PricePower({ items }: { items: ItemView[] }) {
  const W = 320, H = 210, P = 34;
  const maxPrice = Math.max(...items.map((i) => Number(BigInt(i.price_per_hour) / 10n ** 18n) / 1e6), 0.05);
  const maxPower = Math.max(...items.map((i) => i.power), 10);
  const x = (p: number) => P + (p / maxPower) * (W - P - 12);
  const y = (v: number) => H - P - (v / maxPrice) * (H - P - 14);
  return (
    <svg className="scatter" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Price per hour against power">
      <line x1={P} y1={H - P} x2={W - 8} y2={H - P} stroke="var(--line)" />
      <line x1={P} y1={10} x2={P} y2={H - P} stroke="var(--line)" />
      {[0.5, 1].map((t) => (
        <g key={t}>
          <line x1={P} x2={W - 8} y1={y(maxPrice * t)} y2={y(maxPrice * t)} stroke="var(--line)" strokeDasharray="2 4" />
          <text x={P - 6} y={y(maxPrice * t) + 4} textAnchor="end" className="axis num">{(maxPrice * t).toFixed(2)}</text>
        </g>
      ))}
      <text x={W - 8} y={H - 10} textAnchor="end" className="axis">power</text>
      <text x={P - 6} y={H - P + 14} textAnchor="end" className="axis">0</text>
      {items.map((i) => {
        const [a] = lookOf(i.image).colors;
        const price = Number(BigInt(i.price_per_hour) / 10n ** 18n) / 1e6;
        return (
          <g key={i.account_id}>
            <circle cx={x(i.power)} cy={y(price)} r="9" fill={a} opacity=".25" />
            <circle cx={x(i.power)} cy={y(price)} r="5" fill={a} stroke="#0b0a14" strokeWidth="1.5">
              <title>{`${i.name}: ${fmtNear(i.price_per_hour)} NEAR/hr, power ${i.power}`}</title>
            </circle>
          </g>
        );
      })}
    </svg>
  );
}

// --------------------------------------------------------------- featured

function Featured({ items, onOpen, onAll }: { items: ItemView[]; onOpen: (id: string) => void; onAll: () => void }) {
  const top = [...items].sort((a, b) => b.power - a.power).slice(0, 6);
  return (
    <section className="featured">
      <div className="feat-head">
        <h2>Relics waiting for a wielder</h2>
        <button className="ghost" onClick={onAll}>See the whole armory <Icon name="arrow" /></button>
      </div>
      <div className="feat-strip">
        {top.map((i) => {
          const look = lookOf(i.image);
          const r = rarityOf(i.power, i.max_supply);
          return (
            <button key={i.account_id} className="feat" style={{ ["--c1" as string]: look.colors[0], ["--c2" as string]: look.colors[1] }}
              onClick={() => onOpen(i.account_id)}>
              <img src={artUrl(i.image)} alt="" />
              <span className="feat-r" style={{ color: r.color }}>{r.name} {look.cls}</span>
              <b>{i.name}</b>
              <span className="feat-p num">{fmtNear(i.price_per_hour)} NEAR / hr</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
