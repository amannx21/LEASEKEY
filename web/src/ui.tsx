import { useEffect, useState, type ReactNode } from "react";
import { EXPLORER, chainNow, short, type ItemView } from "./near";
import { artUrl as catalogArt, lookOf } from "./catalog";

export const artUrl = catalogArt;
export const itemColors = (image: string): [string, string] => {
  const [a, b] = lookOf(image).colors;
  return [a, b];
};

export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** Milliseconds left on the lease, ticking every 250ms on chain time. */
export function useTimeLeft(endsAt: string | null | undefined): number {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!endsAt) return;
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [endsAt]);
  return endsAt ? Math.max(0, Number(endsAt) - chainNow()) : 0;
}

export function Countdown({ endsAt }: { endsAt: string | null }) {
  const left = useTimeLeft(endsAt);
  return <span className="num">{fmtClock(left)}</span>;
}

export function AccountLink({ id, children }: { id: string; children?: ReactNode }) {
  return (
    <a className="acct" href={`${EXPLORER}/address/${id}`} target="_blank" rel="noreferrer" title={id}>
      {children ?? short(id)}
    </a>
  );
}

export function Durability({ item }: { item: ItemView }) {
  const pct = Math.round((item.durability / item.max_durability) * 100);
  return (
    <div className="dura" title={`Durability ${item.durability} / ${item.max_durability}`}>
      <div className="dura-bar">
        <div className={pct < 25 ? "low" : ""} style={{ width: `${pct}%` }} />
      </div>
      <span className="num">{pct}%</span>
    </div>
  );
}

export type ItemStatus = "available" | "rented" | "expired" | "unlisted" | "broken";
export function statusOf(item: ItemView): ItemStatus {
  if (item.renter) return Number(item.ends_at) > chainNow() ? "rented" : "expired";
  if (item.durability === 0) return "broken";
  return item.listed ? "available" : "unlisted";
}

export function StatusBadge({ item }: { item: ItemView }) {
  useTimeLeft(item.ends_at);
  const s = statusOf(item);
  const label = {
    available: "Available",
    rented: "On lease",
    expired: "Lease ended",
    unlisted: "Not listed",
    broken: "Broken",
  }[s];
  return <span className={`badge ${s}`}>{label}</span>;
}

/** Small authored icon set, one stroke weight. */
export function Icon({ name, size = 18 }: { name: "key" | "shield" | "clock" | "coins" | "bolt" | "arrow" | "spark" | "lock"; size?: number }) {
  const p = {
    key: "M14 7a4 4 0 1 1-3.9 4.9L4 18v2h3v-2h2v-2h2l1.1-1.1A4 4 0 0 1 14 7z",
    shield: "M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z",
    clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
    coins: "M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 7v5c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12v5c0 1.7 3.6 3 8 3s8-1.3 8-3v-5",
    bolt: "M13 2L4 14h7l-1 8 9-12h-7z",
    arrow: "M5 12h14M13 6l6 6-6 6",
    spark: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18",
    lock: "M6 11h12v10H6zM8 11V8a4 4 0 0 1 8 0v3",
  }[name];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={p} />
    </svg>
  );
}
