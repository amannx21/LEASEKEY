// Chain layer: views, the two kinds of identity (guest account or wallet),
// and the in-browser session key that plays the game without pop-ups.
import { Account, KeyPair, KeyPairSigner, providers } from "near-api-js";
import { actionCreators, createTransaction } from "@near-js/transactions";
import { baseDecode } from "@near-js/utils";
import type { FinalExecutionOutcome } from "@near-js/types";
import type { Wallet, WalletSelector } from "@near-wallet-selector/core";
import deployment from "./deployment.json";

const env = import.meta.env;
export const FACTORY_ID: string = env.VITE_FACTORY_ID || (deployment as any).factoryId || "";
// Public testnet RPCs are rate limited, so calls fail over between several.
export const RPC_URLS: string[] = [
  ...(env.VITE_RPC_URL ? [env.VITE_RPC_URL as string] : []),
  "https://test.rpc.fastnear.com",
  "https://near-testnet.drpc.org",
];
export const FAUCET_URL = "https://helper.testnet.near.org/account";
export const EXPLORER = "https://testnet.nearblocks.io";

export const NEAR = 10n ** 24n;
export const TGAS = 10n ** 12n;
/** Refundable budget that pays the gas of the renter's game actions. */
export const GAS_BUDGET = NEAR / 20n; // 0.05 NEAR = 100 attacks

export const provider = new providers.FailoverRpcProvider(
  RPC_URLS.map((url) => new providers.JsonRpcProvider({ url }, { retries: 4, backoff: 1.7, wait: 700 })),
);

export type ItemView = {
  token_id: string;
  account_id: string;
  factory: string;
  owner: string;
  creator: string;
  royalty_bps: number;
  name: string;
  image: string;
  power: number;
  price_per_hour: string;
  max_secs: string;
  listed: boolean;
  durability: number;
  max_durability: number;
  renter: string | null;
  renter_pk: string | null;
  starts_at: string | null;
  ends_at: string | null;
  rent_paid: string | null;
  uses: number;
  uses_left: number;
  rental_active: boolean;
  lifetime_earnings: string;
  owner_earnings: string;
  creator_earnings: string;
  rental_count: number;
  total_uses: number;
  now_ms: string;
};

export type Settlement = {
  renter: string;
  rent_earned: string;
  owner_cut: string;
  creator_cut: string;
  renter_refund: string;
  early: boolean;
};

export function fmtNear(yocto: string | bigint | null | undefined, digits = 3): string {
  const v = BigInt(yocto ?? 0);
  const scale = 10n ** BigInt(digits);
  const scaled = (v * scale + NEAR / 2n) / NEAR;
  const frac = (scaled % scale).toString().padStart(digits, "0").replace(/0+$/, "");
  return `${scaled / scale}${frac ? "." + frac : ""}`;
}

export function parseNear(s: string): bigint {
  const [whole, frac = ""] = s.trim().split(".");
  return BigInt(whole || "0") * NEAR + BigInt((frac + "0".repeat(24)).slice(0, 24));
}

export const short = (id: string) => (id.length > 26 ? `${id.slice(0, 12)}…${id.slice(-10)}` : id);

export async function view<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  return (await provider.callFunction(contractId, method, args)) as T;
}

/** Local clock minus chain clock, so countdowns follow block time. */
let clockOffset = 0;
export const chainNow = () => Date.now() + clockOffset;

export async function loadItems(): Promise<ItemView[]> {
  if (!FACTORY_ID) return [];
  const refs = await view<{ item_account: string }[]>(FACTORY_ID, "get_items", { limit: 100 });
  const items = await Promise.all(refs.map((r) => view<ItemView>(r.item_account, "get_item")));
  if (items.length) clockOffset = Number(items[0].now_ms) - Date.now();
  return items.sort((a, b) => a.token_id.localeCompare(b.token_id));
}

// ---------------------------------------------------------------- outcomes

