// Keeper bot: ends expired rentals so owners get paid and session keys are deleted.
// Anyone can run it, end_rental is permissionless.
//
//   npm run keeper            # loop forever
//   npm run keeper -- --once  # single pass
//
// Signs with KEEPER_ACCOUNT_ID / KEEPER_PRIVATE_KEY if set, otherwise with a
// throwaway faucet account stored in .leasekey/keys.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Account } from "near-api-js";
import {
  ROOT, accountFor, createFaucetAccount, fmt, randomSuffix, readDeployment, sleep, view,
} from "./common.ts";

type ItemRef = { token_id: string; item_account: string; owner: string };
type ItemView = { name: string; renter: string | null; rental_active: boolean; ends_at: string | null };

async function keeperAccount(): Promise<Account> {
  if (process.env.KEEPER_ACCOUNT_ID && process.env.KEEPER_PRIVATE_KEY) {
    return accountFor(process.env.KEEPER_ACCOUNT_ID, process.env.KEEPER_PRIVATE_KEY);
  }
  const marker = join(ROOT, ".leasekey", "keeper.txt");
  if (existsSync(marker)) return accountFor(readFileSync(marker, "utf8").trim());
  const id = `lk-keeper-${randomSuffix()}.testnet`;
  console.log(`creating keeper account ${id} from the testnet faucet`);
  const account = await createFaucetAccount(id);
  writeFileSync(marker, id);
  return account;
}

async function pass(factoryId: string, keeper: Account): Promise<number> {
  const items = await view<ItemRef[]>(factoryId, "get_items", { limit: 100 });
  let ended = 0;
  for (const ref of items) {
    const item = await view<ItemView>(ref.item_account, "get_item");
    if (!item.renter || item.rental_active) continue;
    try {
      const s = await keeper.callFunction<any>({
        contractId: ref.item_account, methodName: "end_rental", args: {}, waitUntil: "FINAL",
      });
      ended++;
      console.log(
        `ended ${item.name} (${ref.item_account}): owner +${fmt(s.owner_cut)} NEAR, ` +
        `creator +${fmt(s.creator_cut)} NEAR, renter refund ${fmt(s.renter_refund)} NEAR`);
    } catch (e) {
      console.log(`could not end ${ref.item_account}: ${String((e as Error).message).slice(0, 140)}`);
    }
  }
  return ended;
}

async function main() {
  const factoryId = process.env.FACTORY_ID ?? process.env.VITE_FACTORY_ID ?? readDeployment()?.factoryId;
  if (!factoryId) throw new Error("no factory: run `npm run deploy` or set FACTORY_ID");
  const keeper = await keeperAccount();
  const once = process.argv.includes("--once");
  console.log(`keeper ${keeper.accountId} watching ${factoryId}${once ? " (single pass)" : ""}`);
  for (;;) {
    const ended = await pass(factoryId, keeper).catch((e) => {
      console.log(`pass failed: ${e.message}`);
      return 0;
    });
    if (once) {
      console.log(`done, ended ${ended} rental(s)`);
      return;
    }
    await sleep(8000);
  }
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
