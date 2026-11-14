// Reprices the demo owner's items by scarcity: fewer copies and more power rent for more.
// Same formula as the app's price suggestion (web/src/near.ts suggestedPrice).
import { accountFor, fmt, readDeployment, view } from "./common.ts";

const suggested = (power: number, maxSupply: number | null) => {
  const scarcity = Math.sqrt(10 / Math.max(1, maxSupply ?? 10));
  const near = Math.max(0.01, Math.min(0.02 * (power / 20) * scarcity, 2));
  return BigInt(Math.round(near * 1e6)) * 10n ** 18n;
};

const d = readDeployment()!;
const owner = accountFor(d.ownerId);
for (const ref of await view<any[]>(d.factoryId, "get_items", { limit: 100 })) {
  if (ref.owner !== d.ownerId) continue;
  const item = await view<any>(ref.item_account, "get_item");
  if (item.renter) { console.log(`skip ${item.name}: on lease`); continue; }
  const price = suggested(item.power, ref.max_supply);
  await owner.callFunction({ contractId: ref.item_account, methodName: "list", args: { price_per_hour: price.toString() } });
  console.log(`${item.name.padEnd(16)} ${String(ref.max_supply).padStart(2)} exist, power ${String(item.power).padStart(2)} -> ${fmt(price)} NEAR/hr`);
}
