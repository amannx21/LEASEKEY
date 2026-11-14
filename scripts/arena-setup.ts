// Deploys "Slime Arena", the demo game, as its own contract and registered LeaseKey game.
// Idempotent. Run after deploy.ts or upgrade.ts:  npx tsx scripts/arena-setup.ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KeyPair } from "near-api-js";
import { DEPLOYMENT_FILE, ROOT, accountFor, near, provider, readDeployment, retry, saveKey, view } from "./common.ts";

const REWARDS = [
  { type_id: "slime-crown", name: "Slime King's Crown", image: "seraph-helm.svg", power: 32, max_supply: 3,
    stats: [["attack", 8], ["defence", 34], ["speed", 14], ["endurance", 40]] },
  { type_id: "ooze-maul", name: "Ooze Maul", image: "thunder-hammer.svg", power: 48, max_supply: 4,
    stats: [["attack", 48], ["defence", 10], ["speed", 8], ["endurance", 24]] },
  { type_id: "gel-blade", name: "Gel Blade", image: "shadow-dagger.svg", power: 24, max_supply: 8,
    stats: [["attack", 24], ["defence", 4], ["speed", 30], ["endurance", 12]] },
  { type_id: "slime-ward", name: "Slime Ward", image: "guardian-shield.svg", power: 14, max_supply: 12,
    stats: [["attack", 14], ["defence", 36], ["speed", 10], ["endurance", 30]] },
];

const d = readDeployment()!;
const factory = accountFor(d.factoryId);
const arenaId = `arena.${d.factoryId}`;
const exists = await provider.viewAccount(arenaId).then(() => true, () => false);
if (!exists) {
  console.log(`creating game account ${arenaId}`);
  const key = KeyPair.fromRandom("ed25519");
  await retry("arena", () => factory.createSubAccount("arena", key.getPublicKey(), near("5.5")));
  saveKey(arenaId, key.toString());
}
const arena = accountFor(arenaId);
await retry("deploy arena", () => arena.deployContract(readFileSync(join(ROOT, "res", "arena-game.wasm"))));
const accepted = [d.factoryId, d.demoCollection, arenaId].filter(Boolean);
const rules = await view<any>(arenaId, "get_rules").catch(() => null);
if (!rules) await arena.callFunction({ contractId: arenaId, methodName: "new", args: { factory: d.factoryId, accepted_games: accepted } });
else await arena.callFunction({ contractId: arenaId, methodName: "set_rules", args: { accepted_games: accepted } });

if (!(await view<any>(d.factoryId, "get_game", { account_id: arenaId }))) {
  await arena.callFunction({ contractId: d.factoryId, methodName: "register_game", args: { name: "Slime Arena" }, deposit: near("0.01") });
}
const have = new Set((await view<any[]>(d.factoryId, "get_item_types", { game: arenaId })).map((t) => t.type_id));
for (const r of REWARDS) {
  if (have.has(r.type_id)) continue;
  await arena.callFunction({
    contractId: d.factoryId, methodName: "define_item_type",
    args: { ...r, stats: r.stats.map(([name, value]) => ({ name, value })) }, deposit: near("0.01"),
  });
  console.log(`reward type ${r.name}: only ${r.max_supply} will ever exist`);
}
await factory.callFunction({ contractId: d.factoryId, methodName: "set_verified", args: { game: arenaId, verified: true } });
// The factory account's own items are the launch collection, not a game.
await factory.callFunction({ contractId: d.factoryId, methodName: "register_game", args: { name: "LeaseKey Originals" }, deposit: near("0.01") });

const out = JSON.parse(readFileSync(DEPLOYMENT_FILE, "utf8"));
out.arenaGame = arenaId;
writeFileSync(DEPLOYMENT_FILE, JSON.stringify(out, null, 2) + "\n");
console.log(`Slime Arena is live at ${arenaId}; accepts ${accepted.join(", ")}`);

// Ember Realms, the partner game, publishes its catalogue: every item it has, with stats.
// Wrapped Ember items pick these up automatically; the owner only sets a price.
const EMBER = [
  { name: "Ember Greataxe", image: "flame-sword.svg", power: 44, stats: [["attack", 44], ["defence", 9], ["speed", 14], ["endurance", 22]] },
  { name: "Abyssal Trident", image: "tide-trident.svg", power: 40, stats: [["attack", 40], ["defence", 16], ["speed", 12], ["endurance", 28]] },
  { name: "Starforged Gauntlet", image: "astral-gauntlet.svg", power: 58, stats: [["attack", 58], ["defence", 18], ["speed", 16], ["endurance", 34]] },
  { name: "Halo of the Seraph", image: "seraph-helm.svg", power: 26, stats: [["attack", 6], ["defence", 32], ["speed", 12], ["endurance", 40]] },
];
if (d.demoCollection) {
  const ember = accountFor(d.demoCollection);
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24).replace(/-$/, "");
  const defined = new Set((await view<any[]>(d.factoryId, "get_item_types", { game: d.demoCollection })).map((t) => t.type_id));
  for (const e of EMBER) {
    if (defined.has(slug(e.name))) continue;
    await ember.callFunction({
      contractId: d.factoryId, methodName: "define_item_type",
      args: { type_id: e.name, name: e.name, image: e.image, power: e.power, max_supply: 10000, stats: e.stats.map(([name, value]) => ({ name, value })) },
      deposit: near("0.01"),
    });
    console.log(`Ember Realms catalogue: ${e.name}`);
  }
  // Items wrapped before the catalogue existed get their stats from the game now.
  for (const ref of await view<any[]>(d.factoryId, "get_items", { limit: 100 })) {
    if (ref.origin?.contract !== d.demoCollection || ref.stats.length) continue;
    const item = await view<any>(ref.item_account, "get_item");
    const e = EMBER.find((x) => x.name === item.name);
    if (!e) continue;
    await ember.callFunction({ contractId: d.factoryId, methodName: "rate_wrapped", args: { token_id: ref.token_id, stats: e.stats.map(([name, value]) => ({ name, value })) } });
    console.log(`rated earlier wrap ${ref.token_id}`);
  }
}
