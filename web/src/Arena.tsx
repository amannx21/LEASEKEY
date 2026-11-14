import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LOOKS, artUrl, lookOf, type AttackStyle, type Look } from "./catalog";
import {
  ARENA_GAME, EXPLORER, FACTORY_ID, Session, TGAS, call, errorText, fmtNear, sessionKeyFor, statOf, usableInArena, view,
  type ItemRef, type Settlement,
} from "./near";
import { useChain } from "./store";
import { AccountLink, Icon, fmtClock, useTimeLeft } from "./ui";

type Feed = { id: number; label: string; state: "pending" | "ok" | "fail"; note?: string; hash?: string };

const W = 1280;
const H = 560;
const GROUND = 452;
const HERO_X = 190;
const FIST_DAMAGE = 6;

/** What one strike of each style does, in game terms. */
const STYLE_INFO: Record<AttackStyle, string> = {
  slash: "Wide flaming arc in front of you",
  arrow: "Piercing arrow that flies the whole arena",
  smash: "Ground quake that hits everything nearby",
  bolt: "Lightning that strikes the two closest slimes anywhere",
  blast: "Three-shot plasma burst",
  beam: "Light blade that cuts straight through a whole line",
  wave: "Shockwave that rolls across the entire field",
  guard: "Shield bash, and you take half damage",
};

/** What the hero holds. Stats come from the item's game: attack hits, defence blocks, speed swings faster, endurance heals. */
type Equip = { look: Look; power: number; onChain: boolean; defence: number; speed: number; endurance: number };

