// Gives each house item type its game stats. Set once; the chain then fixes them.
import { STATS, accountFor, readDeployment, view } from "./common.ts";



const d = readDeployment()!;
const house = accountFor(d.factoryId);
for (const t of await view<any[]>(d.factoryId, "get_item_types", { game: d.factoryId })) {
  const have = await view<any[]>(d.factoryId, "get_type_stats", { game: d.factoryId, type_id: t.type_id });
  const want = STATS[t.type_id];
  if (have.length || !want) continue;
  await house.callFunction({
    contractId: d.factoryId, methodName: "set_type_stats",
    args: { type_id: t.type_id, stats: want.map(([name, value]) => ({ name, value })) },
  });
  console.log(`${t.type_id}: ${want.map(([n, v]) => `${n} ${v}`).join(", ")}`);
}
