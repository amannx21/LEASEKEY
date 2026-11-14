// Deploys LeaseKey to NEAR testnet and seeds demo items.
//
//   npm run deploy                 # global-contract mode (default)
//   MODE=embedded npm run deploy   # copy the item wasm into every item account
//   ITEMS=4 npm run deploy         # seed fewer items
//
// Uses only throwaway accounts funded by the public testnet faucet. Keys are
// written to .leasekey/keys (git-ignored). Never touches mainnet.
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { KeyPair } from "near-api-js";
import {
  DEPLOYMENT_FILE, KEYS_DIR, ROOT, TGAS, accountFor, createFaucetAccount, fmt, near, provider,
  randomSuffix, retry, saveKey, setupGuestBank, view, type Deployment,
} from "./common.ts";

const MODE = (process.env.MODE ?? "global") as "global" | "embedded";
const ITEM_COUNT = Number(process.env.ITEMS ?? 12);
const GAS = 300n * TGAS;

// How many of each can ever exist. Fewer = harder to get = worth more to rent.
const SUPPLY: Record<string, number> = {
  "Astral Gauntlet": 1, "Thunder Hammer": 3, "Tide Trident": 3, "Photon Saber": 4,
  "Flame Sword": 5, "Storm Staff": 5, "Aegis Plate": 6, "Frost Bow": 8,
  "Plasma Blaster": 8, "Shadow Dagger": 10, "Seraph Helm": 10, "Guardian Shield": 12,
};

const DEMO_ITEMS = [
  { name: "Flame Sword", image: "flame-sword.svg", power: 40, price: "0.1", royalty_bps: 1000 },
  { name: "Frost Bow", image: "frost-bow.svg", power: 28, price: "0.06", royalty_bps: 1000 },
  { name: "Thunder Hammer", image: "thunder-hammer.svg", power: 60, price: "0.2", royalty_bps: 1500 },
  { name: "Shadow Dagger", image: "shadow-dagger.svg", power: 18, price: "0.04", royalty_bps: 500 },
  { name: "Guardian Shield", image: "guardian-shield.svg", power: 12, price: "0.03", royalty_bps: 1000 },
  { name: "Plasma Blaster", image: "plasma-blaster.svg", power: 22, price: "0.12", royalty_bps: 1000 },
  { name: "Storm Staff", image: "storm-staff.svg", power: 34, price: "0.15", royalty_bps: 1000 },
  { name: "Aegis Plate", image: "aegis-plate.svg", power: 55, price: "0.08", royalty_bps: 1000 },
  { name: "Seraph Helm", image: "seraph-helm.svg", power: 30, price: "0.05", royalty_bps: 1000 },
  { name: "Astral Gauntlet", image: "astral-gauntlet.svg", power: 70, price: "0.3", royalty_bps: 1500 },
  { name: "Photon Saber", image: "photon-saber.svg", power: 45, price: "0.14", royalty_bps: 1000 },
  { name: "Tide Trident", image: "tide-trident.svg", power: 38, price: "0.11", royalty_bps: 1000 },
];

async function balance(id: string): Promise<bigint> {
  return retry("balance", async () => BigInt((await provider.viewAccount(id)).amount));
}

/** Tops the factory up by draining extra faucet accounts into it. */
async function fund(factoryId: string, target: bigint) {
  // Funder accounts left over from an interrupted run are drained first.
  const leftovers = existsSync(KEYS_DIR)
    ? readdirSync(KEYS_DIR).filter((f) => f.startsWith("lk-fund-")).map((f) => f.replace(/.json$/, ""))
    : [];
  for (let i = 0; i < 4 && (await balance(factoryId)) < target; i++) {
    const id = leftovers.pop() ?? `lk-fund-${randomSuffix()}.testnet`;
    console.log(`   balance ${fmt(await balance(factoryId))} NEAR < ${fmt(target)} needed: adding faucet account ${id}`);
    const funder = await createFaucetAccount(id);
    await retry("drain funder", () => funder.deleteAccount(factoryId)).catch((e) =>
      console.log(`   (funder ${id} unusable: ${String(e.message).slice(0, 80)})`));
    rmSync(join(KEYS_DIR, `${id}.json`), { force: true });
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
  const needed = factoryStorage + codeCost + perItem * BigInt(count) + near(6);
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
  await retry("owner", () => factory.createSubAccount("owner", ownerKey.getPublicKey(), near(1)));
  saveKey(ownerId, ownerKey.toString());
  const owner = accountFor(ownerId);

  // Only registered games can mint. The factory plays the demo's house game,
  // "LeaseKey Arena", and mints the demo items to the demo owner.
  console.log(`==> 5/5 registering the house game and minting ${count} demo items to the owner`);
  await retry("register", () =>
    factory.callFunction({ contractId: factoryId, methodName: "register_game", args: { name: "LeaseKey Arena" }, deposit: near("0.01") }));
  const mintDeposit = BigInt(await view<string>(factoryId, "mint_deposit"));
  const items: string[] = [];
  for (const it of DEMO_ITEMS.slice(0, count)) {
    // Each item belongs to a capped type: only SUPPLY[name] can ever exist.
    const typeId = it.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    await retry("define", () => factory.callFunction({
      contractId: factoryId, methodName: "define_item_type",
      args: { type_id: typeId, name: it.name, image: it.image, power: it.power, max_supply: SUPPLY[it.name] ?? 5 },
      deposit: near("0.01"),
    }));
    const minted = await factory.callFunction<{ token_id: string; item_account: string } | null>({
      contractId: factoryId,
      methodName: "mint",
      args: { args: {
        item_type: typeId,
        price_per_hour: near(it.price).toString(), max_secs: "7200",
        royalty_bps: it.royalty_bps, owner: ownerId,
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

  // A stand-in for another game's NFT collection, for the wrap demo.
  // Both partner games are verified so the Armory shows them by default.
  const emberId = `ember.${factoryId}`;
  const emberKey = KeyPair.fromRandom("ed25519");
  await retry("ember", () => factory.createSubAccount("ember", emberKey.getPublicKey(), near("2.2")));
  saveKey(emberId, emberKey.toString());
  await retry("ember deploy", () => accountFor(emberId).deployContract(readFileSync(join(ROOT, "res", "demo-nft.wasm"))));
  await accountFor(emberId).callFunction({ contractId: emberId, methodName: "new", args: { name: "Ember Realms" } });
  console.log(`   demo collection "Ember Realms" -> ${emberId}`);
  await accountFor(emberId).callFunction({ contractId: factoryId, methodName: "register_game", args: { name: "Ember Realms" }, deposit: near("0.01") });
  for (const game of [factoryId, emberId]) {
    await factory.callFunction({ contractId: factoryId, methodName: "set_verified", args: { game, verified: true } });
  }

  const deployment: Deployment = {
    network: "testnet", factoryId, ownerId, mode: MODE, itemCodeHash, items,
    deployedAt: new Date().toISOString(), demoCollection: emberId, houseGame: factoryId,
  };
  writeFileSync(DEPLOYMENT_FILE, JSON.stringify(deployment, null, 2) + "\n");

  // Spare funds go to a public guest bank, the fallback when the faucet rate-limits visitors.
  const spare = (await balance(factoryId)) - factoryStorage - near(2);
  if (spare > near(1)) await setupGuestBank(factoryId, spare);

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
