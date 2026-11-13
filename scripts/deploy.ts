// Deploys LeaseKey to NEAR testnet and seeds demo items.
//
//   npm run deploy                 # global-contract mode (default)
//   MODE=embedded npm run deploy   # copy the item wasm into every item account
//   ITEMS=4 npm run deploy         # seed fewer items
//
// Uses only throwaway accounts funded by the public testnet faucet. Keys are
// written to .leasekey/keys (git-ignored). Never touches mainnet.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { KeyPair } from "near-api-js";
import {
  DEPLOYMENT_FILE, ROOT, TGAS, accountFor, createFaucetAccount, fmt, near, provider,
  randomSuffix, retry, saveKey, view, type Deployment,
} from "./common.ts";

const MODE = (process.env.MODE ?? "global") as "global" | "embedded";
const ITEM_COUNT = Number(process.env.ITEMS ?? 5);
const GAS = 300n * TGAS;

const DEMO_ITEMS = [
  { name: "Flame Sword", image: "flame-sword.svg", power: 40, price: "0.1", royalty_bps: 1000 },
  { name: "Frost Bow", image: "frost-bow.svg", power: 28, price: "0.06", royalty_bps: 1000 },
  { name: "Thunder Hammer", image: "thunder-hammer.svg", power: 60, price: "0.2", royalty_bps: 1500 },
  { name: "Shadow Dagger", image: "shadow-dagger.svg", power: 18, price: "0.04", royalty_bps: 500 },
  { name: "Guardian Shield", image: "guardian-shield.svg", power: 12, price: "0.03", royalty_bps: 1000 },
  { name: "Storm Staff", image: "storm-staff.svg", power: 50, price: "0.15", royalty_bps: 1000 },
];

async function balance(id: string): Promise<bigint> {
  return BigInt((await provider.viewAccount(id)).amount);
}

/** Tops the factory up by draining extra faucet accounts into it. */
async function fund(factoryId: string, target: bigint) {
  for (let i = 0; i < 4 && (await balance(factoryId)) < target; i++) {
    const id = `lk-fund-${randomSuffix()}.testnet`;
    console.log(`   balance ${fmt(await balance(factoryId))} NEAR < ${fmt(target)} needed: adding faucet account ${id}`);
    const funder = await createFaucetAccount(id);
    await retry("drain funder", () => funder.deleteAccount(factoryId));
  }
  const have = await balance(factoryId);
  if (have < target) throw new Error(`could not fund ${factoryId}: have ${fmt(have)}, need ${fmt(target)} NEAR`);
}

async function main() {
  const factoryWasm = readFileSync(join(ROOT, "res", "leasekey.wasm"));
  const itemWasm = readFileSync(join(ROOT, "res", "item.wasm"));
  const itemBytes = BigInt(itemWasm.length);
  const count = Math.min(Math.max(ITEM_COUNT, 1), DEMO_ITEMS.length);

  const factoryId = process.env.FACTORY_ID ?? `leasekey-${randomSuffix()}.testnet`;
  console.log(`==> 1/5 creating factory account ${factoryId} (testnet faucet)`);
  const factory = await createFaucetAccount(factoryId);

  // Storage is 1 NEAR / 100kb. Publishing a global contract burns 10 NEAR / 100kb.
  const factoryStorage = (BigInt(factoryWasm.length) * near(1)) / 100_000n;
  const codeCost = MODE === "global" ? (itemBytes * near(10)) / 100_000n : (itemBytes * near(1)) / 100_000n;
  const perItem = near("0.16") + (MODE === "embedded" ? codeCost : 0n);
  const needed = factoryStorage + codeCost + perItem * BigInt(count) + near(3);
  await fund(factoryId, needed);

  console.log(`==> 2/5 deploying factory + NFT contract (${factoryWasm.length} bytes)`);
  await retry("deploy", () => factory.deployContract(factoryWasm));
  await retry("init", () => factory.callFunction({ contractId: factoryId, methodName: "new", args: {} }));

  console.log(`==> 3/5 item code (${itemWasm.length} bytes) in ${MODE} mode`);
  await factory.callFunction({
    contractId: factoryId,
    methodName: MODE === "global" ? "publish_item_code_global" : "store_item_code",
    args: new Uint8Array(itemWasm),
    deposit: MODE === "global" ? codeCost + near("0.5") : 0n,
    gas: GAS,
    waitUntil: "FINAL",
  });
  const itemCodeHash = createHash("sha256").update(itemWasm).digest("hex");

  const ownerId = `owner.${factoryId}`;
  console.log(`==> 4/5 creating demo item owner ${ownerId}`);
  const ownerKey = KeyPair.fromRandom("ed25519");
  await retry("owner", () =>
    factory.createSubAccount("owner", ownerKey.getPublicKey(), perItem * BigInt(count) + near(1)));
  saveKey(ownerId, ownerKey.toString());
  const owner = accountFor(ownerId);

  console.log(`==> 5/5 minting and listing ${count} demo items`);
  const mintDeposit = BigInt(await view<string>(factoryId, "mint_deposit"));
  const items: string[] = [];
  for (const it of DEMO_ITEMS.slice(0, count)) {
    const minted = await owner.callFunction<{ token_id: string; item_account: string } | null>({
      contractId: factoryId,
      methodName: "mint",
      args: { args: {
        name: it.name, image: it.image, power: it.power,
        price_per_hour: near(it.price).toString(), max_secs: "7200",
        royalty_bps: it.royalty_bps, creator: factoryId,
      } },
      deposit: mintDeposit,
      gas: GAS,
      waitUntil: "FINAL",
    });
    if (!minted) throw new Error(`mint of ${it.name} failed`);
    await retry("list", () =>
      owner.callFunction({ contractId: minted.item_account, methodName: "list", args: {} }));
    items.push(minted.item_account);
    console.log(`   ${it.name.padEnd(16)} -> ${minted.item_account}  (${it.price} NEAR/hr)`);
  }

  const deployment: Deployment = {
    network: "testnet", factoryId, ownerId, mode: MODE, itemCodeHash, items,
    deployedAt: new Date().toISOString(),
  };
  writeFileSync(DEPLOYMENT_FILE, JSON.stringify(deployment, null, 2) + "\n");

  console.log(`\nDeployed. Factory balance left: ${fmt(await balance(factoryId))} NEAR`);
  console.log(`  factory / NFT contract : ${factoryId}`);
  console.log(`  demo owner             : ${ownerId}`);
  console.log(`  explorer               : https://testnet.nearblocks.io/address/${factoryId}`);
  console.log(`  written                : web/src/deployment.json (the frontend reads it)`);
  console.log(`\nNext: npm run dev   (frontend)   |   npm run keeper   (ends expired rentals)`);
}

main().catch((e) => {
  console.error("\nDEPLOY FAILED:", e?.message ?? e);
  process.exit(1);
});
