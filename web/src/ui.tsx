import { useEffect, useState } from "react";
import { EXPLORER, chainNow, short, type ItemView } from "./near";

const ART = ["flame-sword", "frost-bow", "thunder-hammer", "shadow-dagger", "guardian-shield", "storm-staff"];

export function artUrl(image: string): string {
  const name = image.replace(/\.svg$/, "");
  return `/items/${ART.includes(name) ? name : "generic"}.svg`;
}

export const ITEM_COLORS: Record<string, [string, string]> = {
  "flame-sword": ["#ff6a2b", "#ffd166"],
  "frost-bow": ["#58c7ff", "#e6f7ff"],
  "thunder-hammer": ["#b9a5ff", "#ffe45c"],
  "shadow-dagger": ["#8b6cf6", "#d6c9ff"],
  "guardian-shield": ["#3fb984", "#e9fff4"],
  "storm-staff": ["#48c6ef", "#d9f6ff"],
};
export const itemColors = (image: string) => ITEM_COLORS[image.replace(/\.svg$/, "")] ?? ["#f4c95d", "#fff3c4"];

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
  return <span className="mono">{fmtClock(left)}</span>;
}

export function AccountLink({ id, children }: { id: string; children?: React.ReactNode }) {
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
      <span>{pct}%</span>
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
    rented: "Rented",
    expired: "Lease ended, awaiting settlement",
    unlisted: "Not listed",
    broken: "Broken",
  }[s];
  return <span className={`badge ${s}`}>{label}</span>;
}
