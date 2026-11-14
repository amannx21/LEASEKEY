import { useEffect, useRef, useState } from "react";
import { Icon } from "./ui";

// Logical stage size; the canvas renders at device resolution and scales with CSS.
const W = 1200;
const H = 500;
// The gauntlet sits on the warrior's raised right hand; its cuff is at (260, 470) in the art.
const GAUNTLET = { x: 150, y: 28, size: 232 };
const GROUND = 470;
const BODY_X = 150;
// Stone centres and fingertip in the 512px gauntlet art.
const STONES = [
  { x: 199, y: 262, c: "#ff5a4a" },
  { x: 239, y: 262, c: "#4aa0ff" },
  { x: 279, y: 262, c: "#4aff8a" },
  { x: 319, y: 262, c: "#c05aff" },
  { x: 260, y: 308, c: "#ffc83a" },
];
const FINGERS = { x: 262, y: 110 };
const LINES = [
  { text: "Rent", x: 430, y: 250, size: 176 },
  { text: "in-game gear", x: 436, y: 370, size: 82 },
];

// Timeline in milliseconds.
const T_RISE = 700;
const T_STONES = 1500;
const T_SNAP = 1650;
const T_EMIT_SPAN = 1100;
const T_FLIGHT = 1300;
const T_SETTLE = T_SNAP + T_EMIT_SPAN + T_FLIGHT + 150;

type Mote = {
  tx: number; ty: number; sx: number; sy: number; cx: number; cy: number;
  delay: number; dur: number; size: number; hue: number; wob: number;
};

const art = (x: number, y: number) => ({
  x: GAUNTLET.x + (x / 512) * GAUNTLET.size,
  y: GAUNTLET.y + (y / 512) * GAUNTLET.size,
});

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const clamp = (v: number) => Math.max(0, Math.min(1, v));

