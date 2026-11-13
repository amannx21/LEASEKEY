// Mints and lists extra demo items on the current deployment, signed by the demo owner.
//   npx tsx scripts/add-items.ts
import { readFileSync, writeFileSync } from "node:fs";
import { DEPLOYMENT_FILE, TGAS, accountFor, near, readDeployment, view } from "./common.ts";

const EXTRA = [
  { name: "Plasma Blaster", image: "plasma-blaster.svg", power: 22, price: "0.12", royalty_bps: 1000 },
  { name: "Storm Staff", image: "storm-staff.svg", power: 34, price: "0.15", royalty_bps: 1000 },
  { name: "Aegis Plate", image: "aegis-plate.svg", power: 55, price: "0.08", royalty_bps: 1000 },
  { name: "Seraph Helm", image: "seraph-helm.svg", power: 30, price: "0.05", royalty_bps: 1000 },
  { name: "Astral Gauntlet", image: "astral-gauntlet.svg", power: 70, price: "0.3", royalty_bps: 1500 },
  { name: "Photon Saber", image: "photon-saber.svg", power: 45, price: "0.14", royalty_bps: 1000 },
  { name: "Tide Trident", image: "tide-trident.svg", power: 38, price: "0.11", royalty_bps: 1000 },
];

const d = readDeployment();
if (!d) throw new Error("no deployment");
const owner = accountFor(d.ownerId);
if ((await owner.getBalance()) < near("0.8") && d.guestBank) {
  await accountFor(d.guestBank.accountId, d.guestBank.secretKey).transfer({ receiverId: d.ownerId, amount: near("1") });
}
const existing = await view<{ token_id: string }[]>(d.factoryId, "get_items", { limit: 100 });
const deposit = BigInt(await view<string>(d.factoryId, "mint_deposit"));
for (const it of EXTRA) {
  const slug = it.name.toLowerCase().replace(/ /g, "-");
  if (existing.some((e) => e.token_id.startsWith(slug))) {
    console.log(`${it.name} already exists`);
    continue;
  }
  const minted = await owner.callFunction<{ item_account: string } | null>({
    contractId: d.factoryId, methodName: "mint",
    args: { args: {
      name: it.name, image: it.image, power: it.power, price_per_hour: near(it.price).toString(),
      max_secs: "7200", royalty_bps: it.royalty_bps, creator: d.factoryId,
    } },
    deposit, gas: 300n * TGAS, waitUntil: "FINAL",
  });
  if (!minted) throw new Error(`mint of ${it.name} failed`);
  await owner.callFunction({ contractId: minted.item_account, methodName: "list", args: {} });
  d.items.push(minted.item_account);
  console.log(`${it.name} -> ${minted.item_account}`);
}
writeFileSync(DEPLOYMENT_FILE, JSON.stringify(JSON.parse(JSON.stringify(d)), null, 2) + "\n");
void readFileSync;