export function Arena() {
  const c = useChain();
  const me = c.me?.accountId;
  // This arena is a game like any other: it honours its own items and its partner's, nothing else.
  const myLeases = c.items.filter((i) => i.renter === me && !!sessionKeyFor(i) && i.rental_active);
  const leases = myLeases.filter(usableInArena);
  const foreign = myLeases.filter((i) => !usableInArena(i));
  const [chosen, setChosen] = useState<string | null>(c.arenaItem);
  const rentable = c.items
    .filter((i) => i.listed && !i.renter && i.durability > 0 && i.owner !== me && usableInArena(i))
    .sort((a, b) => (a.max_supply ?? 99) - (b.max_supply ?? 99) || b.power - a.power);

  useEffect(() => {
    if (c.arenaItem) setChosen(c.arenaItem);
  }, [c.arenaItem]);

  const item = leases.find((i) => i.account_id === chosen) ?? leases[0] ?? null;
  const keyPair = item ? sessionKeyFor(item) : null;
  const publicKey = keyPair?.getPublicKey().toString() ?? null;
  const session = useMemo(
    () => (item && keyPair ? new Session(item.account_id, keyPair) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [item?.account_id, publicKey],
  );

  const timeLeft = useTimeLeft(session ? item!.ends_at : null);
  const [usesLeft, setUsesLeft] = useState(0);
  const [feed, setFeed] = useState<Feed[]>([]);
  const [ended, setEnded] = useState<{ name: string; settlement?: Settlement } | null>(null);
  // Loot roll: 20 confirmed on-chain strikes in this lease earn one roll for a capped item.
  const DROP_MIN = 20;
  const [confirmed, setConfirmed] = useState(0);
  const [rolled, setRolled] = useState(false);
  const [drop, setDrop] = useState<{ won: ItemRef | null } | null>(null);
  const [score, setScore] = useState(0);
  const [hp, setHp] = useState(100);
  const settling = useRef<string | null>(null);

  useEffect(() => {
    if (session && item) {
      setUsesLeft(item.uses_left);
      setEnded(null);
      setConfirmed(item.uses);
      setDrop(null);
      setRolled(false);
      view<boolean>(ARENA_GAME, "reward_rolled", { token_id: item.token_id, rental_count: item.rental_count })
        .then(setRolled, () => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const armedOnChain = !!session && timeLeft > 0 && usesLeft > 0 && item!.durability > 0;
  const equip: Equip | null = armedOnChain
    ? {
        look: lookOf(item!.image), onChain: true,
        power: statOf(item!, "attack", item!.power),
        defence: statOf(item!, "defence"), speed: statOf(item!, "speed"), endurance: statOf(item!, "endurance"),
      }
    : null;

  const pushFeed = useCallback((entry: Omit<Feed, "id">) => {
    const id = Date.now() + Math.random();
    setFeed((f) => [{ id, ...entry }, ...f].slice(0, 9));
    return id;
  }, []);
  const patchFeed = useCallback((id: number, patch: Partial<Feed>) => {
    setFeed((f) => f.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }, []);

  /** One strike with a rented item = one use_item transaction signed by the session key. */
  const strike = useCallback(
    (style: AttackStyle) => {
      if (!session) return;
      setUsesLeft((n) => Math.max(0, n - 1));
      const id = pushFeed({ label: `use_item("${style}")`, state: "pending" });
      const started = performance.now();
      session
        .useItem(style)
        .then(({ value, hash }) => {
          patchFeed(id, {
            state: "ok",
            hash,
            note: `${((performance.now() - started) / 1000).toFixed(1)}s · durability ${value.durability}`,
          });
          setUsesLeft((n) => Math.min(n, value.uses_left));
          setConfirmed((n) => Math.max(n, value.uses));
        })
        .catch((e) => {
          const text = errorText(e);
          patchFeed(id, { state: "fail", note: text });
          if (/lease expired|not rented|no longer exists|not the renter/.test(text)) setUsesLeft(0);
        });
    },
    [session, pushFeed, patchFeed],
  );

  // Lease ran out: the item drops from the hero's hand, then the rental settles on chain.
  useEffect(() => {
    if (!session || !item || timeLeft > 0) return;
    if (settling.current === item.account_id + item.ends_at) return;
    settling.current = item.account_id + item.ends_at;
    setEnded({ name: item.name });
    if (c.me?.kind === "guest") {
      const name = item.name;
      setTimeout(async () => {
        const settlement = await c.endRental(item);
        setEnded({ name, settlement });
      }, 1500);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, session]);

  const cheat = useCallback(
    async (label: string, method: string, args: Record<string, unknown>, receiver: string, deposit = 0n) => {
      if (!session) return;
      const id = pushFeed({ label, state: "pending" });
      try {
        await session.send(method, args, receiver, deposit);
        patchFeed(id, { state: "ok", note: "unexpectedly allowed" });
      } catch (e) {
        patchFeed(id, { state: "fail", note: `Rejected by NEAR: ${errorText(e)}` });
      }
    },
    [session, pushFeed, patchFeed],
  );

  const game = useRef({ equip, strike, setScore, setHp });
  game.current = { equip, strike, setScore, setHp };
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const attackRef = useRef<() => void>(() => {});

  useEffect(() => startGame(canvasRef.current!, game, attackRef), []);

  const look = equip?.look ?? null;
  return (
    <section className="arena" style={look ? { ["--c1" as string]: look.colors[0], ["--c2" as string]: look.colors[1] } : undefined}>
      <div className="arena-main">
        <div className="loadout">
          <div className={`weapon ${equip ? "live" : "dead"}`}>
            {look ? <img src={`/items/${look.key}.svg`} alt="" /> : <span className="fist"><Icon name="shield" size={26} /></span>}
            <div>
              <b>{item ? item.name : "Bare hands"}</b>
              {equip?.onChain && <span className="pill">leased</span>}
              <small>
                {equip ? STYLE_INFO[equip.look.style] : `${FIST_DAMAGE} damage. Rent gear to hit far harder.`}
              </small>
              {equip && (
                <small className="num">
                  attack {equip.power} · defence {equip.defence} · speed {equip.speed} · endurance {equip.endurance}
                </small>
              )}
              {session && item && (
                <small>
                  {timeLeft > 0 ? (
                    <>lease ends in <span className="num big">{fmtClock(timeLeft)}</span></>
                  ) : "lease ended"}
                  {" · "}<span className="num">{usesLeft}</span> strikes left · power {item.power}
                </small>
              )}
            </div>
            {!session && (
              <button className="primary" onClick={() => c.setPage("market")}>Rent a weapon</button>
            )}
            {session && item && timeLeft > 0 && (
              <button
                disabled={!!c.busy}
                title="Add 2 minutes to this lease with the same session key"
                onClick={() =>
                  c.run("Extending lease…", (who) =>
                    call(who, item.account_id, "extend", { extra_secs: "120" },
                      (BigInt(item.price_per_hour) * 120n) / 3600n + 1n))}
              >
                +2 min
              </button>
            )}
          </div>
          <div className="score">
            <span>Slimes <b className="num">{score}</b></span>
            <span className="hp" aria-label={`Health ${hp}%`}><i style={{ width: `${hp}%` }} /></span>
          </div>
        </div>

        <div className="stage">
          <canvas ref={canvasRef} onPointerDown={() => attackRef.current()} aria-label="Slime arena. Press Space or click to attack." />
          {ended && (
            <div className="ended">
              <h3>Your lease on {ended.name} ended</h3>
              {ended.settlement ? (
                <p>
                  Settled on chain. Owner earned <b>{fmtNear(ended.settlement.owner_cut, 5)} NEAR</b>, game creator{" "}
                  <b>{fmtNear(ended.settlement.creator_cut, 5)} NEAR</b>, and you got{" "}
                  <b>{fmtNear(ended.settlement.renter_refund, 4)} NEAR</b> of unused gas budget back. Your session key
                  was deleted.
                </p>
              ) : (
                <p>The item left your hands the moment the lease expired. Settling the rental on chain…</p>
              )}
              <div>
                <button className="primary" onClick={() => c.setPage("market")}>Rent again</button>
                <button className="ghost" onClick={() => setEnded(null)}>Keep fighting</button>
              </div>
            </div>
          )}
        </div>

        {foreign.length > 0 && (
          <p className="warn small">
            {foreign.map((i) => i.name).join(", ")} {foreign.length === 1 ? "belongs" : "belong"} to{" "}
            {foreign[0].game_name ?? "another game"}, which this arena does not accept. Use{" "}
            {foreign.length === 1 ? "it" : "them"} in {foreign.length === 1 ? "its" : "their"} own game.
          </p>
        )}
        {leases.length > 1 && (
          <div className="rack">
            <span className="rack-label">Switch gear</span>
            {leases.map((i) => (
              <button key={i.account_id} className={item?.account_id === i.account_id ? "on" : ""}
                onClick={() => setChosen(i.account_id)} title={`${i.name}, leased`}>
                <img src={artUrl(i.image)} alt="" /><span>{i.name}</span>
              </button>
            ))}
          </div>
        )}
        {rentable.length > 0 && (
          <div className="rack">
            <span className="rack-label">Rent more gear</span>
            {rentable.map((i) => (
              <button key={i.account_id} className="rent-chip" onClick={() => c.openItem(i.account_id)}
                title={`${i.name}: ${STYLE_INFO[lookOf(i.image).style]}`}>
                <img src={artUrl(i.image)} alt="" />
                <span>{i.name}<small className="num">{fmtNear(i.price_per_hour)} NEAR/hr</small></span>
              </button>
            ))}
          </div>
        )}
        {session && item && ARENA_GAME && (
          <div className={`loot ${drop?.won ? "won" : ""}`}>
            <div className="loot-head">
              <b>Slime Arena reward</b>
              <span className="muted">
                Land {DROP_MIN} strikes in one lease and the game rolls a rare item for you. Slime Arena is its own
                contract: it mints its rewards itself, like any game on LeaseKey.
              </span>
            </div>
            {drop ? (
              drop.won ? (
                <p className="loot-result">
                  You won <b>{drop.won.item_type?.replace(/-/g, " ")}</b>, edition {drop.won.edition} of {drop.won.max_supply}.
                  It is yours for good.{" "}
                  <button className="link" onClick={() => c.setPage("mine")}>List it for rent in My Items</button>
                </p>
              ) : (
                <p className="loot-result">No reward this time. Each lease gets one roll, so rent again to try once more.</p>
              )
            ) : rolled ? (
              <p className="loot-result">This lease already used its roll.</p>
            ) : (
              <div className="loot-row">
                <span className="loot-track"><i style={{ width: `${Math.min(100, (Math.max(confirmed, item.uses) / DROP_MIN) * 100)}%` }} /></span>
                <span className="num">{Math.min(DROP_MIN, Math.max(confirmed, item.uses))} / {DROP_MIN}</span>
                <button
                  className="primary"
                  disabled={!!c.busy || Math.max(confirmed, item.uses) < DROP_MIN || timeLeft <= 0}
                  onClick={async () => {
                    const out = await c.run("Asking Slime Arena for a reward…", async (who) => ({
                      won: await call<ItemRef | null>(who, ARENA_GAME, "claim_reward", { token_id: item.token_id }, 0n, 150n * TGAS),
                    }));
                    if (out) {
                      setDrop({ won: out.won ?? null });
                      setRolled(true);
                    }
                  }}
                >
                  Claim reward roll
                </button>
              </div>
            )}
          </div>
        )}
        <p className="muted hint">
          Space or click to attack. With leased gear every strike is a real <code>use_item</code> transaction, signed in
          this browser by your session key. No wallet pop-ups, and the item account pays the gas.
        </p>
      </div>

      <aside className="panel side">
        <h3>On-chain feed</h3>
        {feed.length === 0 && <p className="muted">Strikes with leased gear show up here as transactions.</p>}
        <ul className="feed">
          {feed.map((f) => (
            <li key={f.id} className={f.state}>
              <span className="dot" />
              <div>
                <b>{f.label}</b>
                {f.state === "pending" && <small>sending…</small>}
                {f.note && <small>{f.note}</small>}
                {f.hash && (
                  <a href={`${EXPLORER}/txns/${f.hash}`} target="_blank" rel="noreferrer">tx {f.hash.slice(0, 8)}…</a>
                )}
              </div>
            </li>
          ))}
        </ul>

        <h3>Try to cheat</h3>
        <p className="muted">Use the same session key for anything other than playing.</p>
        <div className="cheats">
          <button disabled={!session || !c.me}
            onClick={() => cheat("nft_transfer(item → me)", "nft_transfer",
              { receiver_id: c.me!.accountId, token_id: item!.token_id }, FACTORY_ID, 1n)}>
            Transfer the item to myself
          </button>
          <button disabled={!session} onClick={() => cheat("unlist()", "unlist", {}, item!.account_id)}>
            Take the item off the market
          </button>
          <button disabled={!session} onClick={() => cheat("claim() earnings", "claim", {}, item!.account_id)}>
            Withdraw the item's earnings
          </button>
        </div>
        {item && session && (
          <p className="muted small">Item account: <AccountLink id={item.account_id} /></p>
        )}
      </aside>
    </section>
  );
}


// =================================================================== game

type Slime = { x: number; y: number; hp: number; max: number; speed: number; phase: number; flash: number; size: number; hue: number; kb: number };
type Shot = { x: number; y: number; vx: number; power: number; pierce: number; color: string; kind: "arrow" | "plasma"; hit: Set<Slime> };
type Fx =
  | { t: "arc"; life: number; max: number; color: string; color2: string }
  | { t: "ring"; x: number; y: number; r: number; vr: number; life: number; color: string }
  | { t: "beam"; life: number; color: string }
  | { t: "bolt"; x: number; life: number; pts: number[] }
  | { t: "wave"; x: number; life: number; color: string; color2: string; hit: Set<Slime>; power: number };
type Spark = { x: number; y: number; vx: number; vy: number; life: number; color: string; size: number };
type Float = { x: number; y: number; text: string; life: number; color: string };

type GameRef = { current: { equip: Equip | null; strike: (s: AttackStyle) => void; setScore: (n: number) => void; setHp: (n: number) => void } };

const images = new Map<string, HTMLImageElement>();
function img(key: string) {
  let i = images.get(key);
  if (!i) {
    i = new Image();
    i.src = `/items/${key}.svg`;
    images.set(key, i);
  }
  return i;
}

function startGame(canvas: HTMLCanvasElement, game: GameRef, attackRef: { current: () => void }) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  Object.keys(LOOKS).forEach(img);

  let slimes: Slime[] = [];
  let shots: Shot[] = [];
  let fx: Fx[] = [];
  let sparks: Spark[] = [];
  let floats: Float[] = [];
  let pending: { at: number; fn: () => void }[] = [];
  let heroHp = 100, kills = 0, swing = 0, hurt = 0, cooldown = 0, spawnIn = 1, over = false, t = 0, shake = 0;
  let raf = 0, last = performance.now();
  const stars = Array.from({ length: 90 }, (_, i) => ({ x: (i * 211) % W, y: (i * 97) % 260, s: (i % 3) + 1, p: i }));

  const reset = () => {
    slimes = []; shots = []; fx = []; sparks = []; floats = []; pending = [];
    heroHp = 100; kills = 0; over = false; spawnIn = 1;
    game.current.setScore(0); game.current.setHp(100);
  };

  const burst = (x: number, y: number, color: string, n = 10, speed = 220) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 60 + Math.random() * speed;
      sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 90, life: 0.45 + Math.random() * 0.4, color, size: 2 + Math.random() * 3 });
    }
  };

  const damage = (s: Slime, amount: number, color: string, kb = 0) => {
    if (s.hp <= 0) return;
    const dmg = Math.round(amount);
    s.hp -= dmg;
    s.flash = 0.12;
    s.kb += kb;
    floats.push({ x: s.x, y: s.y - s.size * 2.2 - 8, text: `-${dmg}`, life: 0.8, color });
    burst(s.x, s.y - s.size, color, 6);
    if (s.hp <= 0) {
      kills += 1;
      game.current.setScore(kills);
      burst(s.x, s.y - s.size, `hsl(${s.hue} 80% 65%)`, 18, 280);
    }
  };

  const alive = () => slimes.filter((s) => s.hp > 0);

  const attack = () => {
    if (over) return reset();
    if (cooldown > 0) return;
    const eq = game.current.equip;
    swing = 0.24;
    if (!eq) {
      cooldown = 0.3;
      const target = alive().filter((s) => s.x - HERO_X < 140).sort((a, b) => a.x - b.x)[0];
      if (target) damage(target, FIST_DAMAGE, "#e8e2d0", 6);
      return;
    }
    const { look, power, onChain } = eq;
    const [c1, c2] = look.colors;
    // speed shortens the cooldown, down to half
    cooldown = (look.style === "smash" || look.style === "wave" ? 0.55 : 0.3) * (1 - Math.min(0.5, eq.speed / 80));
    if (onChain) game.current.strike(look.style);
    const y = GROUND - 62;
    switch (look.style) {
      case "slash":
        fx.push({ t: "arc", life: 0.28, max: 0.28, color: c1, color2: c2 });
        alive().filter((s) => s.x > HERO_X - 20 && s.x - HERO_X < 230).forEach((s) => damage(s, power, c1, 30));
        break;
      case "beam":
        fx.push({ t: "beam", life: 0.3, color: c1 });
        alive().forEach((s) => damage(s, power * 0.8, c1, 10));
        break;
      case "arrow":
        shots.push({ x: HERO_X + 60, y, vx: 1500, power, pierce: 3, color: c1, kind: "arrow", hit: new Set() });
        break;
      case "blast":
        for (let k = 0; k < 3; k++) {
          pending.push({ at: t + k * 0.09, fn: () => shots.push({ x: HERO_X + 74, y: y + (k - 1) * 8, vx: 1150, power: power * 0.55, pierce: 1, color: k % 2 ? c2 : c1, kind: "plasma", hit: new Set() }) });
        }
        break;
      case "smash":
        shake = 0.3;
        fx.push({ t: "ring", x: HERO_X + 70, y: GROUND, r: 20, vr: 900, life: 0.4, color: c2 });
        burst(HERO_X + 70, GROUND, c2, 24, 300);
        alive().filter((s) => s.x - HERO_X < 380).forEach((s) => damage(s, power, c2, 70));
        break;
      case "bolt": {
        const targets = alive().sort((a, b) => a.x - b.x).slice(0, 2);
        targets.forEach((s) => {
          const pts: number[] = [];
          for (let yy = 0; yy < s.y; yy += 40) pts.push(s.x + (Math.random() - 0.5) * 50);
          fx.push({ t: "bolt", x: s.x, life: 0.22, pts });
          damage(s, power, c1, 20);
        });
        if (!targets.length) fx.push({ t: "bolt", x: W * 0.6, life: 0.22, pts: [W * 0.6, W * 0.62, W * 0.58, W * 0.61] });
        break;
      }
      case "wave":
        shake = 0.2;
        fx.push({ t: "wave", x: HERO_X + 40, life: 1.2, color: c1, color2: c2, hit: new Set(), power: power * 0.75 });
        break;
      case "guard":
        fx.push({ t: "ring", x: HERO_X + 60, y: GROUND - 60, r: 30, vr: 500, life: 0.25, color: c1 });
        alive().filter((s) => s.x - HERO_X < 170).forEach((s) => damage(s, power * 0.6, c1, 90));
        break;
    }
  };
  attackRef.current = attack;

  const update = (dt: number) => {
    t += dt;
    // endurance slowly heals the hero
    const eqNow = game.current.equip;
    if (eqNow && !over && heroHp < 100 && eqNow.endurance > 0) {
      heroHp = Math.min(100, heroHp + eqNow.endurance * 0.04 * dt);
      game.current.setHp(Math.round(heroHp));
    }
    cooldown = Math.max(0, cooldown - dt);
    swing = Math.max(0, swing - dt);
    hurt = Math.max(0, hurt - dt);
    shake = Math.max(0, shake - dt);
    pending = pending.filter((p) => (p.at <= t ? (p.fn(), false) : true));
    if (!over) {
      spawnIn -= dt;
      if (spawnIn <= 0) {
        spawnIn = Math.max(0.6, 1.7 - kills * 0.02) * (0.7 + Math.random() * 0.6);
        const king = kills > 0 && kills % 12 === 0 && !slimes.some((s) => s.size > 40);
        const max = (king ? 220 : 30) + Math.min(70, kills * 0.9);
        slimes.push({
          x: W + 40, y: GROUND, hp: max, max, speed: (king ? 26 : 44 + Math.random() * 30) + kills * 0.3,
          phase: Math.random() * 6, flash: 0, size: king ? 52 : 20 + Math.random() * 10,
          hue: king ? 280 : [130, 160, 200, 300, 40][Math.floor(Math.random() * 5)], kb: 0,
        });
      }
    }
    const guard = game.current.equip?.look.style === "guard";
    for (const s of slimes) {
      s.x -= s.speed * dt;
      if (s.kb > 0) {
        const k = Math.min(s.kb, 600 * dt);
        s.x += k;
        s.kb -= k;
      }
      s.phase += dt * 6;
      s.flash = Math.max(0, s.flash - dt);
      if (!over && s.hp > 0 && s.x < HERO_X + 46) {
        s.hp = 0;
        // defence blocks part of every hit, up to 70%
        const block = Math.min(0.7, (game.current.equip?.defence ?? 0) / 80) + (guard ? 0.2 : 0);
        heroHp = Math.max(0, heroHp - 12 * (1 - Math.min(0.8, block)) * (s.size > 40 ? 3 : 1));
        hurt = 0.3;
        shake = 0.2;
        game.current.setHp(heroHp);
        burst(HERO_X + 20, GROUND - 50, "#ff6b6b", 14);
        if (heroHp <= 0) over = true;
      }
    }
    for (const sh of shots) {
      sh.x += sh.vx * dt;
      for (const s of slimes) {
        if (sh.pierce > 0 && s.hp > 0 && !sh.hit.has(s) && Math.abs(s.x - sh.x) < s.size + 6) {
          sh.hit.add(s);
          sh.pierce -= 1;
          damage(s, sh.power, sh.color, 24);
        }
      }
    }
    for (const f of fx) {
      f.life -= dt;
      if (f.t === "ring") f.r += f.vr * dt;
      if (f.t === "wave") {
        f.x += 900 * dt;
        for (const s of slimes) {
          if (s.hp > 0 && !f.hit.has(s) && s.x < f.x + 20) {
            f.hit.add(s);
            damage(s, f.power, f.color, 50);
          }
        }
      }
    }
    fx = fx.filter((f) => f.life > 0 && !(f.t === "wave" && f.x > W + 100));
    slimes = slimes.filter((s) => s.hp > 0 && s.x > -60);
    shots = shots.filter((s) => s.x < W + 80 && s.pierce > 0);
    for (const p of sparks) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 560 * dt; p.life -= dt; }
    sparks = sparks.filter((p) => p.life > 0);
    for (const f of floats) { f.y -= 50 * dt; f.life -= dt; }
    floats = floats.filter((f) => f.life > 0);
  };

  const drawWorld = () => {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#0b0a1f");
    sky.addColorStop(0.55, "#22163f");
    sky.addColorStop(1, "#3b1f3d");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    for (const s of stars) {
      ctx.globalAlpha = 0.35 + 0.35 * Math.sin(t * 1.6 + s.p);
      ctx.fillStyle = "#fff4dc";
      ctx.fillRect(s.x, s.y, s.s, s.s);
    }
    ctx.globalAlpha = 1;
    const moon = ctx.createRadialGradient(1010, 120, 10, 1010, 120, 140);
    moon.addColorStop(0, "rgba(255,236,190,.95)");
    moon.addColorStop(0.28, "rgba(255,214,140,.55)");
    moon.addColorStop(1, "rgba(255,180,120,0)");
    ctx.fillStyle = moon;
    ctx.beginPath(); ctx.arc(1010, 120, 140, 0, 7); ctx.fill();
    ctx.fillStyle = "#fff1cf";
    ctx.beginPath(); ctx.arc(1010, 120, 46, 0, 7); ctx.fill();
    // far mountains
    ctx.fillStyle = "#2a1d4a";
    ctx.beginPath(); ctx.moveTo(0, GROUND - 40);
    for (let x = 0; x <= W; x += 40) ctx.lineTo(x, GROUND - 150 - 60 * Math.sin(x * 0.006) - 30 * Math.sin(x * 0.019 + 1));
    ctx.lineTo(W, GROUND); ctx.lineTo(0, GROUND); ctx.fill();
    // temple ruins
    ctx.fillStyle = "#1c1336";
    for (const px of [520, 600, 680, 760]) ctx.fillRect(px, GROUND - 190, 26, 190);
    ctx.fillRect(500, GROUND - 210, 300, 22);
    ctx.beginPath(); ctx.moveTo(490, GROUND - 210); ctx.lineTo(650, GROUND - 262); ctx.lineTo(810, GROUND - 210); ctx.fill();
    // near hills
    ctx.fillStyle = "#170f2c";
    ctx.beginPath(); ctx.moveTo(0, GROUND);
    for (let x = 0; x <= W; x += 30) ctx.lineTo(x, GROUND - 46 - 22 * Math.sin(x * 0.012 + 2));
    ctx.lineTo(W, GROUND); ctx.fill();
    // ground
    const g = ctx.createLinearGradient(0, GROUND, 0, H);
    g.addColorStop(0, "#3b2a55");
    g.addColorStop(1, "#160f26");
    ctx.fillStyle = g;
    ctx.fillRect(0, GROUND, W, H - GROUND);
    ctx.fillStyle = "#5a4380";
    ctx.fillRect(0, GROUND, W, 3);
    ctx.fillStyle = "rgba(255,220,160,.08)";
    for (let x = 0; x < W; x += 64) ctx.fillRect(x + ((t * 6) % 64) * 0, GROUND + 18, 36, 2);
  };

  const drawHero = () => {
    const eq = game.current.equip;
    const bob = Math.sin(t * 5) * 2;
    const hx = HERO_X + (hurt > 0 ? Math.sin(t * 90) * 4 : 0);
    const by = GROUND;
    // aura from gear
    if (eq) {
      const a = ctx.createRadialGradient(hx, by - 70, 10, hx, by - 70, 120);
      a.addColorStop(0, eq.look.colors[0] + "55");
      a.addColorStop(1, eq.look.colors[0] + "00");
      ctx.fillStyle = a;
      ctx.beginPath(); ctx.arc(hx, by - 70, 120, 0, 7); ctx.fill();
    }
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.beginPath(); ctx.ellipse(hx, by + 4, 40, 8, 0, 0, 7); ctx.fill();
    // cape
    const sway = Math.sin(t * 3) * 6;
    ctx.fillStyle = "#8f1d2c";
    ctx.beginPath(); ctx.moveTo(hx - 18, by - 100 + bob); ctx.quadraticCurveTo(hx - 50 - sway, by - 50, hx - 44 - sway, by - 6);
    ctx.lineTo(hx + 4, by - 10); ctx.lineTo(hx + 10, by - 96 + bob); ctx.fill();
    // legs
    ctx.fillStyle = "#2b2547";
    ctx.fillRect(hx - 16, by - 44, 13, 42); ctx.fillRect(hx + 4, by - 44, 13, 42);
    ctx.fillStyle = "#17142b";
    ctx.fillRect(hx - 18, by - 8, 17, 8); ctx.fillRect(hx + 3, by - 8, 18, 8);
    // torso armour
    const armor = eq?.look.style === "guard" ? eq.look.colors[0] : "#c9c3e6";
    const tg = ctx.createLinearGradient(hx - 22, 0, hx + 22, 0);
    tg.addColorStop(0, "#5a5480"); tg.addColorStop(0.5, armor); tg.addColorStop(1, "#5a5480");
    ctx.fillStyle = tg;
    ctx.beginPath(); ctx.roundRect(hx - 22, by - 104 + bob, 44, 64, 10); ctx.fill();
    ctx.fillStyle = "#e9b23f";
    ctx.fillRect(hx - 22, by - 64 + bob, 44, 6);
    // helmet
    ctx.fillStyle = "#d9d3f0";
    ctx.beginPath(); ctx.roundRect(hx - 16, by - 140 + bob, 32, 36, 12); ctx.fill();
    ctx.fillStyle = "#17142b";
    ctx.fillRect(hx - 2, by - 128 + bob, 18, 7);
    ctx.fillStyle = eq ? eq.look.colors[1] : "#ffcf6a";
    ctx.fillRect(hx + 2, by - 126 + bob, 12, 3);
    ctx.fillStyle = "#e9b23f";
    ctx.beginPath(); ctx.moveTo(hx - 4, by - 140 + bob); ctx.quadraticCurveTo(hx - 24, by - 168 + bob, hx - 40 + sway * 0.4, by - 150 + bob); ctx.quadraticCurveTo(hx - 20, by - 150 + bob, hx - 10, by - 136 + bob); ctx.fill();

    // weapon arm
    const style = eq?.look.style;
    const ranged = style === "arrow" || style === "blast";
    const angle = ranged ? 0 : swing > 0 ? -1.4 + (1 - swing / 0.24) * 2.3 : -0.7 + Math.sin(t * 2) * 0.05;
    ctx.save();
    ctx.translate(hx + 16, by - 88 + bob);
    ctx.rotate(angle);
    ctx.fillStyle = "#c9c3e6";
    ctx.fillRect(0, -6, 28, 12);
    if (eq) {
      const im = img(eq.look.key);
      if (im.complete && im.naturalWidth) {
        ctx.shadowColor = eq.look.colors[0];
        ctx.shadowBlur = 24;
        const size = style === "guard" ? 84 : style === "wave" ? 96 : 150;
        // items are drawn diagonally in their art; rotate so they point forward
        const tilt = ranged ? 0.3 : style === "guard" || style === "wave" ? 0 : -0.75;
        ctx.save();
        ctx.translate(34, 0);
        ctx.rotate(tilt);
        ctx.drawImage(im, -size / 2, -size / 2, size, size);
        ctx.restore();
        ctx.shadowBlur = 0;
      }
    } else {
      ctx.fillStyle = "#d9d3f0";
      ctx.beginPath(); ctx.arc(32, 0, 9, 0, 7); ctx.fill();
    }
    ctx.restore();
  };

  const drawSlime = (s: Slime) => {
    const squish = 1 + Math.sin(s.phase) * 0.12;
    const w = s.size * 1.35 * squish;
    const h = (s.size * 1.1) / squish;
    ctx.fillStyle = "rgba(0,0,0,.3)";
    ctx.beginPath(); ctx.ellipse(s.x, s.y + 4, w, 7, 0, 0, 7); ctx.fill();
    const body = ctx.createRadialGradient(s.x - w * 0.3, s.y - h * 1.5, 2, s.x, s.y - h, w * 1.3);
    body.addColorStop(0, s.flash > 0 ? "#ffffff" : `hsl(${s.hue} 90% 78%)`);
    body.addColorStop(1, s.flash > 0 ? "#ffffff" : `hsl(${s.hue} 70% 38%)`);
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.ellipse(s.x, s.y - h, w, h, 0, 0, 7); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.45)";
    ctx.beginPath(); ctx.ellipse(s.x - w * 0.38, s.y - h * 1.45, w * 0.22, h * 0.18, -0.5, 0, 7); ctx.fill();
    ctx.fillStyle = "#120a1f";
    ctx.beginPath(); ctx.arc(s.x - s.size * 0.4, s.y - h * 1.1, s.size * 0.15, 0, 7); ctx.arc(s.x + s.size * 0.1, s.y - h * 1.1, s.size * 0.15, 0, 7); ctx.fill();
    if (s.size > 40) {
      ctx.fillStyle = "#ffd23d";
      ctx.beginPath();
      const cy = s.y - h * 2 - 4;
      ctx.moveTo(s.x - 22, cy); ctx.lineTo(s.x - 22, cy - 18); ctx.lineTo(s.x - 11, cy - 8); ctx.lineTo(s.x, cy - 22);
      ctx.lineTo(s.x + 11, cy - 8); ctx.lineTo(s.x + 22, cy - 18); ctx.lineTo(s.x + 22, cy); ctx.fill();
    }
    if (s.hp < s.max) {
      ctx.fillStyle = "rgba(0,0,0,.55)";
      ctx.fillRect(s.x - 24, s.y - h * 2 - 30, 48, 5);
      ctx.fillStyle = "#ff6b6b";
      ctx.fillRect(s.x - 24, s.y - h * 2 - 30, 48 * Math.max(0, s.hp / s.max), 5);
    }
  };

  const drawFx = () => {
    for (const f of fx) {
      ctx.save();
      if (f.t === "arc") {
        const p = 1 - f.life / f.max;
        ctx.globalAlpha = f.life / f.max;
        ctx.shadowColor = f.color; ctx.shadowBlur = 30;
        ctx.strokeStyle = f.color2; ctx.lineWidth = 14;
        ctx.beginPath(); ctx.arc(HERO_X + 60, GROUND - 80, 110 + p * 40, -1.3, 0.9); ctx.stroke();
        ctx.strokeStyle = f.color; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.arc(HERO_X + 50, GROUND - 80, 96 + p * 40, -1.2, 0.8); ctx.stroke();
      } else if (f.t === "ring") {
        ctx.globalAlpha = Math.max(0, f.life * 2.5);
        ctx.strokeStyle = f.color; ctx.lineWidth = 6; ctx.shadowColor = f.color; ctx.shadowBlur = 20;
        ctx.beginPath(); ctx.ellipse(f.x, f.y, f.r, f.r * 0.35, 0, 0, 7); ctx.stroke();
      } else if (f.t === "beam") {
        ctx.globalAlpha = f.life / 0.3;
        ctx.shadowColor = f.color; ctx.shadowBlur = 40;
        ctx.fillStyle = f.color; ctx.fillRect(HERO_X + 70, GROUND - 98, W, 22);
        ctx.fillStyle = "#ffffff"; ctx.fillRect(HERO_X + 70, GROUND - 92, W, 10);
      } else if (f.t === "bolt") {
        ctx.globalAlpha = f.life / 0.22;
        ctx.strokeStyle = "#e6fbff"; ctx.lineWidth = 5; ctx.shadowColor = "#3ad6e8"; ctx.shadowBlur = 30;
        ctx.beginPath(); ctx.moveTo(f.pts[0], 0);
        f.pts.forEach((x, i) => ctx.lineTo(x, (i + 1) * (GROUND / f.pts.length)));
        ctx.lineTo(f.x, GROUND - 20); ctx.stroke();
      } else if (f.t === "wave") {
        ctx.globalAlpha = Math.min(1, f.life);
        const g = ctx.createLinearGradient(f.x - 160, 0, f.x + 20, 0);
        g.addColorStop(0, f.color + "00"); g.addColorStop(0.7, f.color2 + "aa"); g.addColorStop(1, "#ffffff");
        ctx.fillStyle = g; ctx.shadowColor = f.color; ctx.shadowBlur = 40;
        ctx.beginPath(); ctx.moveTo(f.x - 160, GROUND);
        ctx.quadraticCurveTo(f.x - 40, GROUND - 260, f.x + 20, GROUND); ctx.fill();
      }
      ctx.restore();
    }
    for (const sh of shots) {
      ctx.save();
      ctx.shadowColor = sh.color; ctx.shadowBlur = 24;
      if (sh.kind === "arrow") {
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(sh.x - 60, sh.y); ctx.lineTo(sh.x, sh.y); ctx.stroke();
        ctx.fillStyle = sh.color;
        ctx.beginPath(); ctx.moveTo(sh.x + 16, sh.y); ctx.lineTo(sh.x - 4, sh.y - 8); ctx.lineTo(sh.x - 4, sh.y + 8); ctx.fill();
      } else {
        ctx.fillStyle = sh.color;
        ctx.beginPath(); ctx.ellipse(sh.x, sh.y, 26, 9, 0, 0, 7); ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath(); ctx.ellipse(sh.x + 6, sh.y, 12, 4, 0, 0, 7); ctx.fill();
      }
      ctx.restore();
    }
  };

  const draw = () => {
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * 12 * shake * 3, (Math.random() - 0.5) * 8 * shake * 3);
    drawWorld();
    slimes.forEach(drawSlime);
    drawHero();
    drawFx();
    for (const p of sparks) {
      ctx.globalAlpha = Math.max(0, p.life * 1.6);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    ctx.font = "700 20px Manrope Variable, system-ui, sans-serif";
    ctx.textAlign = "center";
    for (const f of floats) {
      ctx.globalAlpha = Math.min(1, f.life * 2);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    if (over) {
      ctx.fillStyle = "rgba(8,6,18,.78)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#f3ead7";
      ctx.font = "700 46px Cinzel, Georgia, serif";
      ctx.fillText("The slimes overran you", W / 2, H / 2 - 10);
      ctx.font = "500 19px Manrope Variable, system-ui, sans-serif";
      ctx.fillText(`${kills} slimes defeated. Click or press Space to fight again.`, W / 2, H / 2 + 30);
    }
  };

  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    draw();
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  const onKey = (e: KeyboardEvent) => {
    if (e.code !== "Space" || (e.target as HTMLElement)?.tagName === "INPUT") return;
    e.preventDefault();
    if (!e.repeat) attack();
  };
  window.addEventListener("keydown", onKey);
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", onKey);
  };
}