export function HeroSnap({ onEnter, onArena }: { onEnter: () => void; onArena: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const leftRef = useRef<HTMLCanvasElement>(null);
  const rightRef = useRef<HTMLCanvasElement>(null);
  const [run, setRun] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const gauntlet = new Image();
    gauntlet.src = "/items/astral-gauntlet.svg";

    let raf = 0;
    let motes: Mote[] = [];
    let embers: { x: number; y: number; vy: number; life: number }[] = [];
    let start = 0;
    let stopped = false;

    // ------------------------------------------------ sound waves from the snap
    const origin = art(FINGERS.x, FINGERS.y);
    const WAVE_SPEED = 0.95; // px per ms
    let waves: number[] = []; // start times of live waves
    const fired = new Set<number>(); // every wave ever started, so none restarts
    let flares: number[] = []; // when a wave reaches the text, the side lightning flares

    /** Displacement of a point at (x, y) by every passing wave front. */
    const waveAt = (x: number, y: number, t: number) => {
      let dx = 0;
      let dy = 0;
      for (const w0 of waves) {
        const r = (t - w0) * WAVE_SPEED;
        if (r <= 0) continue;
        const ddx = x - origin.x;
        const ddy = y - origin.y;
        const d = Math.hypot(ddx, ddy) || 1;
        const band = r - d;
        if (band < -40 || band > 90) continue;
        const push = Math.sin(((band + 40) / 130) * Math.PI) * 16 * Math.max(0, 1 - r / 1600);
        dx += (ddx / d) * push;
        dy += (ddy / d) * push;
      }
      return { dx, dy };
    };

    /** A letter shakes in a damped wobble after each wave front passes it. */
    const shakeAt = (x: number, y: number, t: number) => {
      let ox = 0;
      let oy = 0;
      let rot = 0;
      for (const w0 of waves) {
        const hit = w0 + Math.hypot(x - origin.x, y - origin.y) / WAVE_SPEED;
        const k = t - hit;
        if (k < 0 || k > 900) continue;
        const damp = Math.exp(-k / 220);
        ox += Math.sin(k / 32) * 11 * damp;
        oy += Math.cos(k / 41) * 6 * damp;
        rot += Math.sin(k / 37) * 0.09 * damp;
      }
      return { ox, oy, rot };
    };

    const drawWaves = (t: number) => {
      for (const w0 of waves) {
        const r = (t - w0) * WAVE_SPEED;
        if (r <= 0 || r > 1500) continue;
        const fade = 1 - r / 1500;
        for (let k = 0; k < 3; k++) {
          const rr = r - k * 34;
          if (rr <= 0) continue;
          ctx.save();
          ctx.globalAlpha = fade * (0.55 - k * 0.15);
          ctx.strokeStyle = k === 0 ? "#fff1cf" : "#ffc76a";
          ctx.lineWidth = (k === 0 ? 4 : 2) * (0.6 + fade);
          ctx.shadowColor = "#ffb84a";
          ctx.shadowBlur = 18;
          ctx.beginPath();
          // only the arc facing the text, like a sound wave thrown forward
          ctx.arc(origin.x, origin.y, rr, -1.15, 1.25);
          ctx.stroke();
          ctx.restore();
        }
      }
    };

    const lastWave = (t: number): number | null => {
      const past = waves.filter((w) => w <= t);
      return past.length ? Math.max(...past) : null;
    };

    // ------------------------------------------------ lightning down both edges of the window
    // Lives only for a moment after each snap, then dies away completely.
    const edges = [leftRef.current!, rightRef.current!];
    const EDGE_W = 110;
    let edgeH = 0;
    const sizeEdges = () => {
      edgeH = window.innerHeight;
      for (const c of edges) {
        c.width = EDGE_W * dpr;
        c.height = edgeH * dpr;
        c.getContext("2d")!.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    };
    sizeEdges();
    window.addEventListener("resize", sizeEdges);
    let edgeClear = true;

    const bolt = (e: CanvasRenderingContext2D, x0: number, spread: number) => {
      const pts: [number, number][] = [];
      for (let y = -10; y <= edgeH + 20; y += 18 + Math.random() * 14) pts.push([x0 + (Math.random() - 0.5) * spread, y]);
      e.beginPath();
      pts.forEach(([x, y], i) => (i ? e.lineTo(x, y) : e.moveTo(x, y)));
      e.stroke();
      // a few short forks reaching inward
      for (let k = 0; k < 4; k++) {
        const [fx, fy] = pts[Math.floor(Math.random() * pts.length)];
        e.beginPath();
        e.moveTo(fx, fy);
        let x = fx;
        let y = fy;
        for (let j = 0; j < 4; j++) {
          x += 8 + Math.random() * 14;
          y += (Math.random() - 0.3) * 26;
          e.lineTo(x, y);
        }
        e.stroke();
      }
    };

    const drawEdges = (t: number) => {
      const since = Math.min(...flares.filter((f) => t >= f).map((f) => t - f), Infinity);
      const intensity = Math.max(0, 1 - since / 1100);
      if (intensity <= 0) {
        if (!edgeClear) {
          edges.forEach((c) => c.getContext("2d")!.clearRect(0, 0, EDGE_W, edgeH));
          edgeClear = true;
        }
        return;
      }
      edgeClear = false;
      edges.forEach((c, side) => {
        const e = c.getContext("2d")!;
        e.clearRect(0, 0, EDGE_W, edgeH);
        // mirror the right edge so bolts always hug the window border
        e.save();
        if (side === 1) {
          e.translate(EDGE_W, 0);
          e.scale(-1, 1);
        }
        const glow = e.createLinearGradient(0, 0, EDGE_W, 0);
        glow.addColorStop(0, `rgba(120, 200, 255, ${0.45 * intensity})`);
        glow.addColorStop(0.35, `rgba(150, 110, 255, ${0.18 * intensity})`);
        glow.addColorStop(1, "rgba(120, 200, 255, 0)");
        e.fillStyle = glow;
        e.fillRect(0, 0, EDGE_W, edgeH);
        if (since < 650 || Math.random() < intensity * 0.5) {
          e.lineCap = "round";
          e.lineJoin = "round";
          e.globalAlpha = Math.min(1, 0.4 + intensity);
          e.strokeStyle = "rgba(170, 120, 255, 0.7)";
          e.lineWidth = 5;
          e.shadowColor = "#a46bff";
          e.shadowBlur = 24;
          bolt(e, 14, 22);
          e.strokeStyle = "#e6f8ff";
          e.lineWidth = 1.8;
          e.shadowColor = "#5cc8ff";
          e.shadowBlur = 18;
          bolt(e, 14, 22);
        }
        e.restore();
      });
    };

    // Sample the final lettering into target points for the dust.
    const buildMotes = () => {
      const off = document.createElement("canvas");
      off.width = W;
      off.height = H;
      const o = off.getContext("2d")!;
      o.fillStyle = "#fff";
      for (const l of LINES) {
        o.font = `700 ${l.size}px Cinzel, Georgia, serif`;
        o.fillText(l.text, l.x, l.y);
      }
      const data = o.getImageData(0, 0, W, H).data;
      const step = 3;
      const src = art(FINGERS.x, FINGERS.y);
      const out: Mote[] = [];
      for (let y = 0; y < H; y += step) {
        for (let x = 0; x < W; x += step) {
          if (data[(y * W + x) * 4 + 3] < 128) continue;
          const left = (x - 430) / 700;
          out.push({
            tx: x + Math.random() * 1.5, ty: y + Math.random() * 1.5,
            sx: src.x + (Math.random() - 0.5) * 60, sy: src.y + (Math.random() - 0.5) * 50,
            // arc up and over before settling, like ash carried on air
            cx: x - 120 - Math.random() * 160, cy: Math.min(y, src.y) - 120 - Math.random() * 140,
            delay: T_SNAP + clamp(left) * T_EMIT_SPAN + Math.random() * 220,
            dur: T_FLIGHT * (0.75 + Math.random() * 0.5),
            size: 1.4 + Math.random() * 1.8,
            hue: Math.random(),
            wob: Math.random() * Math.PI * 2,
          });
        }
      }
      return out;
    };

    /** The warrior who wears the gauntlet. `jx, jy` is the snap jolt of the raised arm. */
    const drawWarrior = (t: number, rise: number, jx: number, jy: number, lift: number) => {
      const x = BODY_X;
      const g = GROUND;
      const sway = Math.sin(t / 700) * 4;
      ctx.save();
      ctx.globalAlpha = rise;
      ctx.translate(0, lift);
      // shadow
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.beginPath();
      ctx.ellipse(x, g + 3, 58, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      // cape
      const cape = ctx.createLinearGradient(x - 40, 300, x + 40, g);
      cape.addColorStop(0, "#b3262f");
      cape.addColorStop(1, "#3d0a14");
      ctx.fillStyle = cape;
      ctx.beginPath();
      ctx.moveTo(x - 30, 300);
      ctx.quadraticCurveTo(x - 62 - sway, 390, x - 72 - sway, g - 2);
      ctx.lineTo(x + 30 - sway * 0.5, g - 2);
      ctx.quadraticCurveTo(x + 22, 380, x + 26, 300);
      ctx.fill();
      // legs and boots
      ctx.fillStyle = "#2b2547";
      ctx.fillRect(x - 22, 392, 19, g - 392 - 8);
      ctx.fillRect(x + 3, 392, 19, g - 392 - 8);
      ctx.fillStyle = "#17142b";
      ctx.fillRect(x - 25, g - 12, 24, 12);
      ctx.fillRect(x + 1, g - 12, 26, 12);
      // torso plate
      const steel = ctx.createLinearGradient(x - 34, 0, x + 34, 0);
      steel.addColorStop(0, "#5a5480");
      steel.addColorStop(0.5, "#ece8ff");
      steel.addColorStop(1, "#5a5480");
      ctx.fillStyle = steel;
      ctx.beginPath();
      ctx.roundRect(x - 34, 290, 68, 110, 14);
      ctx.fill();
      ctx.fillStyle = "#e9b23f";
      ctx.fillRect(x - 34, 362, 68, 8);
      ctx.beginPath();
      ctx.arc(x, 328, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ff7a3d";
      ctx.beginPath();
      ctx.arc(x, 328, 4, 0, Math.PI * 2);
      ctx.fill();
      // left arm, relaxed
      ctx.strokeStyle = "#c9c3e6";
      ctx.lineCap = "round";
      ctx.lineWidth = 16;
      ctx.beginPath();
      ctx.moveTo(x - 30, 304);
      ctx.lineTo(x - 44, 380);
      ctx.stroke();
      // helmet with a glowing visor and a gold plume
      ctx.fillStyle = "#e9b23f";
      ctx.beginPath();
      ctx.moveTo(x - 6, 238);
      ctx.quadraticCurveTo(x - 30, 200, x - 58 + sway, 214);
      ctx.quadraticCurveTo(x - 30, 214, x - 14, 244);
      ctx.fill();
      ctx.fillStyle = steel;
      ctx.beginPath();
      ctx.roundRect(x - 24, 234, 48, 58, 16);
      ctx.fill();
      ctx.fillStyle = "#120f22";
      ctx.fillRect(x - 18, 256, 36, 9);
      ctx.fillStyle = "#ffd27a";
      ctx.shadowColor = "#ffb84a";
      ctx.shadowBlur = 12;
      ctx.fillRect(x - 13, 259, 26, 3);
      ctx.shadowBlur = 0;
      // raised right arm up to the gauntlet's cuff
      const wrist = art(260, 452);
      ctx.strokeStyle = steel;
      ctx.lineWidth = 20;
      ctx.beginPath();
      ctx.moveTo(x + 30, 304);
      ctx.lineTo(wrist.x + jx, wrist.y + jy);
      ctx.stroke();
      ctx.fillStyle = "#e9b23f";
      ctx.beginPath();
      ctx.arc(x + 28, 302, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    const drawGauntlet = (t: number) => {
      if (!gauntlet.complete || !gauntlet.naturalWidth) return;
      const rise = easeOut(clamp(t / T_RISE));
      const w0 = lastWave(t);
      const snap = w0 !== null ? Math.max(0, 1 - (t - w0) / 260) : 0;
      const scale = 1 + snap * 0.06;
      const idle = t > T_SETTLE ? Math.sin((t - T_SETTLE) / 900) * 3 : 0;
      // the snap jolts the raised arm up and forward
      const jolt = w0 !== null && t - w0 < 320 ? Math.sin(((t - w0) / 320) * Math.PI) : 0;
      const jx = jolt * 8;
      const jy = -jolt * 10 + idle;
      const lift = (1 - rise) * 40;
      drawWarrior(t, rise, jx, jy, lift);
      const g = GAUNTLET;
      ctx.save();
      ctx.translate(jx, jy - idle + lift);
      ctx.save();
      ctx.globalAlpha = rise;
      ctx.translate(g.x + g.size / 2, g.y + g.size / 2 + idle);
      ctx.scale(scale, scale);
      ctx.translate(-g.size / 2, -g.size / 2);
      ctx.shadowColor = "rgba(255, 200, 90, 0.55)";
      ctx.shadowBlur = 40;
      ctx.drawImage(gauntlet, 0, 0, g.size, g.size);
      ctx.restore();

      // stones light up one by one, then pulse
      STONES.forEach((s, i) => {
        const on = clamp((t - T_RISE - i * ((T_STONES - T_RISE) / STONES.length)) / 180);
        if (on <= 0) return;
        const p = art(s.x, s.y);
        const pulse = t > T_SETTLE ? 0.75 + 0.25 * Math.sin(t / 400 + i) : 1;
        const r = (18 + snap * 26) * pulse;
        const glow = ctx.createRadialGradient(p.x, p.y + idle, 0, p.x, p.y + idle, r);
        glow.addColorStop(0, "rgba(255,255,255,0.95)");
        glow.addColorStop(0.35, s.c);
        glow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.globalAlpha = on * rise;
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y + idle, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      });

      // the snap: a flash at the fingertips
      if (w0 !== null && t < w0 + 700) {
        const k = (t - w0) / 700;
        const p = art(FINGERS.x, FINGERS.y);
        const flash = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 40 + k * 260);
        flash.addColorStop(0, `rgba(255,248,225,${0.9 * (1 - k)})`);
        flash.addColorStop(0.4, `rgba(255,190,90,${0.45 * (1 - k)})`);
        flash.addColorStop(1, "rgba(255,140,60,0)");
        ctx.fillStyle = flash;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 40 + k * 260, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };

    const drawMotes = (t: number) => {
      for (const m of motes) {
        const k = (t - m.delay) / m.dur;
        if (k <= 0) continue;
        const e = easeOut(clamp(k));
        // quadratic bezier from the fingertips, up and over, onto the letter
        const u = 1 - e;
        let x = u * u * m.sx + 2 * u * e * m.cx + e * e * m.tx;
        let y = u * u * m.sy + 2 * u * e * m.cy + e * e * m.ty;
        // drifting turbulence that calms as the mote lands
        const drift = (1 - e) * 14;
        x += Math.sin(t / 260 + m.wob) * drift;
        y += Math.cos(t / 310 + m.wob * 1.3) * drift;
        const wv = waveAt(x, y, t);
        x += wv.dx;
        y += wv.dy;
        // ash grey to ember to gold as it settles
        const heat = e;
        const r = Math.round(140 + (255 - 140) * heat);
        const gch = Math.round(122 + (214 - 122) * heat * (0.8 + m.hue * 0.2));
        const b = Math.round(104 + (130 - 104) * heat);
        // landed grains stay grainy: they shimmer, and shake when a wave hits the word
        if (e >= 1) {
          const sh = shakeAt(m.tx, m.ty - 30, t);
          x += sh.ox;
          y += sh.oy;
        }
        const shimmer = e >= 1 ? 0.82 + 0.18 * Math.sin(t / 380 + m.wob * 3) : 1;
        ctx.globalAlpha = (0.35 + 0.65 * e) * shimmer;
        ctx.fillStyle = `rgb(${r},${gch},${b})`;
        const s = m.size * (1 + (1 - e) * 0.8);
        ctx.fillRect(x, y, s, s);
      }
      ctx.globalAlpha = 1;
    };

    const drawEmbers = (t: number, dt: number) => {
      if (t > T_SETTLE && Math.random() < 0.35 && motes.length) {
        const m = motes[Math.floor(Math.random() * motes.length)];
        embers.push({ x: m.tx, y: m.ty, vy: 12 + Math.random() * 20, life: 1 });
      }
      for (const e of embers) {
        e.y -= e.vy * dt;
        e.x += Math.sin(e.y / 20) * 0.3;
        e.life -= dt * 0.45;
        ctx.globalAlpha = Math.max(0, e.life) * 0.7;
        ctx.fillStyle = "#ffc98a";
        ctx.fillRect(e.x, e.y, 1.6, 1.6);
      }
      ctx.globalAlpha = 1;
      embers = embers.filter((e) => e.life > 0);
    };

    let last = performance.now();
    const frame = (now: number) => {
      if (stopped) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now - start;
      ctx.clearRect(0, 0, W, H);
      // schedule: the snap, an aftershock that hits the finished words, then a soft pulse every 7s
      const due = [T_SNAP, T_SETTLE + 300];
      for (let k = T_SETTLE + 9300; k < t + 1; k += 9000) due.push(k);
      for (const d of due) {
        if (t >= d && !fired.has(d)) {
          fired.add(d);
          waves.push(d);
          flares.push(d);
        }
      }
      waves = waves.filter((w) => t - w < 2600);
      flares = flares.filter((f) => t - f < 3000);
      drawWaves(t);
      drawGauntlet(t);
      drawMotes(t);
      drawEdges(t);
      drawEmbers(t, dt);
      raf = requestAnimationFrame(frame);
    };

    document.fonts.load("700 176px Cinzel").finally(() => {
      if (stopped) return;
      motes = buildMotes();
      start = performance.now() - (reduced ? T_SETTLE + 1000 : 0);
      raf = requestAnimationFrame(frame);
    });
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", sizeEdges);
    };
  }, [run]);

  return (
    <section className="hero">
      <h1 className="sr-only">Rent in-game gear. Every item is its own NEAR account.</h1>
      <canvas ref={canvasRef} className="hero-canvas" aria-hidden="true" />
      <canvas ref={leftRef} className="edge-bolt left" aria-hidden="true" />
      <canvas ref={rightRef} className="edge-bolt right" aria-hidden="true" />
      <div className="hero-copy">
        <p className="lede">
          LeaseKey is a rental layer for blockchain games. Players lend the items they own without handing them over,
          and renters play without collateral. Every item is its own NEAR account that knows which game it belongs to,
          rents itself out, and pays its owner and its game.
        </p>
        <div className="hero-ctas">
          <button className="primary big" onClick={onEnter}>
            Enter the armory <Icon name="arrow" />
          </button>
          <button className="ghost big" onClick={onArena}>Fight in the arena</button>
          <button className="link" onClick={() => setRun((n) => n + 1)}>Replay the snap</button>
        </div>
      </div>
    </section>
  );
}
