import { useEffect, useMemo, useRef, useState } from "react";
import { CLASSES, artUrl, lookOf, rarityOf, type ItemClass } from "./catalog";
import { FACTORY_ID, fmtNear, type ItemView } from "./near";
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

export function Home() {
  const c = useChain();
  return (
    <div className="home">
      <Hero onEnter={() => c.setPage("market")} onArena={() => c.setPage("arena")} />
      <Problem />
      <Flow />
      <Guarantees />
      <Economy items={c.items} />
      <Featured items={c.items} onOpen={(id) => c.openItem(id)} onAll={() => c.setPage("market")} />
    </div>
  );
}

// ------------------------------------------------------------------- hero

function Hero({ onEnter, onArena }: { onEnter: () => void; onArena: () => void }) {
  const [run, setRun] = useState(0);
  return (
    <section className="hero">
      <h1 className="sr-only">Rent legendary gear. Every item is its own NEAR account.</h1>
      <svg key={run} className="hero-stage" viewBox="0 0 1200 560" aria-hidden="true">
        <defs>
          <linearGradient id="h-steel" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#fff7e0" />
            <stop offset=".5" stop-color="#c9c3e6" />
            <stop offset="1" stop-color="#5a5480" />
          </linearGradient>
          <linearGradient id="h-gold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#fff2c2" />
            <stop offset=".55" stop-color="#e9b23f" />
            <stop offset="1" stop-color="#7a4b0b" />
          </linearGradient>
          <linearGradient id="h-letter" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#fff6dc" />
            <stop offset="1" stop-color="#e9c46a" />
          </linearGradient>
          <linearGradient id="h-cape" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#b3262f" />
            <stop offset="1" stop-color="#4a0c18" />
          </linearGradient>
          <radialGradient id="h-flash" cx="50%" cy="50%" r="50%">
            <stop offset="0" stop-color="#fff6dc" stop-opacity="1" />
            <stop offset=".4" stop-color="#ffcf6a" stop-opacity=".6" />
            <stop offset="1" stop-color="#ff8a3d" stop-opacity="0" />
          </radialGradient>
          <filter id="h-blur" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="8" />
          </filter>
        </defs>

        {/* ground line and dust */}
        <path className="h-ground" d="M40 470 H1160" />

        {/* warrior */}
        <g className="h-warrior">
          <path className="h-cape" d="M150 250 C120 300 104 380 96 462 L196 462 C190 380 196 300 196 254 Z" fill="url(#h-cape)" />
          <path d="M160 340 L146 462 H170 L184 372 L198 462 H222 L212 340 Z" fill="#2b2547" />
          <path d="M146 456 H174 V470 H140 Z M196 456 H226 L232 470 H196 Z" fill="#17142b" />
          <path d="M148 246 C150 230 214 230 218 246 L224 344 H142 Z" fill="url(#h-steel)" stroke="#fff7e0" strokeWidth="1.5" />
          <path d="M150 300 H218" stroke="url(#h-gold)" strokeWidth="8" />
          <circle cx="181" cy="300" r="7" fill="#ff8a3d" />
          <g className="h-arm-back"><path d="M150 256 L120 330 L136 336 L166 266 Z" fill="#c9c3e6" /></g>
          <path d="M156 200 C156 172 208 172 208 200 V234 C208 246 156 246 156 234 Z" fill="url(#h-steel)" stroke="#fff7e0" strokeWidth="1.5" />
          <path d="M160 214 H204 V222 H160 Z" fill="#17142b" />
          <path d="M166 216 H198" stroke="#ffcf6a" strokeWidth="3" strokeLinecap="round" />
          <path d="M182 172 C190 140 214 132 236 140 C214 150 202 162 196 178 Z" fill="#e9b23f" />
          <g className="h-arm">
            <path d="M212 256 L246 196 L262 206 L228 268 Z" fill="url(#h-steel)" stroke="#fff7e0" strokeWidth="1.5" />
            <circle cx="254" cy="198" r="10" fill="#c9c3e6" />
          </g>
        </g>

        {/* the thrown axe, drawn around its own centre */}
        <g className="h-axe">
          <g className="h-axe-spin">
            <rect x="-6" y="-70" width="12" height="140" rx="5" fill="#5a3418" />
            <path d="M6 -66 C52 -80 78 -44 70 -6 C62 -30 36 -36 6 -26 Z" fill="url(#h-gold)" stroke="#fff2c2" strokeWidth="2" />
            <path d="M-6 -66 C-40 -74 -60 -50 -56 -24 C-48 -40 -28 -44 -6 -38 Z" fill="url(#h-steel)" stroke="#fff7e0" strokeWidth="2" />
            <circle cx="0" cy="-58" r="5" fill="#ff8a3d" />
          </g>
          <path className="h-axe-trail" d="M-120 30 C-80 -10 -40 -10 0 0" fill="none" stroke="#ffcf6a" strokeWidth="6" strokeLinecap="round" />
        </g>

        {/* impact */}
        <circle className="h-flash" cx="520" cy="250" r="150" fill="url(#h-flash)" />
        <circle className="h-ring" cx="520" cy="250" r="40" fill="none" stroke="#ffcf6a" strokeWidth="3" />

        {/* the word */}
        <g className="h-word">
          <text className="h-R" x="452" y="318" fill="url(#h-letter)">R</text>
          <text className="h-rest" x="566" y="318" fill="url(#h-letter)">ent</text>
          <text className="h-line2" x="458" y="410" fill="#f3ead7">legendary gear</text>
        </g>
        <text className="h-R-glow" x="452" y="318" fill="#ffcf6a" filter="url(#h-blur)">R</text>
      </svg>

      <div className="hero-copy">
        <p className="lede">
          Owners lend swords, bows and armour without handing them over. Renters play without collateral.
          Every item is its own NEAR account that rents itself out and pays its owner.
        </p>
        <div className="hero-ctas">
          <button className="primary big" onClick={onEnter}>
            Enter the armory <Icon name="arrow" />
          </button>
          <button className="ghost big" onClick={onArena}>Fight in the arena</button>
          <button className="link" onClick={() => setRun((n) => n + 1)}>Replay the throw</button>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- problem

function Problem() {
  const [ref, shown] = useReveal<HTMLElement>();
  return (
    <section ref={ref} className={`problem ${shown ? "in" : ""}`}>
      <h2>Lending gear in games has always meant trusting a stranger.</h2>
      <div className="problem-grid">
        <div className="old">
          <h3>Until now, you could</h3>
          <p>
            <b>Hand the item over</b> and hope it comes back. Scholarship programs lost items and earnings this way.
          </p>
          <p>
            <b>Lock collateral</b> worth the whole item. That shuts out exactly the players who cannot afford it.
          </p>
        </div>
        <div className="new">
          <h3>With LeaseKey</h3>
          <p>
            The sword stays with its owner. The renter gets a <b>key that can only swing it</b>, until the clock runs
            out.
          </p>
          <p>
            No collateral and no trust. When time is up, anyone can close the lease and the rent splits itself.
          </p>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------- flow

const STEPS = [
  { name: "Mint", text: "The item is born as its own account, like flame-sword.leasekey.testnet." },
  { name: "List", text: "The owner sets a price per hour. The item waits in the armory." },
  { name: "Rent", text: "A renter pays rent plus a small refundable gas budget. No collateral." },
  { name: "Play", text: "The item adds a key for the renter's browser that can only call use_item." },
  { name: "Settle", text: "When time is up the key is deleted and rent splits between owner and creator." },
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
  const yes = ["Swing the item in the game", "Play without a wallet pop-up on every strike", "Return early and get unused time back"];
  const no = ["Transfer or sell the item", "Withdraw the item's earnings", "Call any other contract", "Keep playing after the lease ends"];
  const owner = ["Cancel or unlist mid-lease", "Revoke the renter's key", "Burn the item"];
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
          const r = rarityOf(i.power);
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
