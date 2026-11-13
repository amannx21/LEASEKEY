import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EXPLORER, FACTORY_ID, Session, call, errorText, fmtNear, sessionKeyFor, type Settlement } from "./near";
import { useChain } from "./store";
import { AccountLink, artUrl, fmtClock, itemColors, useTimeLeft } from "./ui";

type Feed = { id: number; label: string; state: "pending" | "ok" | "fail"; note?: string; hash?: string };
type Slime = { x: number; hp: number; max: number; speed: number; phase: number; flash: number; size: number };
type Wave = { x: number; power: number; hit: Set<Slime> };
type Spark = { x: number; y: number; vx: number; vy: number; life: number; color: string };
type Float = { x: number; y: number; text: string; life: number; color: string };

const W = 960;
const H = 440;
const GROUND = 350;
const HERO_X = 150;
const FIST_DAMAGE = 6;

export function Arena() {
  const c = useChain();
  const item =
    c.items.find((i) => i.account_id === c.arenaItem && i.renter === c.me?.accountId) ??
    c.items.find((i) => i.renter === c.me?.accountId && !!sessionKeyFor(i) && i.rental_active) ??
    null;
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
  const [score, setScore] = useState(0);
  const [hp, setHp] = useState(100);
  const settling = useRef<string | null>(null);

  useEffect(() => {
    if (session && item) {
      setUsesLeft(item.uses_left);
      setEnded(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const armed = !!session && timeLeft > 0 && usesLeft > 0 && item!.durability > 0;

  const pushFeed = useCallback((entry: Omit<Feed, "id">) => {
    const id = Date.now() + Math.random();
    setFeed((f) => [{ id, ...entry }, ...f].slice(0, 9));
    return id;
  }, []);
  const patchFeed = useCallback((id: number, patch: Partial<Feed>) => {
    setFeed((f) => f.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }, []);

  /** One strong attack = one use_item transaction signed by the session key. No wallet. */
  const strike = useCallback(() => {
    if (!session) return;
    setUsesLeft((n) => Math.max(0, n - 1));
    const id = pushFeed({ label: "use_item(slash)", state: "pending" });
    const started = performance.now();
    session
      .useItem("slash")
      .then(({ value, hash }) => {
        patchFeed(id, {
          state: "ok",
          hash,
          note: `${((performance.now() - started) / 1000).toFixed(1)}s · durability ${value.durability}`,
        });
        setUsesLeft((n) => Math.min(n, value.uses_left));
      })
      .catch((e) => {
        const text = errorText(e);
        patchFeed(id, { state: "fail", note: text });
        if (/lease expired|not rented|no longer exists|not the renter/.test(text)) setUsesLeft(0);
      });
  }, [session, pushFeed, patchFeed]);

  // Lease ran out: the sword stops, then the rental is settled on chain.
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

  const colors = item ? itemColors(item.image) : (["#cfd6e4", "#ffffff"] as [string, string]);
  const game = useRef({ armed, power: item?.power ?? 0, colors, strike, setScore, setHp });
  game.current = { armed, power: item?.power ?? 0, colors, strike, setScore, setHp };
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const attackRef = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let slimes: Slime[] = [];
    let waves: Wave[] = [];
    let sparks: Spark[] = [];
    let floats: Float[] = [];
    let heroHp = 100;
    let kills = 0;
    let swing = 0;
    let hurt = 0;
    let cooldown = 0;
    let spawnIn = 1;
    let over = false;
    let t = 0;
    let raf = 0;
    let last = performance.now();

    const reset = () => {
      slimes = []; waves = []; sparks = []; floats = [];
      heroHp = 100; kills = 0; over = false; spawnIn = 1;
      game.current.setScore(0); game.current.setHp(100);
    };

    const burst = (x: number, y: number, color: string, n = 10) => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = 60 + Math.random() * 200;
        sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, life: 0.5 + Math.random() * 0.3, color });
      }
    };

    const damage = (s: Slime, amount: number, color: string) => {
      s.hp -= amount;
      s.flash = 0.12;
      floats.push({ x: s.x, y: GROUND - s.size * 2 - 10, text: `-${amount}`, life: 0.8, color });
      burst(s.x, GROUND - s.size, color, 6);
      if (s.hp <= 0) {
        kills += 1;
        game.current.setScore(kills);
        burst(s.x, GROUND - s.size, "#7ee081", 16);
      }
    };

    const attack = () => {
      if (over) return reset();
      if (cooldown > 0) return;
      cooldown = 0.3;
      swing = 0.22;
      const g = game.current;
      if (g.armed) {
        waves.push({ x: HERO_X + 50, power: g.power, hit: new Set() });
        g.strike();
      } else {
        const target = slimes.filter((s) => s.x - HERO_X < 130).sort((a, b) => a.x - b.x)[0];
        if (target) damage(target, FIST_DAMAGE, "#cfd6e4");
      }
    };
    attackRef.current = attack;

    const update = (dt: number) => {
      t += dt;
      cooldown = Math.max(0, cooldown - dt);
      swing = Math.max(0, swing - dt);
      hurt = Math.max(0, hurt - dt);
      if (!over) {
        spawnIn -= dt;
        if (spawnIn <= 0) {
          spawnIn = Math.max(0.75, 1.9 - kills * 0.02) * (0.7 + Math.random() * 0.6);
          const max = 28 + Math.min(60, kills * 0.8);
          slimes.push({ x: W + 30, hp: max, max, speed: 42 + Math.random() * 30 + kills * 0.3, phase: Math.random() * 6, flash: 0, size: 20 + Math.random() * 8 });
        }
      }
      for (const s of slimes) {
        s.x -= s.speed * dt;
        s.phase += dt * 6;
        s.flash = Math.max(0, s.flash - dt);
        if (!over && s.hp > 0 && s.x < HERO_X + 34) {
          s.hp = 0;
          heroHp = Math.max(0, heroHp - 12);
          hurt = 0.3;
          game.current.setHp(heroHp);
          burst(HERO_X + 20, GROUND - 40, "#ff6b6b", 12);
          if (heroHp <= 0) over = true;
        }
      }
      for (const w of waves) {
        w.x += 720 * dt;
        for (const s of slimes) {
          if (s.hp > 0 && !w.hit.has(s) && Math.abs(s.x - w.x) < 34) {
            w.hit.add(s);
            damage(s, w.power, game.current.colors[0]);
          }
        }
      }
      slimes = slimes.filter((s) => s.hp > 0 && s.x > -40);
      waves = waves.filter((w) => w.x < W + 60);
      for (const p of sparks) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 520 * dt; p.life -= dt; }
      sparks = sparks.filter((p) => p.life > 0);
      for (const f of floats) { f.y -= 46 * dt; f.life -= dt; }
      floats = floats.filter((f) => f.life > 0);
    };

    const draw = () => {
      const g = game.current;
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, "#131a2e");
      sky.addColorStop(1, "#27314f");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "rgba(255,255,255,.5)";
      for (let i = 0; i < 40; i++) ctx.fillRect((i * 137) % W, (i * 71) % 190, 2, 2);
      ctx.fillStyle = "#1c2440";
      ctx.beginPath();
      ctx.moveTo(0, GROUND);
      for (let x = 0; x <= W; x += 60) ctx.lineTo(x, GROUND - 60 - 34 * Math.sin(x * 0.011) - 20 * Math.sin(x * 0.027));
      ctx.lineTo(W, GROUND);
      ctx.fill();
      ctx.fillStyle = "#2f6b3f";
      ctx.fillRect(0, GROUND, W, H - GROUND);
      ctx.fillStyle = "#3d8a52";
      ctx.fillRect(0, GROUND, W, 8);

      // hero
      const bob = Math.sin(t * 5) * 2;
      const hx = HERO_X + (hurt > 0 ? Math.sin(t * 90) * 4 : 0);
      ctx.fillStyle = "rgba(0,0,0,.3)";
      ctx.beginPath(); ctx.ellipse(hx, GROUND + 4, 30, 7, 0, 0, 7); ctx.fill();
      ctx.fillStyle = hurt > 0 ? "#ff8a8a" : "#4f7cff";
      ctx.beginPath(); ctx.roundRect(hx - 18, GROUND - 62 + bob, 36, 50, 10); ctx.fill();
      ctx.fillStyle = "#26335c";
      ctx.fillRect(hx - 14, GROUND - 14, 11, 14); ctx.fillRect(hx + 3, GROUND - 14, 11, 14);
      ctx.fillStyle = "#ffd9b3";
      ctx.beginPath(); ctx.arc(hx, GROUND - 76 + bob, 16, 0, 7); ctx.fill();
      ctx.fillStyle = "#1b2238";
      ctx.fillRect(hx + 5, GROUND - 80 + bob, 4, 5);
      ctx.fillStyle = "#c33";
      ctx.beginPath(); ctx.arc(hx, GROUND - 82 + bob, 16, Math.PI, 0); ctx.fill();

      // arm and weapon
      const angle = swing > 0 ? -1.1 + (1 - swing / 0.22) * 2.0 : -0.5 + Math.sin(t * 2) * 0.05;
      ctx.save();
      ctx.translate(hx + 14, GROUND - 44 + bob);
      ctx.rotate(angle);
      ctx.fillStyle = "#ffd9b3";
      ctx.fillRect(0, -4, 20, 8);
      if (g.armed) {
        ctx.shadowColor = g.colors[0];
        ctx.shadowBlur = 18;
        const blade = ctx.createLinearGradient(18, 0, 78, 0);
        blade.addColorStop(0, g.colors[0]);
        blade.addColorStop(1, g.colors[1]);
        ctx.fillStyle = blade;
        ctx.beginPath(); ctx.moveTo(22, -6); ctx.lineTo(80, 0); ctx.lineTo(22, 6); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#c9a227";
        ctx.fillRect(18, -11, 5, 22);
      }
      ctx.restore();

      for (const w of waves) {
        ctx.save();
        ctx.shadowColor = g.colors[0];
        ctx.shadowBlur = 24;
        ctx.strokeStyle = g.colors[1];
        ctx.lineWidth = 7;
        ctx.beginPath(); ctx.arc(w.x - 26, GROUND - 44, 50, -0.9, 0.9); ctx.stroke();
        ctx.strokeStyle = g.colors[0];
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(w.x - 40, GROUND - 44, 50, -0.8, 0.8); ctx.stroke();
        ctx.restore();
      }

      for (const s of slimes) {
        const squish = 1 + Math.sin(s.phase) * 0.12;
        const w = s.size * 1.35 * squish;
        const h = s.size * 1.1 / squish;
        ctx.fillStyle = "rgba(0,0,0,.28)";
        ctx.beginPath(); ctx.ellipse(s.x, GROUND + 4, w, 6, 0, 0, 7); ctx.fill();
        ctx.fillStyle = s.flash > 0 ? "#ffffff" : "#58c96a";
        ctx.beginPath(); ctx.ellipse(s.x, GROUND - h, w, h, 0, 0, 7); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,.35)";
        ctx.beginPath(); ctx.ellipse(s.x - w * 0.35, GROUND - h * 1.4, w * 0.25, h * 0.2, -0.5, 0, 7); ctx.fill();
        ctx.fillStyle = "#11331a";
        ctx.beginPath(); ctx.arc(s.x - 9, GROUND - h * 1.1, 3.5, 0, 7); ctx.arc(s.x + 3, GROUND - h * 1.1, 3.5, 0, 7); ctx.fill();
        if (s.hp < s.max) {
          ctx.fillStyle = "rgba(0,0,0,.5)";
          ctx.fillRect(s.x - 20, GROUND - h * 2 - 14, 40, 5);
          ctx.fillStyle = "#ff6b6b";
          ctx.fillRect(s.x - 20, GROUND - h * 2 - 14, 40 * Math.max(0, s.hp / s.max), 5);
        }
      }
      for (const p of sparks) {
        ctx.globalAlpha = Math.max(0, p.life * 1.6);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, 4, 4);
      }
      ctx.globalAlpha = 1;
      ctx.font = "bold 18px system-ui, sans-serif";
      ctx.textAlign = "center";
      for (const f of floats) {
        ctx.globalAlpha = Math.min(1, f.life * 2);
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, f.x, f.y);
      }
      ctx.globalAlpha = 1;

      if (over) {
        ctx.fillStyle = "rgba(8,10,20,.72)";
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 40px system-ui, sans-serif";
        ctx.fillText("The slimes got you", W / 2, H / 2 - 10);
        ctx.font = "18px system-ui, sans-serif";
        ctx.fillText(`${kills} slimes defeated · click or press Space to try again`, W / 2, H / 2 + 26);
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
  }, []);

  return (
    <section className="arena">
      <div className="arena-main">
        <div className="hud">
          {session && item ? (
            <div className={`weapon ${armed ? "live" : "dead"}`}>
              <img src={artUrl(item.image)} alt="" />
              <div>
                <b>{item.name}</b> <span className="pill">leased</span>
                <small>
                  {timeLeft > 0 ? <>lease ends in <span className="mono big">{fmtClock(timeLeft)}</span></> : "lease ended"}
                  {" · "}{usesLeft} strikes left · power {item.power}
                </small>
              </div>
              {timeLeft > 0 && (
                <button
                  disabled={!!c.busy}
                  title="Add 2 minutes to this lease. Same session key."
                  onClick={() =>
                    c.run("Extending lease…", (me) =>
                      call(me, item.account_id, "extend", { extra_secs: "120" },
                        (BigInt(item.price_per_hour) * 120n) / 3600n + 1n))}
                >
                  +2 min
                </button>
              )}
            </div>
          ) : (
            <div className="weapon dead">
              <div className="fist">✊</div>
              <div>
                <b>Bare fists</b>
                <small>{FIST_DAMAGE} damage. Rent a weapon to hit much harder.</small>
              </div>
              <button className="primary" onClick={() => c.setPage("market")}>Rent a weapon</button>
            </div>
          )}
          <div className="score">
            <span>Slimes <b>{score}</b></span>
            <span className="hp"><i style={{ width: `${hp}%` }} /></span>
          </div>
        </div>

        <div className="stage">
          <canvas ref={canvasRef} width={W} height={H} onPointerDown={() => attackRef.current()} />
          {ended && (
            <div className="ended">
              <h3>Your lease on {ended.name} ended</h3>
              {ended.settlement ? (
                <p>
                  Settled on chain. Owner earned <b>{fmtNear(ended.settlement.owner_cut, 5)} NEAR</b>, game creator{" "}
                  <b>{fmtNear(ended.settlement.creator_cut, 5)} NEAR</b>, you got{" "}
                  <b>{fmtNear(ended.settlement.renter_refund, 4)} NEAR</b> of unused gas budget back. Your session key
                  was deleted.
                </p>
              ) : (
                <p>The sword stopped working the moment the lease expired. Settling the rental on chain…</p>
              )}
              <div>
                <button className="primary" onClick={() => c.setPage("market")}>Rent again</button>
                <button className="ghost" onClick={() => setEnded(null)}>Keep punching</button>
              </div>
            </div>
          )}
        </div>
        <p className="muted hint">
          Space or click to attack. Every armed strike is a real <code>use_item</code> transaction signed in this
          browser by your session key. No wallet pop-ups, and the item account pays the gas.
        </p>
      </div>

      <aside className="panel side">
        <h3>On-chain feed</h3>
        {feed.length === 0 && <p className="muted">Strikes with a rented weapon show up here as transactions.</p>}
        <ul className="feed">
          {feed.map((f) => (
            <li key={f.id} className={f.state}>
              <span className="dot" />
              <div>
                <b>{f.label}</b>
                {f.state === "pending" && <small>sending…</small>}
                {f.note && <small>{f.note}</small>}
                {f.hash && (
                  <a href={`${EXPLORER}/txns/${f.hash}`} target="_blank" rel="noreferrer">
                    tx {f.hash.slice(0, 8)}…
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>

        <h3>Try to cheat</h3>
        <p className="muted">Use the same session key for anything other than playing.</p>
        <div className="cheats">
          <button
            disabled={!session || !c.me}
            onClick={() =>
              cheat("nft_transfer(sword → me)", "nft_transfer",
                { receiver_id: c.me!.accountId, token_id: item!.token_id }, FACTORY_ID, 1n)}
          >
            Transfer the NFT to myself
          </button>
          <button disabled={!session} onClick={() => cheat("unlist()", "unlist", {}, item!.account_id)}>
            Take the item off the market
          </button>
          <button disabled={!session} onClick={() => cheat("claim() earnings", "claim", {}, item!.account_id)}>
            Withdraw the item's earnings
          </button>
        </div>
        {item && session && (
          <p className="muted small">
            Item account: <AccountLink id={item.account_id} />
          </p>
        )}
      </aside>
    </section>
  );
}
