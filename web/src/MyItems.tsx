import { useState } from "react";
import { FACTORY_ID, call, fmtNear, parseNear, sessionKeyFor, view, type ItemView, type Settlement } from "./near";
import { useChain } from "./store";
import { AccountLink, Countdown, Durability, StatusBadge, artUrl, statusOf } from "./ui";

const ART_CHOICES = ["flame-sword", "frost-bow", "thunder-hammer", "shadow-dagger", "guardian-shield", "storm-staff"];

export function MyItems() {
  const c = useChain();
  if (!c.me) {
    return (
      <section className="empty">
        <h2>My Items</h2>
        <p>Choose “Play as guest” or connect a wallet to see items you own or rent.</p>
        <button className="primary" onClick={c.guestLogin} disabled={!!c.busy}>Play as guest</button>
      </section>
    );
  }
  const owned = c.items.filter((i) => i.owner === c.me!.accountId);
  const rented = c.items.filter((i) => i.renter === c.me!.accountId);
  const total = owned.reduce((sum, i) => sum + BigInt(i.owner_earnings), 0n);

  return (
    <>
      <section className="split">
        <div>
          <h2>Items I own</h2>
          <p className="muted">
            Total earned: <b>{fmtNear(total, 4)} NEAR</b>. Rent is paid to you automatically when a lease settles.
          </p>
          {owned.length === 0 && <p className="muted">You own no items yet. Mint one on the right.</p>}
          {owned.map((item) => <OwnedRow key={item.account_id} item={item} />)}

          <h2 style={{ marginTop: 28 }}>Items I rent</h2>
          {rented.length === 0 && <p className="muted">No active leases. Rent something in the Marketplace.</p>}
          {rented.map((item) => <RentedRow key={item.account_id} item={item} />)}
        </div>
        <MintForm />
      </section>
    </>
  );
}

function OwnedRow({ item }: { item: ItemView }) {
  const c = useChain();
  const status = statusOf(item);
  const [price, setPrice] = useState(fmtNear(item.price_per_hour, 4));
  const act = (label: string, method: string, args: Record<string, unknown> = {}, deposit = 0n) =>
    c.run(label, (me) => call(me, item.account_id, method, args, deposit));

  return (
    <div className="row">
      <img src={artUrl(item.image)} alt="" />
      <div className="row-main">
        <div className="row-title">
          <b>{item.name}</b> <StatusBadge item={item} />
        </div>
        <AccountLink id={item.account_id} />
        <div className="stats">
          <span>Earned <b>{fmtNear(item.owner_earnings, 4)}</b> NEAR</span>
          <span>{item.rental_count} rentals</span>
          <span>{item.total_uses} uses</span>
          <Durability item={item} />
        </div>
        {status === "rented" && (
          <p className="lease">
            Leased to <AccountLink id={item.renter!} /> · <Countdown endsAt={item.ends_at} /> left ·
            escrowed rent {fmtNear(item.rent_paid, 4)} NEAR. You cannot unlist or revoke until it ends.
          </p>
        )}
      </div>
      <div className="row-actions">
        {status === "expired" && (
          <button className="primary" onClick={() => c.endRental(item)} disabled={!!c.busy}>Settle and get paid</button>
        )}
        {(status === "available" || status === "unlisted") && (
          <>
            <label className="inline">
              <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" />
              <span>NEAR/hr</span>
            </label>
            <button
              disabled={!!c.busy}
              onClick={() => act("Listing…", "list", { price_per_hour: parseNear(price).toString() })}
            >
              {item.listed ? "Update price" : "List for rent"}
            </button>
            {item.listed && (
              <button className="ghost" disabled={!!c.busy} onClick={() => act("Unlisting…", "unlist")}>Unlist</button>
            )}
          </>
        )}
        {status === "rented" && (
          <button className="ghost" disabled={!!c.busy} onClick={() => act("Trying to unlist…", "unlist")}>
            Try to unlist (will be rejected)
          </button>
        )}
        {!item.renter && item.durability < item.max_durability && (
          <button
            className="ghost"
            disabled={!!c.busy}
            onClick={() =>
              act("Repairing…", "repair", {}, BigInt(item.max_durability - item.durability) * 10n ** 20n)}
          >
            Repair ({fmtNear(BigInt(item.max_durability - item.durability) * 10n ** 20n, 4)} NEAR)
          </button>
        )}
      </div>
    </div>
  );
}

