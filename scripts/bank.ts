// Funds the public guest bank of the current deployment from the factory account.
//   npm run bank -- 5        # move 5 NEAR from the factory to bank.<factory>
import { near, readDeployment, setupGuestBank } from "./common.ts";

const d = readDeployment();
if (!d) throw new Error("no deployment: run `npm run deploy` first");
await setupGuestBank(d.factoryId, near(process.argv[2] ?? "5"));
console.log(`guest bank bank.${d.factoryId} funded`);
