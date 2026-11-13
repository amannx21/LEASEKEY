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
        <span>Built at the NEAR Hackathon 2026.</span>
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