function RentedRow({ item }: { item: ItemView }) {
  const c = useChain();
  const status = statusOf(item);
  const hasKey = !!sessionKeyFor(item);
  return (
    <div className="row">
      <img src={artUrl(item.image)} alt="" />
      <div className="row-main">
        <div className="row-title">
          <b>{item.name}</b> <StatusBadge item={item} />
        </div>
        <div className="stats">
          {status === "rented" && <span><Countdown endsAt={item.ends_at} /> left</span>}
          <span>{item.uses} uses · {item.uses_left} left in gas budget</span>
          <span>Rent paid {fmtNear(item.rent_paid, 4)} NEAR</span>
        </div>
        {!hasKey && <p className="warn">The session key for this lease is in another browser.</p>}
      </div>
      <div className="row-actions">
        {status === "rented" && hasKey && (
          <button className="primary" onClick={() => c.playWith(item.account_id)}>Play</button>
        )}
        {status === "rented" && (
          <button
            disabled={!!c.busy}
            onClick={async () => {
              const s = await c.run("Returning early…", (me) => call<Settlement>(me, item.account_id, "return_early"));
              if (s) c.toast("ok", `Returned early. Refund ${fmtNear(s.renter_refund, 4)} NEAR for unused time and gas.`);
            }}
          >
            Return early
          </button>
        )}
        {status === "expired" && (
          <button onClick={() => c.endRental(item)} disabled={!!c.busy}>Settle lease</button>
        )}
      </div>
    </div>
  );
}

function MintForm() {
  const c = useChain();
  const [name, setName] = useState("Ember Blade");
  const [art, setArt] = useState("flame-sword");
  const [power, setPower] = useState(35);
  const [price, setPrice] = useState("0.1");
  const [royalty, setRoyalty] = useState(10);

  const mint = () =>
    c.run(`Minting ${name}…`, async (me) => {
      const deposit = BigInt(await view<string>(FACTORY_ID, "mint_deposit"));
      const minted = await call<{ token_id: string; item_account: string } | null>(me, FACTORY_ID, "mint", {
        args: {
          name, image: `${art}.svg`, power,
          price_per_hour: parseNear(price).toString(), max_secs: "7200",
          royalty_bps: Math.round(royalty * 100), creator: FACTORY_ID,
        },
      }, deposit, 300n * 10n ** 12n);
      if (!minted) throw new Error("mint failed, deposit refunded");
      await call(me, minted.item_account, "list", {});
      c.toast("ok", `${name} minted. It lives at ${minted.item_account} and is listed for rent.`);
    });

  return (
    <aside className="panel">
      <h2>Mint an item</h2>
      <p className="muted">Creates the NFT and its own NEAR account, then lists it. Costs about 0.16 NEAR.</p>
      <label>Name<input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></label>
      <label>Look</label>
      <div className="art-pick">
        {ART_CHOICES.map((a) => (
          <button key={a} className={a === art ? "on" : ""} onClick={() => setArt(a)}>
            <img src={`/items/${a}.svg`} alt={a} />
          </button>
        ))}
      </div>
      <label>Power: {power}
        <input type="range" min={5} max={80} value={power} onChange={(e) => setPower(Number(e.target.value))} />
      </label>
      <label>Price per hour (NEAR)<input value={price} inputMode="decimal" onChange={(e) => setPrice(e.target.value)} /></label>
      <label>Game creator royalty: {royalty}%
        <input type="range" min={0} max={30} value={royalty} onChange={(e) => setRoyalty(Number(e.target.value))} />
      </label>
      <button className="primary" disabled={!!c.busy || !name.trim()} onClick={mint}>Mint and list</button>
    </aside>
  );
}
