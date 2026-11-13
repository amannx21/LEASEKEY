// Reproduces the wrap flow with a throwaway account and prints every log line.
import { KeyPair } from "near-api-js";
import { TGAS, accountFor, near, readDeployment, view } from "./common.ts";
const d = readDeployment()!;
const bank = accountFor(d.guestBank!.accountId, d.guestBank!.secretKey);
const name = `wrap-${Math.random().toString(36).slice(2, 7)}`;
const kp = KeyPair.fromRandom("ed25519");
await bank.createSubAccount(name, kp.getPublicKey(), near("0.4"));
const me = accountFor(`${name}.${bank.accountId}`, kp.toString());
const tok: any = await me.callFunction({ contractId: d.demoCollection!, methodName: "claim", args: { title: "Test Axe", media: "flame-sword.svg" }, deposit: near("0.02") });
console.log("claimed", tok.token_id);
const dep = BigInt(await view<string>(d.factoryId, "mint_deposit"));
await me.callFunction({ contractId: d.factoryId, methodName: "deposit_for_wrap", args: {}, deposit: dep });
const out = await me.callFunctionRaw({
  contractId: d.demoCollection!, methodName: "nft_transfer_call",
  args: { receiver_id: d.factoryId, token_id: tok.token_id, msg: JSON.stringify({ name: "Test Axe", image: "flame-sword.svg", power: 40, price_per_hour: near("0.08").toString(), royalty_bps: 500 }) },
  deposit: 1n, gas: 150n * TGAS, waitUntil: "FINAL",
});
for (const r of out.receipts_outcome) {
  const st = JSON.stringify(r.outcome.status).slice(0, 160);
  console.log(r.outcome.executor_id, r.outcome.logs.join(" | ").slice(0, 200), st);
}
