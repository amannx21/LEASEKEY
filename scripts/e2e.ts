// End-to-end check against the LIVE testnet deployment (about 90 seconds).
//   npm run e2e
// Rents an item for 60s with a fresh faucet account, plays with the session
// key, proves the key cannot do anything else, then settles after expiry.
import { Account, KeyPair, KeyPairSigner } from "near-api-js";
import {
  accountFor, createFaucetAccount, fmt, near, provider, randomSuffix, readDeployment, sleep, view,
} from "./common.ts";

type ItemView = {
  name: string; owner: string; listed: boolean; renter: string | null; rental_active: boolean;
  ends_at: string | null; now_ms: string; price_per_hour: string; uses: number;
  owner_earnings: string; creator_earnings: string; rental_count: number;
};

function ok(cond: boolean, label: string) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) process.exitCode = 1;
}

async function fails(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

async function main() {
  const d = readDeployment();
  if (!d) throw new Error("no deployment: run `npm run deploy` first");
  const refs = await view<{ token_id: string; item_account: string }[]>(d.factoryId, "get_items", {});
  let itemId = "";
  for (const r of refs) {
    const v = await view<ItemView>(r.item_account, "get_item");
    if (v.listed && !v.renter) itemId = r.item_account;
  }
  if (!itemId) throw new Error("no free listed item right now (run `npm run keeper -- --once`)");
  const tokenId = itemId.split(".")[0];
  const before = await view<ItemView>(itemId, "get_item");
  console.log(`item: ${before.name} (${itemId}) at ${fmt(before.price_per_hour)} NEAR/hr`);

  const renter = await createFaucetAccount(`lk-renter-${randomSuffix()}.testnet`);
  console.log(`renter: ${renter.accountId} (fresh faucet account)`);

  // Rent for 60 seconds with a session key generated right here.
  const sessionKey = KeyPair.fromRandom("ed25519");
  const secs = 60;
  const cost = (BigInt(before.price_per_hour) * BigInt(secs)) / 3600n;
  await renter.callFunction({
    contractId: itemId, methodName: "rent",
    args: { public_key: sessionKey.getPublicKey().toString(), duration_secs: String(secs) },
    deposit: cost + near("0.05"), gas: 100n * 10n ** 12n, waitUntil: "FINAL",
  });
  const rented = await view<ItemView>(itemId, "get_item");
  ok(rented.renter === renter.accountId && rented.rental_active, "rent: lease is active for the renter");
  ok(rented.owner === before.owner, "rent: the NFT did not move");

  // The session key signs AS THE ITEM ACCOUNT and can only call use_item.
  const session = new Account(itemId, provider, new KeyPairSigner(sessionKey));
  for (let i = 1; i <= 3; i++) {
    const r = await session.callFunction<{ uses: number; power: number }>({
      contractId: itemId, methodName: "use_item", args: { action: "attack" }, gas: 10n * 10n ** 12n,
    });
    ok(r.uses === i, `use_item #${i} with the session key (power ${r.power}, no wallet)`);
  }
  ok(await fails(() => session.callFunction({
    contractId: d.factoryId, methodName: "nft_transfer",
    args: { receiver_id: renter.accountId, token_id: tokenId }, deposit: 1n,
  })), "session key cannot transfer the NFT");
  ok(await fails(() => session.callFunction({ contractId: itemId, methodName: "unlist", args: {} })),
    "session key cannot call other item methods");
  ok(await fails(() => session.transfer({ receiverId: renter.accountId, amount: near("0.01") })),
    "session key cannot withdraw NEAR from the item");
  ok(await fails(() => renter.callFunction({
    contractId: d.factoryId, methodName: "nft_transfer",
    args: { receiver_id: renter.accountId, token_id: tokenId }, deposit: 1n,
  })), "renter wallet cannot transfer the NFT");
  ok(await fails(() => renter.callFunction({ contractId: itemId, methodName: "end_rental", args: {} })),
    "end_rental is rejected before expiry");

  process.stdout.write("waiting for the lease to expire");
  for (;;) {
    const v = await view<ItemView>(itemId, "get_item");
    if (!v.rental_active) break;
    process.stdout.write(".");
    await sleep(5000);
  }
  console.log();
  ok(await fails(() => session.callFunction({
    contractId: itemId, methodName: "use_item", args: { action: "attack" }, gas: 10n * 10n ** 12n,
  })), "use_item is rejected after expiry");

  const s = await renter.callFunction<any>({
    contractId: itemId, methodName: "end_rental", args: {}, gas: 100n * 10n ** 12n, waitUntil: "FINAL",
  });
  console.log(`settled: owner +${fmt(s.owner_cut)}, creator +${fmt(s.creator_cut)}, renter refund ${fmt(s.renter_refund)} NEAR`);
  const after = await view<ItemView>(itemId, "get_item");
  ok(BigInt(s.owner_cut) + BigInt(s.creator_cut) === cost, "split: owner + creator = rent paid");
  ok(BigInt(after.owner_earnings) - BigInt(before.owner_earnings) === BigInt(s.owner_cut), "owner earnings recorded on the item");
  ok(after.renter === null && after.rental_count === before.rental_count + 1, "rental closed");
  const keyGone = await fails(() => provider.viewAccessKey(itemId, sessionKey.getPublicKey().toString()));
  ok(keyGone, "session key deleted from the item account");
  ok(await fails(() => accountFor(renter.accountId).callFunction({ contractId: itemId, methodName: "end_rental", args: {} })),
    "no double settlement");
  console.log(process.exitCode ? "\nE2E FAILED" : "\nE2E OK");
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
