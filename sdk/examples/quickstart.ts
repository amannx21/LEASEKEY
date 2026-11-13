// LeaseKey SDK quickstart against the live testnet deployment.
//   npm run sdk:example
// A "game" rents the cheapest free item for a player, checks access, performs
// three in-game actions with the session key, and returns the item early.
import { readFileSync } from "node:fs";
import { Account, KeyPair, KeyPairSigner } from "near-api-js";
import { LeaseKey, formatNear } from "../src/index.ts";

const deployment = JSON.parse(readFileSync(new URL("../../web/src/deployment.json", import.meta.url), "utf8"));
const lk = new LeaseKey({ factoryId: deployment.factoryId });

// A throwaway player account, funded by the deployment's public testnet guest bank.
const bank = deployment.guestBank;
const banker = new Account(bank.accountId, lk.provider, KeyPairSigner.fromSecretKey(bank.secretKey));
const name = `sdk-${Math.random().toString(36).slice(2, 8)}`;
const playerKey = KeyPair.fromRandom("ed25519");
await banker.createSubAccount(name, playerKey.getPublicKey(), 10n ** 23n * 3n);
const player = new Account(`${name}.${bank.accountId}`, lk.provider, new KeyPairSigner(playerKey));
console.log(`player: ${player.accountId}`);

// 1. Find something to rent.
const free = (await lk.available()).sort((a, b) => Number(BigInt(a.price_per_hour) - BigInt(b.price_per_hour)));
if (!free.length) throw new Error("nothing free to rent right now");
const item = free[0];
console.log(`renting ${item.name} (${item.account_id}) at ${formatNear(item.price_per_hour)} NEAR/hr`);

// 2. Rent it for two minutes. The SDK makes the session key.
const session = await lk.rent(player, item.account_id, 120);
console.log(`can use: ${JSON.stringify(await lk.canUse(item.account_id, player.accountId))}`);

// 3. In-game actions, signed by the session key. No wallet involved.
for (const action of ["slash", "slash", "parry"]) {
  const r = await session.use(action);
  console.log(`use_item("${action}") -> uses ${r.uses}, durability ${r.durability}, event ${r.events[0]?.event}, tx ${r.txHash}`);
}

// 4. Give it back early and get the unused time refunded.
const s = await lk.returnEarly(player, item.account_id);
console.log(`returned early: owner +${formatNear(s.owner_cut)}, creator +${formatNear(s.creator_cut)}, refund ${formatNear(s.renter_refund)} NEAR`);
console.log(`session still active: ${await session.active()}`);
