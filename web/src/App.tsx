import { useState } from "react";
import { Arena } from "./Arena";
import { Build } from "./Build";
import { Home } from "./Home";
import { Market } from "./Market";
import { MyItems } from "./MyItems";
import { FACTORY_ID, fmtNear } from "./near";
import { hasDeployment, useChain, type Page } from "./store";
import { AccountLink } from "./ui";

const TABS: [Page, string][] = [
  ["home", "Story"],
  ["market", "Armory"],
  ["arena", "Arena"],
  ["mine", "My Items"],
  ["build", "For game devs"],
];

/** Background themes. Text, fonts, gold and item colours are the same in all of them. */
const THEMES: [string, string, string][] = [
  ["violet", "Violet night", "#17122b"],
  ["charcoal", "Charcoal", "#1b1d21"],
  ["obsidian", "Obsidian black", "#111113"],
  ["forge", "Forge (warm dark)", "#1b1612"],
  ["midnight", "Midnight blue", "#111a29"],
];
const THEME_KEY = "leasekey:theme";

function applyTheme(t: string) {
  if (t === "violet") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
}
try {
  applyTheme(new URLSearchParams(location.search).get("theme") || localStorage.getItem(THEME_KEY) || "violet");
} catch {
  // storage blocked: keep the default
}

function ThemePick() {
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute("data-theme") || "violet");
  const pick = (t: string) => {
    setTheme(t);
    applyTheme(t);
    try { localStorage.setItem(THEME_KEY, t); } catch { /* not saved, still applied */ }
  };
  return (
    <div className="theme-pick" role="group" aria-label="Background colour">
      <span>Theme</span>
      {THEMES.map(([id, label, sw]) => (
        <button key={id} className={theme === id ? "on" : ""} title={label} aria-label={label} aria-pressed={theme === id}
          style={{ ["--sw" as string]: sw }} onClick={() => pick(id)} />
      ))}
    </div>
  );
}

export function App() {
  const c = useChain();
  return (
    <div className={`app page-${c.page}`}>
      <header className="top">
        <button className="brand" onClick={() => c.setPage("home")} aria-label="LeaseKey home">
          <svg viewBox="0 0 40 40" width="34" height="34" aria-hidden="true">
            <circle cx="14" cy="20" r="9" fill="none" stroke="var(--gold)" strokeWidth="3" />
            <path d="M22 20 H36 M31 20 V26 M27 20 V24" stroke="var(--gold)" strokeWidth="3" strokeLinecap="round" />
            <circle cx="14" cy="20" r="3" fill="var(--ember)" />
          </svg>
          <b>LeaseKey</b>
        </button>
        <nav aria-label="Main">
          {TABS.map(([p, label]) => (
            <button key={p} className={c.page === p ? "tab on" : "tab"} aria-current={c.page === p ? "page" : undefined}
              onClick={() => c.setPage(p)}>
              {label}
            </button>
          ))}
        </nav>
        <ThemePick />
        <div className="who">
          {c.me ? (
            <>
              <div className="who-id">
                <AccountLink id={c.me.accountId} />
                <small>
                  {c.me.kind === "guest" ? "guest" : "wallet"} · <span className="num">{c.balance === null ? "…" : fmtNear(c.balance, 2)}</span> NEAR
                </small>
              </div>
              <button className="ghost small" onClick={c.logout}>Sign out</button>
            </>
          ) : (
            <>
              <button className="primary" onClick={c.guestLogin} disabled={!!c.busy}>Play as guest</button>
              <button className="ghost" onClick={c.walletLogin}>Connect wallet</button>
            </>
          )}
        </div>
      </header>

      {!hasDeployment ? (
        <main className="empty">
          <h2>No deployment configured</h2>
          <p>Run <code>npm run deploy</code> in the repo root, or set <code>VITE_FACTORY_ID</code> in <code>web/.env.local</code>.</p>
        </main>
      ) : (
        <main key={c.page} className="page">
          {c.page === "home" && <Home />}
          {c.page === "market" && <Market />}
          {c.page === "arena" && <Arena />}
          {c.page === "mine" && <MyItems />}
          {c.page === "build" && <Build />}
        </main>
      )}

      <footer>
        <span>NEAR testnet · factory <AccountLink id={FACTORY_ID} /></span>
        <span>Every item is its own account. Renter keys can only call <code>use_item</code>.</span>
      </footer>

      {c.busy && (
        <div className="busy" role="status">
          <span className="spin" /> {c.busy}
        </div>
      )}
      <div className="toasts" aria-live="polite">
        {c.toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>
        ))}
      </div>
    </div>
  );
}
