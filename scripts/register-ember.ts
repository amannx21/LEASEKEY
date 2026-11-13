// Registers the Ember Realms demo collection as a game, so wrapped items show its name.
import { accountFor, near, readDeployment } from "./common.ts";
const d = readDeployment()!;
await accountFor(d.demoCollection!).callFunction({ contractId: d.factoryId, methodName: "register_game", args: { name: "Ember Realms" }, deposit: near("0.01") });
console.log("registered Ember Realms");