function failureMessage(outcome: FinalExecutionOutcome): string | null {
  const all = [outcome.transaction_outcome, ...outcome.receipts_outcome];
  const top = (outcome.status as any)?.Failure;
  const failure = top ?? all.map((o) => (o.outcome.status as any)?.Failure).find(Boolean);
  if (!failure) return null;
  const text = JSON.stringify(failure);
  const panic = text.match(/Smart contract panicked: ([^"\\]+)/);
  return panic ? panic[1] : text.slice(0, 200);
}

export function parseOutcome<T>(outcome: FinalExecutionOutcome): T {
  const failed = failureMessage(outcome);
  if (failed) throw new Error(failed);
  const value = (outcome.status as any)?.SuccessValue;
  if (!value) return undefined as T;
  try {
    return JSON.parse(atob(value)) as T;
  } catch {
    return undefined as T;
  }
}

export function errorText(e: unknown): string {
  const anyE = e as any;
  const raw = [
    typeof e === "string" ? e : "",
    anyE?.message,
    anyE?.type,
    anyE?.name,
    (() => {
      try {
        return JSON.stringify(e, Object.getOwnPropertyNames(anyE ?? {}));
      } catch {
        return "";
      }
    })(),
  ].filter(Boolean).join(" ");
  const panic = raw.match(/Smart contract panicked: ([^"\\]+)/);
  if (panic) return panic[1];
  if (/MethodNameMismatch|isn.t allowed by the access key/i.test(raw))
    return "this access key may only call use_item";
  if (/ReceiverMismatch|InvalidAccessKey|receiver/i.test(raw))
    return "this access key may only call its own item account, never the NFT contract";
  if (/DepositWithFunctionCall/i.test(raw))
    return "function-call keys cannot attach or move any NEAR, so a transfer is impossible";
  if (/AccessKeyDoesNotExist|AccessKeyNotFound|does not exist/i.test(raw))
    return "the session key no longer exists on chain";
  return (anyE?.message || raw || "unknown error").slice(0, 220);
}

// ---------------------------------------------------------------- identity

export type Identity =
  | { kind: "guest"; accountId: string; account: Account }
  | { kind: "wallet"; accountId: string; wallet: Wallet };

const GUEST_KEY = "leasekey:guest";

export function loadGuest(): Identity | null {
  try {
    const saved = JSON.parse(localStorage.getItem(GUEST_KEY) || "null");
    if (!saved) return null;
    const signer = KeyPairSigner.fromSecretKey(saved.secretKey);
    return { kind: "guest", accountId: saved.accountId, account: new Account(saved.accountId, provider, signer) };
  } catch {
    return null;
  }
}

/** One click: a throwaway testnet account funded by the public faucet. No wallet, no seed phrase. */
export async function createGuest(): Promise<Identity> {
  const accountId = `lk-guest-${Math.random().toString(36).slice(2, 8)}.testnet`;
  const keyPair = KeyPair.fromRandom("ed25519");
  const res = await fetch(FAUCET_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: keyPair.getPublicKey().toString() }),
  });
  if (!res.ok) throw new Error(`testnet faucet refused: ${res.status} ${(await res.text()).slice(0, 120)}`);
  for (let i = 0; i < 20; i++) {
    try {
      await provider.viewAccount(accountId);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  localStorage.setItem(GUEST_KEY, JSON.stringify({ accountId, secretKey: keyPair.toString() }));
  return loadGuest()!;
}

export function forgetGuest() {
  localStorage.removeItem(GUEST_KEY);
}

let selectorPromise: Promise<WalletSelector> | null = null;
export function getSelector(): Promise<WalletSelector> {
  selectorPromise ??= (async () => {
    const [{ setupWalletSelector }, { setupMyNearWallet }, { setupMeteorWallet }] = await Promise.all([
      import("@near-wallet-selector/core"),
      import("@near-wallet-selector/my-near-wallet"),
      import("@near-wallet-selector/meteor-wallet"),
    ]);
    return setupWalletSelector({
      network: "testnet",
      modules: [setupMyNearWallet(), setupMeteorWallet()] as any,
    });
  })();
  return selectorPromise;
}

export async function walletIdentity(): Promise<Identity | null> {
  const selector = await getSelector();
  if (!selector.isSignedIn()) return null;
  const wallet = await selector.wallet();
  const accounts = await wallet.getAccounts();
  return accounts[0] ? { kind: "wallet", accountId: accounts[0].accountId, wallet } : null;
}

export async function openWalletModal() {
  const selector = await getSelector();
  const { setupModal } = await import("@near-wallet-selector/modal-ui");
  setupModal(selector, { theme: "dark", description: "Connect a NEAR testnet wallet to own and rent items." }).show();
}

export async function getBalance(accountId: string): Promise<bigint> {
  return BigInt((await provider.viewAccount(accountId)).amount);
}

/** Sends one function call as the connected identity and returns the parsed result. */
export async function call<T = unknown>(
  who: Identity,
  contractId: string,
  methodName: string,
  args: Record<string, unknown> = {},
  deposit = 0n,
  gas = 100n * TGAS,
): Promise<T> {
  if (who.kind === "guest") {
    const outcome = await who.account.callFunctionRaw({
      contractId, methodName, args, deposit, gas, waitUntil: "EXECUTED_OPTIMISTIC",
    });
    return parseOutcome<T>(outcome);
  }
  const outcome = await who.wallet.signAndSendTransaction({
    receiverId: contractId,
    actions: [actionCreators.functionCall(methodName, args, gas, deposit)] as any,
  });
  return outcome ? parseOutcome<T>(outcome as FinalExecutionOutcome) : (undefined as T);
}

// -------------------------------------------------------------- session key

const sessionStorageKey = (itemId: string) => `leasekey:session:${itemId}`;

export function newSessionKey(itemId: string): KeyPair {
  const keyPair = KeyPair.fromRandom("ed25519");
  // Saved before the rent transaction so a wallet redirect cannot lose it.
  localStorage.setItem(sessionStorageKey(itemId), keyPair.toString());
  return keyPair;
}

/** The stored session key, but only if the chain says it is this item's current renter key. */
export function sessionKeyFor(item: ItemView): KeyPair | null {
  const saved = localStorage.getItem(sessionStorageKey(item.account_id));
  if (!saved || !item.renter_pk) return null;
  try {
    const keyPair = KeyPair.fromString(saved as any);
    return keyPair.getPublicKey().toString() === item.renter_pk ? keyPair : null;
  } catch {
    return null;
  }
}

export type UseResult = { action: string; power: number; uses: number; uses_left: number; durability: number };

/**
 * Signs transactions AS THE ITEM ACCOUNT with the renter's function-call key.
 * Keeps a local nonce so rapid attacks can be in flight at the same time, and
 * never opens a wallet.
 */
export class Session {
  private signer: KeyPairSigner;
  private nonce = 0n;
  private blockHash: Uint8Array | null = null;
  private blockAt = 0;
  private syncing: Promise<void> | null = null;

  constructor(readonly itemId: string, readonly keyPair: KeyPair) {
    this.signer = new KeyPairSigner(keyPair);
  }

  private sync(): Promise<void> {
    this.syncing ??= (async () => {
      try {
        const publicKey = this.keyPair.getPublicKey().toString();
        const [key, block] = await Promise.all([
          provider.viewAccessKey(this.itemId, this.keyPair.getPublicKey()),
          provider.viewBlock({ finality: "final" }),
        ]);
        this.nonce = BigInt(key.nonce);
        this.blockHash = baseDecode(block.header.hash);
        this.blockAt = Date.now();
      } finally {
        this.syncing = null;
      }
    })();
    return this.syncing;
  }

  /** Sends any call with the session key. Only `use_item` on the item can succeed. */
  async send<T>(methodName: string, args: Record<string, unknown>, receiverId = this.itemId, deposit = 0n) {
    if (!this.blockHash || Date.now() - this.blockAt > 60_000) await this.sync();
    this.nonce += 1n;
    const tx = createTransaction(
      this.itemId,
      this.keyPair.getPublicKey(),
      receiverId,
      this.nonce,
      [actionCreators.functionCall(methodName, args, 10n * TGAS, deposit)],
      this.blockHash!,
    );
    const [, signed] = await this.signer.signTransaction(tx);
    try {
      const outcome = await provider.sendTransactionUntil(signed, "EXECUTED_OPTIMISTIC");
      return { value: parseOutcome<T>(outcome), hash: outcome.transaction.hash as string };
    } catch (e) {
      this.blockHash = null; // resync nonce and block hash before the next send
      throw e;
    }
  }

  useItem(action: string) {
    return this.send<UseResult>("use_item", { action });
  }
}
