// Live check of what a first-time visitor does, using only things that run without the developer:
// the guest bank creates a guest account, the guest rents a listed item for 2 minutes, strikes with
// the play key, then returns it early for a refund.
//   npx tsx scripts/guest-check.ts
import { KeyPair } from "near-api-js";
import { NEAR, TGAS, accountFor, provider, readDeployment, retry, sleep, view } from "./common.ts";

const d = readDeployment() as any;
if (!d?.guestBank) throw new Error("no guest bank in the deployment");
const ok = (cond: unknown, msg: string) => { if (!cond) throw new Error("FAILED: " + msg); console.log("ok  " + msg); };
const fmt = (y: bigint | string) => (Number(BigInt(y) / 10n ** 18n) / 1e6).toFixed(4);
const balance = async (id: string) => BigInt((await provider.viewAccount(id)).amount);

// 1. a guest account, funded by the bank exactly as the site does it
const bank = accountFor(d.guestBank.accountId, d.guestBank.secretKey);
const bankBefore = await balance(bank.accountId);
const name = `lk-guest-chk${Math.random().toString(36).slice(2, 6)}`;
const guestKey = KeyPair.fromRandom("ed25519");
await retry("create guest", () => bank.createSubAccount(name, guestKey.getPublicKey(), NEAR / 2n));
const guestId = `${name}.${bank.accountId}`;
const guest = accountFor(guestId, guestKey.toString());
ok(await balance(guestId) > 0n, `guest ${guestId} created with ${fmt(await balance(guestId))} NEAR (bank had ${fmt(bankBefore)})`);

// 2. find a cheap item that is listed and free
type Ref = { item_account: string };
const refs = await view<Ref[]>(d.factoryId, "get_items", { from_index: "0", limit: 200 });
let pick: { id: string; price: bigint } | null = null;
for (const r of refs) {
  const it = await view<any>(r.item_account, "get_item").catch(() => null);
  if (!it || !it.listed || it.renter || it.durability <= 0) continue;
  const price = BigInt(it.price_per_hour);
  if (!pick || price < pick.price) pick = { id: r.item_account, price };
}
ok(pick, `free listed item ${pick!.id} at ${fmt(pick!.price)} NEAR/hr`);

// 3. rent for 2 minutes with a fresh play key, as the Armory does
const playKey = KeyPair.fromRandom("ed25519");
const secs = 120n;
const cost = (pick!.price * secs) / 3600n;
const GAS_BUDGET = NEAR / 10n;
await retry("rent", () => guest.callFunction({
  contractId: pick!.id, methodName: "rent", deposit: cost + GAS_BUDGET, gas: 100n * TGAS, waitUntil: "FINAL",
  args: { public_key: playKey.getPublicKey().toString(), duration_secs: secs.toString() },
}));
const rented = await view<any>(pick!.id, "get_item");
ok(rented.renter === guestId, `rented by the guest, ${rented.uses_left} strikes available`);

// 4. strike with the play key (it signs as the item account, limited to use_item)
const player = accountFor(pick!.id, playKey.toString());
for (let i = 0; i < 2; i++) {
  await retry("use_item", () => player.callFunction({ contractId: pick!.id, methodName: "use_item", args: { action: "slash" }, gas: 30n * TGAS, waitUntil: "FINAL" }));
  await sleep(500);
}
const after = await view<any>(pick!.id, "get_item");
ok(after.uses >= 2, `2 strikes landed on chain (uses ${after.uses}, strikes left ${after.uses_left})`);

// 5. return early: the item is free again and the guest gets the refund
const before = await balance(guestId);
const s = await retry("return_early", () => guest.callFunction({ contractId: pick!.id, methodName: "return_early", args: {}, gas: 100n * TGAS, waitUntil: "FINAL" })) as any;
const free = await view<any>(pick!.id, "get_item");
ok(!free.renter, `returned early, refund ${fmt(s.renter_refund)} NEAR, item free again`);
await sleep(2000);
ok(await balance(guestId) > before, `guest balance went up after the refund`);
console.log(`bank now ${fmt(await balance(bank.accountId))} NEAR`);
