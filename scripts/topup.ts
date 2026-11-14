// Tops up the factory and the guest bank by draining fresh testnet-faucet accounts into them.
//   npx tsx scripts/topup.ts [count]
import { accountFor, createFaucetAccount, fmt, provider, randomSuffix, readDeployment, retry } from "./common.ts";
const d = readDeployment()!;
const n = Number(process.argv[2] ?? 2);
for (let i = 0; i < n; i++) {
  const target = i % 2 === 0 ? d.factoryId : d.guestBank!.accountId;
  const funder = await createFaucetAccount(`lk-fund-${randomSuffix()}.testnet`);
  await retry("drain", () => funder.deleteAccount(target));
  console.log(`+~10 NEAR -> ${target}`);
}
for (const id of [d.factoryId, d.guestBank!.accountId]) console.log(id, fmt((await provider.viewAccount(id)).amount));
void accountFor;
