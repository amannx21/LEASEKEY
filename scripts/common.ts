// Shared helpers for the LeaseKey scripts. Testnet only.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, KeyPair, KeyPairSigner, providers } from "near-api-js";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const RPC_URL = process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com";
export const FAUCET_URL = "https://helper.testnet.near.org/account";
export const KEYS_DIR = join(ROOT, ".leasekey", "keys");
export const DEPLOYMENT_FILE = join(ROOT, "web", "src", "deployment.json");

export const NEAR = 10n ** 24n;
export const TGAS = 10n ** 12n;
export const provider = new providers.JsonRpcProvider({ url: RPC_URL });

export type Deployment = {
  network: "testnet";
  factoryId: string;
  ownerId: string;
  mode: "global" | "embedded";
  itemCodeHash?: string;
  items: string[];
  deployedAt: string;
};

export function near(amount: string | number): bigint {
  const [whole, frac = ""] = String(amount).split(".");
  return BigInt(whole) * NEAR + BigInt((frac + "0".repeat(24)).slice(0, 24));
}

export function fmt(yocto: bigint | string): string {
  const v = BigInt(yocto);
  const frac = (v % NEAR).toString().padStart(24, "0").slice(0, 4);
  return `${v / NEAR}.${frac}`;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function retry<T>(label: string, fn: () => Promise<T>, tries = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries) throw e;
      console.log(`   (${label} failed: ${String((e as Error).message).slice(0, 120)}; retry ${i})`);
      await sleep(2000 * i);
    }
  }
}

export function saveKey(accountId: string, secretKey: string) {
  mkdirSync(KEYS_DIR, { recursive: true });
  writeFileSync(join(KEYS_DIR, `${accountId}.json`), JSON.stringify({ accountId, secretKey }, null, 2));
}

export function loadKey(accountId: string): string | undefined {
  const f = join(KEYS_DIR, `${accountId}.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")).secretKey : undefined;
}

export function accountFor(accountId: string, secretKey?: string): Account {
  const sk = secretKey ?? loadKey(accountId);
  if (!sk) throw new Error(`no key for ${accountId} in ${KEYS_DIR}`);
  return new Account(accountId, provider, KeyPairSigner.fromSecretKey(sk as any));
}

/** Creates a throwaway testnet account funded by the public testnet faucet. */
export async function createFaucetAccount(accountId: string): Promise<Account> {
  const keyPair = KeyPair.fromRandom("ed25519");
  const res = await fetch(FAUCET_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      newAccountId: accountId,
      newAccountPublicKey: keyPair.getPublicKey().toString(),
    }),
  });
  if (!res.ok) throw new Error(`faucet refused ${accountId}: ${res.status} ${await res.text()}`);
  saveKey(accountId, keyPair.toString());
  // Wait until the account is visible on the RPC node.
  for (let i = 0; i < 20; i++) {
    try {
      await provider.viewAccount(accountId);
      break;
    } catch {
      await sleep(1000);
    }
  }
  return accountFor(accountId, keyPair.toString());
}

export function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function readDeployment(): Deployment | undefined {
  if (!existsSync(DEPLOYMENT_FILE)) return undefined;
  const d = JSON.parse(readFileSync(DEPLOYMENT_FILE, "utf8"));
  return d.factoryId ? d : undefined;
}

export async function view<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  return retry(`view ${method}`, async () => (await provider.callFunction(contractId, method, args)) as T);
}
