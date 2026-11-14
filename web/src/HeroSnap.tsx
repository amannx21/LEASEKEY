import { useEffect, useRef, useState } from "react";
import { Icon } from "./ui";

// The hero plays once when the page opens: a knight raises the Thunder Hammer,
// it charges, he swings, and an electric beam blasts into the headline, which
// forms out of glowing dust while thunder strikes around him and the words.
// Everything is drawn with additive light on a transparent canvas, so it reads
// as light falling on the page rather than a box on top of it.

const W = 1200;
const H = 520;
// The canvas bleeds past the content column so light fades out into the page instead of stopping at an edge.
const PAD = 180;
const GROUND = 478;
const BODY_X = 160;
const LINES = [
  { text: "Rent", x: 440, y: 250, size: 176 },
  { text: "in-game gear", x: 446, y: 372, size: 82 },
];
const TARGET = { x: 520, y: 200 }; // where the beam lands

// timeline, ms
const T_RISE = 700;
const T_CHARGE = 1550;
const T_SWING = 1720;
const T_BEAM_END = 2450;
const T_EMIT_SPAN = 900;
const T_FLIGHT = 1150;
const T_SETTLE = T_SWING + T_EMIT_SPAN + T_FLIGHT + 250;
const T_FINAL_STRIKE = T_SETTLE + 150;
const T_DONE = T_FINAL_STRIKE + 1400;

// thunder strikes: when, and where they land (relative to the canvas)
const STRIKES = [
  { t: T_SWING + 30, x: 600, y: 120 },
  { t: T_SWING + 260, x: 1030, y: 320 },
  { t: T_SWING + 520, x: 250, y: 150 },
  { t: T_SWING + 840, x: 900, y: 120 },
  { t: T_SWING + 1200, x: 60, y: 300 },
  { t: T_FINAL_STRIKE, x: 760, y: 170 },
];

type Mote = { tx: number; ty: number; sx: number; sy: number; cx: number; cy: number; delay: number; dur: number; size: number; hue: number; wob: number };
type Bolt = { pts: [number, number][]; forks: [number, number][][]; born: number; life: number; width: number };

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t: number) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** A jagged path from a to b, with the given roughness. */
function jag(ax: number, ay: number, bx: number, by: number, rough: number, steps = 14): [number, number][] {
  const pts: [number, number][] = [[ax, ay]];
  const nx = -(by - ay);
  const ny = bx - ax;
  const nl = Math.hypot(nx, ny) || 1;
  for (let i = 1; i < steps; i++) {
    const k = i / steps;
    const off = (Math.random() - 0.5) * rough * Math.sin(k * Math.PI);
    pts.push([lerp(ax, bx, k) + (nx / nl) * off, lerp(ay, by, k) + (ny / nl) * off]);
  }
  pts.push([bx, by]);
  return pts;
}

