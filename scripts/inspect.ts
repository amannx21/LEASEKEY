// Prints wrapped items, wrap credit and Ember Realms ownership for an account.
//   npx tsx scripts/inspect.ts <account>
import { readDeployment, view } from "./common.ts";
const d = readDeployment()!;
const who = process.argv[2];
const items = await view<any[]>(d.factoryId, "get_items", { limit: 100 });
console.log("wrapped items:", JSON.stringify(items.filter((i) => i.origin)));
if (who) {
  console.log("wrap credit:", await view(d.factoryId, "get_wrap_credit", { account_id: who }));
  console.log("ember tokens:", JSON.stringify((await view<any[]>(d.demoCollection!, "nft_tokens_for_owner", { account_id: who })).map((t) => t.token_id)));
}
console.log("ember held by factory:", JSON.stringify((await view<any[]>(d.demoCollection!, "nft_tokens_for_owner", { account_id: d.factoryId })).map((t) => t.token_id)));
