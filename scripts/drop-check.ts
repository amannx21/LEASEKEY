// Live check of the game loop: rent an item, land 20 on-chain strikes, and ask the Slime Arena
// game contract for a reward. The arena mints through the factory's public `mint`.
//   npx tsx scripts/drop-check.ts
import { LeaseKey, formatNear } from "../sdk/src/index.ts";
import { TGAS, createTestAccount, readDeployment } from "./common.ts";

const d = readDeployment()!;
const lk = new LeaseKey({ factoryId: d.factoryId });
const player = await createTestAccount("lk-drop", "0.5");
const free = (await lk.available()).filter((i) => i.owner === d.ownerId)
  .sort((a, b) => Number(BigInt(a.price_per_hour) - BigInt(b.price_per_hour)));
const item = free[0];
console.log(`player ${player.accountId} rents ${item.name} at ${formatNear(item.price_per_hour)} NEAR/hr`);
const session = await lk.rent(player, item.account_id, 300);
// the key allowance covers a handful of strikes in flight, so send them in small volleys
for (let i = 0; i < 5; i++) await Promise.all(Array.from({ length: 4 }, () => session.use("slash")));
console.log(`strikes on chain: ${(await lk.getItem(item.account_id)).uses}`);
const out = await player.callFunction<any>({
  contractId: d.arenaGame!, methodName: "claim_reward", args: { token_id: item.token_id }, gas: 150n * TGAS, waitUntil: "FINAL",
});
console.log(out ? `REWARD: ${out.item_type} edition ${out.edition} of ${out.max_supply} -> ${out.item_account}, owner ${out.owner}` : "no reward this roll (60% of rolls miss)");
const s = await lk.returnEarly(player, item.account_id);
console.log(`returned early, refund ${formatNear(s.renter_refund)} NEAR`);