export function HeroSnap({ onEnter, onArena }: { onEnter: () => void; onArena: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [run, setRun] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = (W + PAD * 2) * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.translate(PAD, 0);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hammer = new Image();
    hammer.src = "/items/thunder-hammer.svg";
    let hammerBitmap: HTMLCanvasElement | null = null;
    const GLOW = 30;
    hammer.onload = () => {
      const c = document.createElement("canvas");
      c.width = (HSIZE + GLOW * 2) * dpr;
      c.height = (HSIZE + GLOW * 2) * dpr;
      const h = c.getContext("2d")!;
      h.scale(dpr, dpr);
      h.shadowColor = "rgba(140, 200, 255, 0.85)";
      h.shadowBlur = 22;
      h.drawImage(hammer, GLOW, GLOW, HSIZE, HSIZE);
      hammerBitmap = c;
    };

    let raf = 0;
    let stopped = false;
    let start = 0;
    let motes: Mote[] = [];
    let bolts: Bolt[] = [];
    let beam: [number, number][] = [];
    let beamAt = 0;
    const fired = new Set<number>();

    // ------------------------------------------------------------ the knight
    /** Pose of the hammer arm over time: where the hand is and how the hammer is tilted. */
    const SHOULDER = { x: BODY_X + 28, y: GROUND - 180 };
    const UPPER = 50;
    const FORE = 46;
    const pose = (t: number) => {
      const charge = easeOut(clamp((t - T_RISE) / (T_CHARGE - T_RISE)));
      const swing = clamp((t - T_CHARGE) / (T_SWING - T_CHARGE));
      const s = swing > 0 ? easeOutBack(swing) : 0;
      // raised, then drawn back over the head, then thrust forward
      const hand = {
        x: lerp(lerp(BODY_X + 70, BODY_X + 44, charge), BODY_X + 112, s),
        y: lerp(lerp(GROUND - 254, GROUND - 266, charge), GROUND - 214, s),
      };
      const ang = lerp(lerp(0, -0.95, charge), 0.85, s);
      return { hand, ang };
    };

    // hammer art: grip at (175, 410), head centre at (310, 154) in the 512px image
    const HSIZE = 190;
    const k = HSIZE / 512;
    const headOf = (hand: { x: number; y: number }, ang: number) => {
      const dx = (310 - 175) * k;
      const dy = (154 - 410) * k;
      return { x: hand.x + dx * Math.cos(ang) - dy * Math.sin(ang), y: hand.y + dx * Math.sin(ang) + dy * Math.cos(ang) };
    };

    /** Where the glove actually ends up once the arm's length is respected. */
    const gripOf = (hand: { x: number; y: number }) => {
      const dx = hand.x - SHOULDER.x;
      const dy = hand.y - SHOULDER.y;
      const reach = Math.min(Math.hypot(dx, dy), UPPER + FORE - 1);
      const a = Math.atan2(dy, dx);
      return { x: SHOULDER.x + Math.cos(a) * reach, y: SHOULDER.y + Math.sin(a) * reach };
    };

    const drawKnight = (t: number, rise: number, lit: number) => {
      const x = BODY_X;
      const g = GROUND;
      const lift = (1 - rise) * 40;
      const sway = Math.sin(t / 700) * 3;
      const { hand, ang } = pose(t);
      ctx.save();
      ctx.globalAlpha = rise;
      ctx.translate(0, lift);
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.beginPath();
      ctx.ellipse(x, g + 3, 64, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      const cape = ctx.createLinearGradient(x - 40, g - 180, x + 40, g);
      cape.addColorStop(0, "#b3262f");
      cape.addColorStop(1, "#3d0a14");
      ctx.fillStyle = cape;
      ctx.beginPath();
      ctx.moveTo(x - 32, g - 172);
      ctx.quadraticCurveTo(x - 66 - sway, g - 80, x - 78 - sway, g - 2);
      ctx.lineTo(x + 30, g - 2);
      ctx.quadraticCurveTo(x + 24, g - 92, x + 28, g - 172);
      ctx.fill();
      ctx.fillStyle = "#2b2547";
      ctx.fillRect(x - 23, g - 80, 20, 72);
      ctx.fillRect(x + 3, g - 80, 20, 72);
      ctx.fillStyle = "#17142b";
      ctx.fillRect(x - 26, g - 12, 25, 12);
      ctx.fillRect(x + 1, g - 12, 27, 12);
      const steel = ctx.createLinearGradient(x - 36, 0, x + 36, 0);
      steel.addColorStop(0, "#5a5480");
      steel.addColorStop(0.5, "#ece8ff");
      steel.addColorStop(1, "#5a5480");
      ctx.fillStyle = steel;
      ctx.beginPath();
      ctx.roundRect(x - 36, g - 190, 72, 114, 14);
      ctx.fill();
      ctx.fillStyle = "#e9b23f";
      ctx.fillRect(x - 36, g - 116, 72, 8);
      ctx.beginPath();
      ctx.arc(x, g - 152, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#c9c3e6";
      ctx.lineCap = "round";
      ctx.lineWidth = 17;
      ctx.beginPath();
      ctx.moveTo(x - 32, g - 176);
      ctx.lineTo(x - 48, g - 96);
      ctx.stroke();
      ctx.fillStyle = "#e9b23f";
      ctx.beginPath();
      ctx.moveTo(x - 6, g - 240);
      ctx.quadraticCurveTo(x - 30, g - 282, x - 60 + sway, g - 266);
      ctx.quadraticCurveTo(x - 30, g - 266, x - 14, g - 236);
      ctx.fill();
      ctx.fillStyle = steel;
      ctx.beginPath();
      ctx.roundRect(x - 25, g - 248, 50, 60, 16);
      ctx.fill();
      ctx.fillStyle = "#120f22";
      ctx.fillRect(x - 19, g - 226, 38, 9);
      ctx.fillStyle = "#bfeaff";
      ctx.shadowColor = "#5cc8ff";
      ctx.shadowBlur = 10 + lit * 20;
      ctx.fillRect(x - 14, g - 223, 28, 3);
      ctx.shadowBlur = 0;
      // hammer arm: upper arm and forearm with a bending elbow
      const sh = SHOULDER;
      const dx = hand.x - sh.x;
      const dy = hand.y - sh.y;
      const reach = Math.min(Math.hypot(dx, dy), UPPER + FORE - 1);
      const base = Math.atan2(dy, dx);
      const bend = Math.acos((UPPER * UPPER + reach * reach - FORE * FORE) / (2 * UPPER * reach));
      const elbow = { x: sh.x + Math.cos(base + bend) * UPPER, y: sh.y + Math.sin(base + bend) * UPPER };
      const wrist = { x: sh.x + Math.cos(base) * reach, y: sh.y + Math.sin(base) * reach };
      ctx.strokeStyle = steel;
      ctx.lineCap = "round";
      ctx.lineWidth = 19;
      ctx.beginPath();
      ctx.moveTo(sh.x, sh.y);
      ctx.lineTo(elbow.x, elbow.y);
      ctx.stroke();
      ctx.lineWidth = 16;
      ctx.beginPath();
      ctx.moveTo(elbow.x, elbow.y);
      ctx.lineTo(wrist.x, wrist.y);
      ctx.stroke();
      ctx.fillStyle = "#8f88b8";
      ctx.beginPath();
      ctx.arc(elbow.x, elbow.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#e9b23f";
      ctx.beginPath();
      ctx.ellipse(sh.x + 2, sh.y - 2, 19, 15, -0.4, 0, Math.PI * 2);
      ctx.fill();
      // the hammer, gripped in an armoured glove
      if (hammerBitmap) {
        ctx.save();
        ctx.translate(wrist.x, wrist.y);
        ctx.rotate(ang);
        ctx.drawImage(hammerBitmap, -175 * k - GLOW, -410 * k - GLOW, HSIZE + GLOW * 2, HSIZE + GLOW * 2);
        ctx.restore();
      }
      ctx.fillStyle = "#c9c3e6";
      ctx.beginPath();
      ctx.arc(wrist.x, wrist.y, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#e9b23f";
      ctx.fillRect(wrist.x - 9, wrist.y - 2, 18, 4);
      // a glow that grows with the charge, cheap enough to change every frame
      if (lit > 0) {
        const head = headOf(wrist, ang);
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const glow = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 70);
        glow.addColorStop(0, `rgba(150, 210, 255, ${0.45 * lit})`);
        glow.addColorStop(1, "rgba(120, 160, 255, 0)");
        ctx.fillStyle = glow;
        ctx.fillRect(head.x - 70, head.y - 70, 140, 140);
        ctx.restore();
      }
      ctx.restore();
    };

    // ---------------------------------------------------------- lightning
    const makeBolt = (ax: number, ay: number, bx: number, by: number, born: number, width = 1): Bolt => {
      const pts = jag(ax, ay, bx, by, Math.hypot(bx - ax, by - ay) * 0.28, 16);
      const forks: [number, number][][] = [];
      for (let f = 0; f < 4; f++) {
        const [fx, fy] = pts[2 + Math.floor(Math.random() * (pts.length - 4))];
        const len = 40 + Math.random() * 90;
        const a = Math.atan2(by - ay, bx - ax) + (Math.random() - 0.5) * 1.6;
        forks.push(jag(fx, fy, fx + Math.cos(a) * len, fy + Math.sin(a) * len, len * 0.4, 6));
      }
      return { pts, forks, born, life: 170 + Math.random() * 90, width };
    };

    const strokePath = (pts: [number, number][]) => {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    };

    /** Three passes of additive light: a wide violet bloom, a cyan body, a white-hot core. */
    const drawBolt = (b: Bolt, t: number) => {
      const age = t - b.born;
      if (age < 0) return;
      const flicker = age < b.life ? (Math.random() < 0.15 ? 0.35 : 1) : Math.max(0, 1 - (age - b.life) / 380) * 0.5;
      if (flicker <= 0) return;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      // wide faint layers fake the bloom; additive blending makes them glow
      const passes: [string, number][] = [
        ["rgba(130, 90, 255, 0.07)", 34 * b.width],
        ["rgba(130, 90, 255, 0.12)", 18 * b.width],
        ["rgba(110, 200, 255, 0.35)", 8 * b.width],
        ["rgba(150, 220, 255, 0.8)", 3.6 * b.width],
        ["rgba(250, 253, 255, 1)", 1.6 * b.width],
      ];
      for (const [color, width] of passes) {
        ctx.globalAlpha = flicker;
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        strokePath(b.pts);
        ctx.lineWidth = width * 0.55;
        b.forks.forEach(strokePath);
      }
      ctx.restore();
    };

    /** A flash of light around a strike, so the page itself seems lit. */
    const drawFlash = (x: number, y: number, strength: number, radius: number) => {
      if (strength <= 0) return;
      // never let a glow reach the canvas edge, or it shows as a straight cut
      radius = Math.min(radius, x + PAD, W + PAD - x, H - y + 60);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
      g.addColorStop(0, `rgba(190, 220, 255, ${0.32 * strength})`);
      g.addColorStop(0.4, `rgba(140, 120, 255, ${0.12 * strength})`);
      g.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      ctx.restore();
    };

    // --------------------------------------------------------------- dust
    const buildMotes = (head: { x: number; y: number }) => {
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
      const out: Mote[] = [];
      for (let y = 0; y < H; y += 3) {
        for (let x = 0; x < W; x += 3) {
          if (data[(y * W + x) * 4 + 3] < 128) continue;
          // each grain leaves from somewhere along the beam
          const r = Math.random();
          const sx = lerp(head.x, TARGET.x, r) + (Math.random() - 0.5) * 30;
          const sy = lerp(head.y, TARGET.y, r) + (Math.random() - 0.5) * 30;
          out.push({
            tx: x + Math.random() * 1.5, ty: y + Math.random() * 1.5, sx, sy,
            cx: lerp(sx, x, 0.5) + (Math.random() - 0.5) * 160, cy: Math.min(sy, y) - 60 - Math.random() * 120,
            delay: T_SWING + 60 + clamp((x - 440) / 680) * T_EMIT_SPAN + Math.random() * 200,
            dur: T_FLIGHT * (0.75 + Math.random() * 0.5),
            size: 1.4 + Math.random() * 1.8, hue: Math.random(), wob: Math.random() * Math.PI * 2,
          });
        }
      }
      return out;
    };

    /** The final strike jolts the letters once, nearest first, then they settle. */
    const shake = (x: number, y: number, t: number) => {
      const hit = T_FINAL_STRIKE + Math.hypot(x - STRIKES[5].x, y - STRIKES[5].y) / 1.2;
      const kk = t - hit;
      if (kk < 0 || kk > 800) return { ox: 0, oy: 0 };
      const damp = Math.exp(-kk / 200);
      return { ox: Math.sin(kk / 30) * 9 * damp, oy: Math.cos(kk / 38) * 5 * damp };
    };

    const BUCKETS = 10;
    const bucketStyle = Array.from({ length: BUCKETS + 1 }, (_, i) => {
      const e = i / BUCKETS;
      return `rgba(${Math.round(lerp(150, 255, e))},${Math.round(lerp(210, 212, e))},${Math.round(lerp(255, 128, e))},${(0.4 + 0.6 * e).toFixed(2)})`;
    });
    const batches: number[][] = Array.from({ length: BUCKETS + 1 }, () => []);

    const drawMotes = (t: number) => {
      for (const b of batches) b.length = 0;
      for (const m of motes) {
        const kk = (t - m.delay) / m.dur;
        if (kk <= 0) continue;
        const e = easeOut(clamp(kk));
        const u = 1 - e;
        let x = u * u * m.sx + 2 * u * e * m.cx + e * e * m.tx;
        let y = u * u * m.sy + 2 * u * e * m.cy + e * e * m.ty;
        const drift = (1 - e) * 12;
        x += Math.sin(t / 240 + m.wob) * drift;
        y += Math.cos(t / 300 + m.wob * 1.3) * drift;
        if (e >= 1) {
          const s = shake(m.tx, m.ty, t);
          x += s.ox;
          y += s.oy;
        }
        // electric blue in flight, cooling to gold as it lands
        batches[Math.round(e * BUCKETS)].push(x, y, m.size * (1 + u * 0.7));
      }
      batches.forEach((list, i) => {
        if (!list.length) return;
        ctx.fillStyle = bucketStyle[i];
        for (let j = 0; j < list.length; j += 3) ctx.fillRect(list[j], list[j + 1], list[j + 2], list[j + 2]);
      });
    };

    // --------------------------------------------------------------- frame
    const frame = (now: number) => {
      if (stopped) return;
      const t = now - start;
      ctx.clearRect(-PAD, 0, W + PAD * 2, H);
      const rise = easeOut(clamp(t / T_RISE));
      const { hand: rawHand, ang } = pose(t);
      const hand = gripOf(rawHand);
      const head = headOf(hand, ang);

      // the hammer charges: crackles and a growing glow around its head
      const charging = t > T_RISE && t < T_SWING;
      const chargeLevel = clamp((t - T_RISE) / (T_SWING - T_RISE));
      const beamOn = t >= T_SWING && t < T_BEAM_END;
      const recentStrike = STRIKES.reduce((m, s) => (t >= s.t ? Math.max(m, Math.max(0, 1 - (t - s.t) / 500)) : m), 0);
      const lit = Math.max(charging ? chargeLevel : 0, beamOn ? 1 : 0, recentStrike);

      drawFlash(head.x, head.y, (charging ? chargeLevel * 0.7 : 0) + (beamOn ? 0.8 : 0), 160);
      drawKnight(t, rise, lit);
      if (charging && Math.random() < 0.6) {
        const a = Math.random() * Math.PI * 2;
        const len = 25 + chargeLevel * 45;
        bolts.push({ ...makeBolt(head.x, head.y, head.x + Math.cos(a) * len, head.y + Math.sin(a) * len, t, 0.45), forks: [], life: 60 });
      }

      // the beam: hammer head to the headline, re-jagged every few frames
      if (beamOn) {
        if (t - beamAt > 45) {
          beam = jag(head.x, head.y, TARGET.x, TARGET.y, 70, 18);
          beamAt = t;
        }
        const fade = 1 - clamp((t - (T_BEAM_END - 250)) / 250);
        drawBolt({ pts: beam, forks: [], born: t - 1, life: 1000, width: 2.2 * fade + 0.4 }, t);
        drawFlash(TARGET.x, TARGET.y, fade, 260);
      }

      // thunder around the knight and the words
      for (const s of STRIKES) {
        if (t >= s.t && !fired.has(s.t)) {
          fired.add(s.t);
          bolts.push(makeBolt(s.x + (Math.random() - 0.5) * 140, -30, s.x, s.y, t, s.t === T_FINAL_STRIKE ? 1.6 : 1.1));
          if (Math.random() < 0.6) bolts.push(makeBolt(s.x + 90, -30, s.x + 40 + Math.random() * 60, s.y + 60, t + 40, 0.7));
        }
        drawFlash(s.x, s.y * 0.6, t >= s.t ? Math.max(0, 1 - (t - s.t) / 450) : 0, 420);
      }

      drawMotes(t);
      bolts = bolts.filter((b) => t - b.born < b.life + 400);
      bolts.forEach((b) => drawBolt(b, t));

      // it happens once: stop drawing when the storm has passed
      if (t < T_DONE) raf = requestAnimationFrame(frame);
    };

    document.fonts.load("700 176px Cinzel").finally(() => {
      if (stopped) return;
      const p = pose(T_SWING);
      motes = buildMotes(headOf(gripOf(p.hand), p.ang));
      start = performance.now() - (reduced ? T_DONE - 1 : 0);
      if (reduced) STRIKES.forEach((s) => fired.add(s.t));
      raf = requestAnimationFrame(frame);
    });
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [run]);

  return (
    <section className="hero">
      <h1 className="sr-only">Rent in-game gear. Every item is its own NEAR account.</h1>
      <canvas ref={canvasRef} className="hero-canvas" aria-hidden="true" />
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
          <button className="link" onClick={() => setRun((n) => n + 1)}>Replay the strike</button>
        </div>
      </div>
    </section>
  );
}
