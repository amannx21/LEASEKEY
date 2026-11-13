import { accountFor, readDeployment, near, view, fmt, provider } from "./common.ts";
const d = readDeployment()!;
console.log("factory state:", await view(d.factoryId, "get_games").then(() => "v2", () => "v1"));
const bank = accountFor(d.guestBank!.accountId, d.guestBank!.secretKey);
console.log("bank", fmt((await provider.viewAccount(bank.accountId)).amount), "factory", fmt((await provider.viewAccount(d.factoryId)).amount));
if (process.argv[2]) {
  await bank.transfer({ receiverId: d.factoryId, amount: near(process.argv[2]) });
  console.log("after: factory", fmt((await provider.viewAccount(d.factoryId)).amount));
}
