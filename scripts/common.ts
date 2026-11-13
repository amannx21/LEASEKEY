// Shared helpers for the LeaseKey scripts. Testnet only.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, KeyPair, KeyPairSigner, providers } from "near-api-js";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Public testnet RPCs are rate limited: set NEAR_RPC_URL to use your own.
export const RPC_URL = process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com";
export const FAUCET_URL = "https://helper.testnet.near.org/account";
export const KEYS_DIR = join(ROOT, ".leasekey", "keys");
export const DEPLOYMENT_FILE = join(ROOT, "web", "src", "deployment.json");

export const NEAR = 10n ** 24n;
export const TGAS = 10n ** 12n;
// Retries with backoff when the RPC answers 429.
export const provider = new providers.JsonRpcProvider({ url: RPC_URL }, { retries: 7, backoff: 1.7, wait: 1200 });

export type Deployment = {
  network: "testnet";
  factoryId: string;
  ownerId: string;
  mode: "global" | "embedded";
  itemCodeHash?: string;
  items: string[];
  deployedAt: string;
  demoCollection?: string;
  houseGame?: string;
  /** Throwaway TESTNET account, deliberately public: funds guest accounts when the faucet is rate limited. */
  guestBank?: { accountId: string; secretKey: string };
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
      if (/429|rate limit/i.test(String((e as Error).message))) await sleep(15000);
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
  if (loadKey(accountId)) return accountFor(accountId); // already created on an earlier run
  if (process.env.LK_NO_FAUCET) throw new Error("faucet disabled by LK_NO_FAUCET");
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
  // Wait until the account and its key are visible on the RPC node.
  for (let i = 0; i < 30; i++) {
    try {
      await provider.viewAccessKey(accountId, keyPair.getPublicKey());
      break;
    } catch {
      await sleep(1500);
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

/**
 * A funded throwaway account for tests and the keeper. Tries the public
 * faucet first; if it is rate limited, the deployment's guest bank creates a
 * sub-account instead.
 */
export async function createTestAccount(prefix: string, fundNear = "0.4"): Promise<Account> {
  const name = `${prefix}-${randomSuffix()}`;
  try {
    return await createFaucetAccount(`${name}.testnet`);
  } catch (e) {
    const bank = readDeployment()?.guestBank;
    if (!bank) throw e;
    console.log(`faucet unavailable, using guest bank ${bank.accountId}`);
    const keyPair = KeyPair.fromRandom("ed25519");
    const id = `${name}.${bank.accountId}`;
    await retry("bank", () =>
      accountFor(bank.accountId, bank.secretKey).createSubAccount(name, keyPair.getPublicKey(), near(fundNear)));
    saveKey(id, keyPair.toString());
    return accountFor(id, keyPair.toString());
  }
}

/** Creates (or tops up) bank.<factory>, the public guest bank, and records it in deployment.json. */
export async function setupGuestBank(factoryId: string, amount: bigint): Promise<void> {
  const d = readDeployment();
  if (!d || d.factoryId !== factoryId) throw new Error("deployment.json does not match the factory");
  const factory = accountFor(factoryId);
  const bankId = `bank.${factoryId}`;
  if (d.guestBank) {
    await retry("top up bank", () => factory.transfer({ receiverId: bankId, amount }));
    return;
  }
  const keyPair = KeyPair.fromRandom("ed25519");
  await retry("create bank", () => factory.createSubAccount("bank", keyPair.getPublicKey(), amount));
  d.guestBank = { accountId: bankId, secretKey: keyPair.toString() };
  writeFileSync(DEPLOYMENT_FILE, JSON.stringify(d, null, 2) + "\n");
}
