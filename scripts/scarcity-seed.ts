// Gives the live deployment's items scarcity: defines each house item type with a
// supply cap, assigns editions to the existing items, and verifies partner games.
//   REDEPLOY=1 npx tsx scripts/upgrade.ts && npx tsx scripts/scarcity-seed.ts
import { accountFor, near, readDeployment, view } from "./common.ts";

// How many of each can ever exist. Fewer = harder to get = worth more to rent.
export const SUPPLY: Record<string, number> = {
  "Astral Gauntlet": 1, "Thunder Hammer": 3, "Tide Trident": 3, "Photon Saber": 4,
  "Flame Sword": 5, "Storm Staff": 5, "Aegis Plate": 6, "Frost Bow": 8,
  "Plasma Blaster": 8, "Shadow Dagger": 10, "Seraph Helm": 10, "Guardian Shield": 12,
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const d = readDeployment()!;
const house = accountFor(d.factoryId);
const refs = await view<any[]>(d.factoryId, "get_items", { limit: 100 });
const existing = new Set((await view<any[]>(d.factoryId, "get_item_types", { game: d.factoryId })).map((t) => t.type_id));

for (const ref of refs.filter((r) => r.game === d.factoryId && !r.edition)) {
  const item = await view<any>(ref.item_account, "get_item");
  const cap = SUPPLY[item.name];
  if (!cap) continue;
  const typeId = slug(item.name);
  if (!existing.has(typeId)) {
    await house.callFunction({
      contractId: d.factoryId, methodName: "define_item_type",
      args: { type_id: typeId, name: item.name, image: item.image, power: item.power, max_supply: cap },
      deposit: near("0.01"),
    });
    existing.add(typeId);
  }
  const e = await house.callFunction<any>({ contractId: d.factoryId, methodName: "backfill_edition", args: { token_id: ref.token_id, item_type: typeId } });
  console.log(`${item.name.padEnd(16)} edition ${e.number} of ${cap}`);
}

for (const game of [d.factoryId, d.demoCollection].filter(Boolean) as string[]) {
  await house.callFunction({ contractId: d.factoryId, methodName: "set_verified", args: { game, verified: true } });
  console.log(`verified ${game}`);
}
