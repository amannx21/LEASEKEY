import { useEffect, useState } from "react";
import { FACTORY_ID, view } from "./near";

type Live = { create_fee: string; rental_fee_bps: number; items_charged: string; create_fees: string };

const RENTAL_FEE = 0.02; // paid by each item to LeaseKey at settlement
const CREATE_FEE = 0.01; // NEAR, once per item created
const fmt = (n: number) => (n >= 100 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toFixed(3));

/** Who earns what on LeaseKey, with a calculator and LeaseKey's live on-chain earnings. */
export function Earnings() {
  const [items, setItems] = useState(200);
  const [price, setPrice] = useState(0.05);
  const [hours, setHours] = useState(6);
  const [royalty, setRoyalty] = useState(10);
  const [live, setLive] = useState<Live | null>(null);

  useEffect(() => {
    view<Live>(FACTORY_ID, "get_earnings").then(setLive, () => setLive(null));
  }, []);

  const rent = items * price * hours * 30; // per month
  const game = rent * (royalty / 100);
  const leasekey = rent * RENTAL_FEE;
  const owners = rent - game - leasekey;
  const share = (x: number) => `${rent > 0 ? (x / rent) * 100 : 0}%`;

  return (
    <section className="panel earn">
      <div className="earn-head">
        <div>
          <h3>Who earns what</h3>
          <p className="muted">
            Every lease pays out on chain the moment it settles. Owners keep most of it, the game earns its royalty, and
            LeaseKey takes a small fee. Renters pay nothing on top of the rent.
          </p>
        </div>
        {live && (
          <div className="earn-live" title="Read from the LeaseKey contract on NEAR testnet">
            On chain since fees went live: <span className="num">{Number(live.items_charged)}</span> items created ·{" "}
            <span className="num">{fmt(Number(BigInt(live.create_fees) / 10n ** 21n) / 1000)}</span> NEAR in creation fees
          </div>
        )}
      </div>

      <div className="earn-grid">
        <div className="earn-rules">
          <div><b>Item owners</b><span>Rent from every lease, minus the game's royalty and LeaseKey's 2%</span></div>
          <div><b>Games</b><span>A royalty they choose (up to 50%) on every lease of their items, forever, in any game that honours them</span></div>
          <div><b>LeaseKey</b><span>2% of each rent at settlement, plus {CREATE_FEE} NEAR per item created or wrapped</span></div>
          <div><b>Renters</b><span>Pay rent and a refundable gas budget. No collateral, no fee on top</span></div>
        </div>

        <div className="earn-calc">
          <label>Items listed <b className="num">{items}</b>
            <input type="range" min={10} max={5000} step={10} value={items} onChange={(e) => setItems(Number(e.target.value))} /></label>
          <label>Rent per hour <b className="num">{price.toFixed(3)} NEAR</b>
            <input type="range" min={0.005} max={0.5} step={0.005} value={price} onChange={(e) => setPrice(Number(e.target.value))} /></label>
          <label>Hours leased per item per day <b className="num">{hours}</b>
            <input type="range" min={1} max={24} value={hours} onChange={(e) => setHours(Number(e.target.value))} /></label>
          <label>Game royalty <b className="num">{royalty}%</b>
            <input type="range" min={0} max={50} value={royalty} onChange={(e) => setRoyalty(Number(e.target.value))} /></label>

          <div className="earn-bar" aria-hidden="true">
            <i style={{ width: share(owners), background: "var(--gold)" }} />
            <i style={{ width: share(game), background: "var(--ember)" }} />
            <i style={{ width: share(leasekey), background: "var(--info)" }} />
          </div>
          <dl className="earn-out">
            <div><dt>Rent per month</dt><dd className="num">{fmt(rent)} NEAR</dd></div>
            <div><dt><i style={{ background: "var(--gold)" }} />Owners</dt><dd className="num">{fmt(owners)} NEAR</dd></div>
            <div><dt><i style={{ background: "var(--ember)" }} />The game</dt><dd className="num">{fmt(game)} NEAR</dd></div>
            <div><dt><i style={{ background: "var(--info)" }} />LeaseKey</dt><dd className="num">{fmt(leasekey)} NEAR <small>+ {fmt(items * CREATE_FEE)} once</small></dd></div>
          </dl>
        </div>
      </div>
    </section>
  );
}
