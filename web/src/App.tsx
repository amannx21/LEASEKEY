import { Arena } from "./Arena";
import { Market } from "./Market";
import { MyItems } from "./MyItems";
import { FACTORY_ID, fmtNear } from "./near";
import { hasDeployment, useChain, type Page } from "./store";
import { AccountLink } from "./ui";

const TABS: [Page, string][] = [
  ["market", "Marketplace"],
  ["arena", "Slime Arena"],
  ["mine", "My Items"],
];

export function App() {
  const c = useChain();
  return (
    <div className="app">
      <header className="top">
        <div className="brand" onClick={() => c.setPage("market")}>
          <img src="/items/flame-sword.svg" alt="" />
          <div>
            <b>LeaseKey</b>
            <small>items that rent themselves out</small>
          </div>
        </div>
        <nav>
          {TABS.map(([p, label]) => (
            <button key={p} className={c.page === p ? "tab on" : "tab"} onClick={() => c.setPage(p)}>
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
                  {c.me.kind === "guest" ? "guest" : "wallet"} · {c.balance === null ? "…" : fmtNear(c.balance, 2)} NEAR
                </small>
              </div>
              <button className="ghost" onClick={c.logout}>Sign out</button>
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
        <main>
          {c.page === "market" && <Market />}
          {c.page === "arena" && <Arena />}
          {c.page === "mine" && <MyItems />}
        </main>
      )}

      <footer>
        NEAR testnet · factory <AccountLink id={FACTORY_ID} /> · every item is its own account ·
        renter keys can only call <code>use_item</code>
      </footer>

      {c.busy && (
        <div className="busy">
          <span className="spin" /> {c.busy}
        </div>
      )}
      <div className="toasts">
        {c.toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>
        ))}
      </div>
    </div>
  );
}
