// Upgrades the live testnet factory to the current contract and migrates its
// state, keeping every item and address. Also deploys the "Ember Realms" demo
// collection that stands in for another game's NFTs.
//   npx tsx scripts/upgrade.ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KeyPair } from "near-api-js";
import { DEPLOYMENT_FILE, ROOT, TGAS, accountFor, near, provider, readDeployment, retry, saveKey, view } from "./common.ts";

const d = readDeployment();
if (!d) throw new Error("no deployment");
const factory = accountFor(d.factoryId);

const migrated = await view<unknown[]>(d.factoryId, "get_games").then(() => true, () => false);
if (migrated) {
  console.log("factory already on v2; set REDEPLOY=1 to push new code");
  if (process.env.REDEPLOY) await retry("deploy", () => factory.deployContract(readFileSync(join(ROOT, "res", "leasekey.wasm"))));
} else {
  console.log("deploying v2 factory code and migrating state");
  // Deploy and migrate in one transaction, so the contract is never left half-upgraded.
  const { actionCreators } = await import("@near-js/transactions");
  await factory.signAndSendTransaction({
    receiverId: d.factoryId,
    actions: [
      actionCreators.deployContract(readFileSync(join(ROOT, "res", "leasekey.wasm"))),
      actionCreators.functionCall("migrate", { game_name: "LeaseKey Arena" }, 100n * TGAS, 0n),
    ],
    waitUntil: "FINAL",
  });
}
const games = await view<{ name: string }[]>(d.factoryId, "get_games");
const items = await view<{ game_name: string | null }[]>(d.factoryId, "get_items", { limit: 100 });
console.log(`games: ${games.map((g) => g.name).join(", ")}; items: ${items.length}, all credited: ${items.every((i) => i.game_name)}`);

const emberId = `ember.${d.factoryId}`;
const exists = await provider.viewAccount(emberId).then(() => true, () => false);
if (!exists) {
  console.log(`creating demo collection ${emberId}`);
  const key = KeyPair.fromRandom("ed25519");
  await retry("ember", () => factory.createSubAccount("ember", key.getPublicKey(), near("2.2")));
  saveKey(emberId, key.toString());
  const ember = accountFor(emberId);
  await ember.deployContract(readFileSync(join(ROOT, "res", "demo-nft.wasm")));
  await ember.callFunction({ contractId: emberId, methodName: "new", args: { name: "Ember Realms" } });
}
const out = JSON.parse(readFileSync(DEPLOYMENT_FILE, "utf8"));
out.demoCollection = emberId;
out.houseGame = d.factoryId;
writeFileSync(DEPLOYMENT_FILE, JSON.stringify(out, null, 2) + "\n");
console.log(`done. demo collection: ${emberId}`);
