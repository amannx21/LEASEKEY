// Publishes res/item.wasm as a new global contract and points the factory at it.
// Items created from now on run the new code. Existing items keep the code they were
// created with: item code is referenced by hash, so rules never change under an owner or renter.
//   npx tsx scripts/item-code.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, TGAS, accountFor, near, provider, readDeployment, view } from "./common.ts";

const d = readDeployment();
if (!d) throw new Error("no deployment");
const wasm = readFileSync(join(ROOT, "res", "item.wasm"));
// Publishing a global contract burns 10 NEAR per 100 kB.
const cost = (BigInt(wasm.length) * near(10)) / 100_000n + near("0.5");
const acc = await provider.viewAccount(d.factoryId);
const free = BigInt(acc.amount) - BigInt(acc.storage_usage) * 10n ** 19n;
console.log(`item.wasm ${wasm.length} bytes, publishing costs ${Number(cost / 10n ** 21n) / 1000} NEAR; factory has ${Number(free / 10n ** 21n) / 1000} NEAR free`);
if (free < cost + near("0.5")) throw new Error("fund the factory first");

const before = await view<{ item_code: unknown }>(d.factoryId, "get_config");
await accountFor(d.factoryId).callFunction({
  contractId: d.factoryId,
  methodName: "publish_item_code_global",
  args: new Uint8Array(wasm),
  deposit: cost,
  gas: 300n * TGAS,
  waitUntil: "FINAL",
});
const after = await view<{ item_code: unknown }>(d.factoryId, "get_config");
console.log("item code before:", JSON.stringify(before.item_code));
console.log("item code now:   ", JSON.stringify(after.item_code));
