// Live check of an item's full life on testnet, with the current item code:
// mint a copy, list it, rent it, reset the play key from the renter's own account,
// settle (owner, game royalty and LeaseKey's 2% fee), then retire it and get the storage back.
//   npx tsx scripts/lifecycle.ts
import { KeyPair } from "near-api-js";
import { TGAS, accountFor, near, provider, readDeployment, retry, view } from "./common.ts";

const d = readDeployment();
if (!d) throw new Error("no deployment");
const factoryId = d.factoryId;
const ownerId = `owner.${factoryId}`;
const renterId = process.env.RENTER ?? "lk-renter-bdumy3.testnet";
const game = accountFor(factoryId); // the house game, LeaseKey Originals
const owner = accountFor(ownerId);
const renter = accountFor(renterId);
const ok = (cond: unknown, msg: string) => { if (!cond) throw new Error("FAILED: " + msg); console.log("ok  " + msg); };
const nearOf = (y: bigint | string) => (Number(BigInt(y) / 10n ** 18n) / 1e6).toFixed(5);
const balance = async (id: string) => BigInt((await provider.viewAccount(id)).amount);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 1. The game mints a copy of an existing type to the owner, who lists it.
const deposit = BigInt(await view<string>(factoryId, "mint_deposit"));
const minted = await retry("mint", () => game.callFunction({
  contractId: factoryId, methodName: "mint", deposit, gas: 150n * TGAS, waitUntil: "FINAL",
  args: { args: { item_type: "frost-bow", price_per_hour: near("0.5").toString(), max_secs: "7200", royalty_bps: 1000, owner: ownerId } },
})) as { item_account: string; token_id: string; edition: number };
const item = minted.item_account;
ok(item, `minted ${minted.token_id} (copy #${minted.edition}) to ${ownerId}`);
await retry("list", () => owner.callFunction({ contractId: item, methodName: "list", args: {}, waitUntil: "FINAL" }));

// 2. Rent for 60 seconds with play key A.
const keyA = KeyPair.fromRandom("ed25519");
const rent = near("0.5") * 60n / 3600n;
await retry("rent", () => renter.callFunction({
  contractId: item, methodName: "rent", deposit: rent + near("0.05"), gas: 100n * TGAS, waitUntil: "FINAL",
  args: { public_key: keyA.getPublicKey().toString(), duration_secs: "60" },
}));
ok(true, `${renterId} rented it for 60 s`);

// 3. Lost device: the renter's own account swaps in play key B. A stops, B plays.
const keyB = KeyPair.fromRandom("ed25519");
await retry("reset", () => renter.callFunction({ contractId: item, methodName: "reset_key", args: { public_key: keyB.getPublicKey().toString() }, waitUntil: "FINAL" }));
const play = (k: KeyPair) => accountFor(item, k.toString()).callFunction({ contractId: item, methodName: "use_item", args: { action: "attack" }, gas: 10n * TGAS, waitUntil: "FINAL" });
const used = await retry("play with B", () => play(keyB)) as { uses: number };
ok(used.uses === 1, "the new play key works");
ok(await play(keyA).then(() => false, () => true), "the old play key is rejected");

// 4. Time is up: settle. The owner, the game and LeaseKey are paid.
const info = await view<{ ends_at: string; now_ms: string }>(item, "get_item");
await sleep(Math.max(0, Number(info.ends_at) - Number(info.now_ms)) + 3000);
const s = await retry("end_rental", () => renter.callFunction({ contractId: item, methodName: "end_rental", args: {}, gas: 100n * TGAS, waitUntil: "FINAL" })) as Record<string, string>;
ok(BigInt(s.protocol_cut) > 0n, `settled: rent ${nearOf(s.rent_earned)}, owner ${nearOf(s.owner_cut)}, game ${nearOf(s.creator_cut)}, LeaseKey fee ${nearOf(s.protocol_cut)} NEAR`);

// 5. The owner retires the item: the account is deleted and its storage comes back.
const before = await balance(ownerId);
await retry("retire", () => owner.callFunction({ contractId: factoryId, methodName: "retire", args: { token_id: minted.token_id }, deposit: 1n, gas: 100n * TGAS, waitUntil: "FINAL" }));
const back = (await balance(ownerId)) - before;
ok(back > near("0.1"), `retired: item account deleted, ${nearOf(back)} NEAR returned to the owner`);
ok(await provider.viewAccount(item).then(() => false, () => true), "the item account no longer exists");
