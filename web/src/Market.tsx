import { useState } from "react";
import { GAS_BUDGET, fmtNear, sessionKeyFor, type ItemView } from "./near";
import { useChain } from "./store";
import { AccountLink, Countdown, Durability, StatusBadge, artUrl, statusOf } from "./ui";

const DURATIONS: [number, string][] = [
  [120, "2 min"],
  [300, "5 min"],
  [1800, "30 min"],
  [3600, "1 hour"],
];

export function Market() {
  const c = useChain();
  const [renting, setRenting] = useState<ItemView | null>(null);

  return (
    <>
      <section className="hero">
        <h1>Rent the sword. Never hold the NFT.</h1>
        <p>
          Each item is its own NEAR account. Renting adds a session key to that account that can only
          call <code>use_item</code>. No collateral, no trust, and the game never opens a wallet.
        </p>
      </section>

      {c.loading && <p className="muted">Loading items from NEAR testnet…</p>}
      <div className="grid">
        {c.items.map((item) => {
          const status = statusOf(item);
          const mine = c.me?.accountId === item.owner;
          const iRent = c.me?.accountId === item.renter && !!sessionKeyFor(item);
          return (
            <article key={item.account_id} className="card">
              <div className="card-art">
                <img src={artUrl(item.image)} alt={item.name} />
                <StatusBadge item={item} />
              </div>
              <h3>{item.name}</h3>
              <AccountLink id={item.account_id} />
              <dl>
                <div><dt>Price</dt><dd><b>{fmtNear(item.price_per_hour)}</b> NEAR / hr</dd></div>
                <div><dt>Power</dt><dd>{item.power}</dd></div>
                <div><dt>Durability</dt><dd><Durability item={item} /></dd></div>
                <div><dt>Rentals</dt><dd>{item.rental_count} · earned {fmtNear(item.lifetime_earnings)} NEAR</dd></div>
                <div><dt>Owner</dt><dd><AccountLink id={item.owner} />{mine && " (you)"}</dd></div>
              </dl>
              {status === "rented" && (
                <p className="lease">
                  Leased to <AccountLink id={item.renter!} /> for <Countdown endsAt={item.ends_at} />
                </p>
              )}
              <div className="card-actions">
                {status === "available" && !mine && (
                  <button className="primary" onClick={() => setRenting(item)}>Rent</button>
                )}
                {status === "available" && mine && <span className="muted">Listed by you</span>}
                {status === "rented" && iRent && (
                  <button className="primary" onClick={() => c.playWith(item.account_id)}>Play with it</button>
                )}
                {status === "expired" && (
                  <button onClick={() => c.endRental(item)} disabled={!!c.busy}>Settle lease</button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {renting && <RentDialog item={renting} onClose={() => setRenting(null)} />}
    </>
  );
}

function RentDialog({ item, onClose }: { item: ItemView; onClose: () => void }) {
  const c = useChain();
  const [secs, setSecs] = useState(120);
  const cost = (BigInt(item.price_per_hour) * BigInt(secs)) / 3600n;
  const options = DURATIONS.filter(([s]) => s <= Number(item.max_secs));

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <img src={artUrl(item.image)} alt="" />
          <div>
            <h3>Rent {item.name}</h3>
            <small className="muted">{fmtNear(item.price_per_hour)} NEAR per hour · power {item.power}</small>
          </div>
        </div>
        <div className="seg">
          {options.map(([s, label]) => (
            <button key={s} className={s === secs ? "on" : ""} onClick={() => setSecs(s)}>{label}</button>
          ))}
        </div>
        <table className="bill">
          <tbody>
            <tr><td>Rent</td><td>{fmtNear(cost, 5)} NEAR</td></tr>
            <tr><td>Gas budget, unused part refunded</td><td>{fmtNear(GAS_BUDGET)} NEAR</td></tr>
            <tr className="total"><td>You pay now</td><td>{fmtNear(cost + GAS_BUDGET, 5)} NEAR</td></tr>
            <tr><td>Collateral</td><td>none</td></tr>
          </tbody>
        </table>
        <ul className="facts">
          <li>The NFT stays with its owner. You get a key that can only play.</li>
          <li>The owner cannot cancel, unlist or revoke during your lease.</li>
          <li>Return early any time and unused time is refunded.</li>
        </ul>
        {!c.me && <p className="warn">Choose “Play as guest” (top right) to get a free testnet account first.</p>}
        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button
            className="primary"
            disabled={!c.me || !!c.busy}
            onClick={async () => {
              if (await c.rent(item, secs)) onClose();
            }}
          >
            Rent for {fmtNear(cost + GAS_BUDGET, 4)} NEAR
          </button>
        </div>
      </div>
    </div>
  );
}
