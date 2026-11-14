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
  "https://rpc.testnet.fastnear.com",
];
export const FAUCET_URL = "https://helper.testnet.near.org/account";
export const EXPLORER = "https://testnet.nearblocks.io";
export const DEMO_COLLECTION: string = (deployment as any).demoCollection || "";
export const HOUSE_GAME: string = (deployment as any).houseGame || FACTORY_ID;
/** Slime Arena, the demo game: its own contract and its own registered LeaseKey game. */
export const ARENA_GAME: string = (deployment as any).arenaGame || "";
/** The games whose items Slime Arena honours: the launch collection, its partner, and its own rewards. */
export const ARENA_GAMES: string[] = [HOUSE_GAME, DEMO_COLLECTION, ARENA_GAME].filter(Boolean);
export const usableInArena = (i: { game: string | null }) => !!i.game && ARENA_GAMES.includes(i.game);

/** How many copies count for pricing and rarity: the game's fixed limit, or how many exist so far. */
export const copiesOf = (i: { max_supply: number | null; minted?: number | null }) => i.max_supply ?? i.minted ?? null;

/** Supply line for an item: "Edition 2 of 5 ever made", or "Copy #7 · 12 exist so far". */
export function supplyText(i: { edition: number | null; max_supply: number | null; minted?: number | null }, short = false): string | null {
  if (!i.edition) return null;
  if (i.max_supply) return `Edition ${i.edition} of ${i.max_supply}${short ? "" : " ever made"}`;
  return `Copy #${i.edition} · ${i.minted ?? i.edition} exist so far`;
}

/** Suggested rent per hour from how hard the item is to get: fewer copies and more power cost more. */
export function suggestedPrice(power: number, maxSupply: number | null): bigint {
  const scarcity = Math.sqrt(10 / Math.max(1, maxSupply ?? 10));
  const near = 0.02 * (power / 20) * scarcity;
  return BigInt(Math.round(Math.max(0.01, Math.min(near, 2)) * 1e6)) * 10n ** 18n;
}

export const NEAR = 10n ** 24n;
export const TGAS = 10n ** 12n;
/** Refundable budget that pays the gas of the renter's game actions. */
export const GAS_BUDGET = NEAR / 20n; // 0.05 NEAR = 100 attacks

const errText = (e: unknown) =>
  [(e as any)?.name, (e as any)?.type, (e as any)?.message, String((e as any)?.cause ?? ""), String(e)].join(" ");

/** True when a server could not be reached or refused for load, so the request never reached the chain. */
const isNetworkError = (e: unknown) =>
  /Failed to fetch|fetch failed|NetworkError|Load failed|RetriesExceeded|timed? ?out|ECONN|Rate limits? exceeded|\b429\b|Too Many Requests|Internal server error|\b50[0234]\b|Bad Gateway|Service Unavailable/i
    .test(errText(e));

export const provider = new providers.FailoverRpcProvider(
  RPC_URLS.map((url) => new providers.JsonRpcProvider({ url }, { retries: 2, backoff: 1.5, wait: 500 })),
);
// The stock failover treats every error as a dead server, so a real answer from the chain
// ("not enough balance", a contract panic) came back as "Exceeded N providers". Only network
// trouble moves on to the next server; anything the chain itself said is passed through as is.
(provider as any).withBackoff = async function (this: any, getResult: (p: unknown) => Promise<unknown>) {
  let last: unknown;
  for (let i = 0; i < this.providers.length; i++) {
    try {
      const result = await getResult(this.currentProvider);
      if (result !== undefined) return result;
    } catch (e) {
      if (!isNetworkError(e)) throw e;
      last = e;
    }
    this.switchToNextProvider();
  }
  throw last ?? new Error("No NEAR testnet server answered");
};

/** True when every server refused or was unreachable, so nothing reached the chain and a retry is safe. */
export const isRateLimited = (e: unknown) => /Exceeded \d+ providers|No NEAR testnet server answered/i.test(errText(e)) || isNetworkError(e);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Transactions in flight. Background refreshes wait while one is being sent. */
export let txInFlight = 0;

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
  /** From the factory: the game that made the item, or the collection it wraps. */
  game: string | null;
  game_name: string | null;
  origin: { contract: string; token_id: string } | null;
  verified: boolean;
  item_type: string | null;
  edition: number | null;
  max_supply: number | null;
  /** How many copies of this type exist so far. Each copy is its own token and account with its own owner. */
  minted: number | null;
  stats: Stat[];
};

export type Stat = { name: string; value: number };

/** A stat by name, or a fallback (e.g. power for attack) when the game did not set it. */
export const statOf = (i: { stats: Stat[] }, name: string, fallback = 0) =>
  i.stats.find((s) => s.name === name)?.value ?? fallback;

export type ItemRef = {
  token_id: string;
  item_account: string;
  owner: string;
  game: string | null;
  game_name: string | null;
  origin: { contract: string; token_id: string } | null;
  verified: boolean;
  item_type: string | null;
  edition: number | null;
  max_supply: number | null;
  /** How many copies of this type exist so far. Each copy is its own token and account with its own owner. */
  minted: number | null;
  stats: Stat[];
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

/**
 * Public RPCs drop bursts of parallel requests from one browser ("Failed to fetch", then
 * "Exceeded N providers"). Reads queue here so at most a few are in flight at a time.
 */
const MAX_READS = 4;
let readsInFlight = 0;
const readQueue: (() => void)[] = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (readsInFlight >= MAX_READS) await new Promise<void>((r) => readQueue.push(r));
  readsInFlight += 1;
  try {
    return await fn();
  } finally {
    readsInFlight -= 1;
    readQueue.shift()?.();
  }
}

/**
 * A server can fail while waiting for a result even though the transaction already ran.
 * Before reporting such an error, ask the chain a few times whether the action took effect.
 */
export async function landed(check: () => Promise<boolean>, tries = 5): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    await sleep(1500);
    try {
      if (await check()) return true;
    } catch {
      // the read failed too; try again
    }
  }
  return false;
}

export async function view<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  // A read changes nothing, so when every public server is busy it is always safe to ask again.
  for (let attempt = 0; ; attempt++) {
    try {
      return (await limited(() => provider.callFunction(contractId, method, args))) as T;
    } catch (e) {
      if (attempt >= 3 || !isRateLimited(e)) throw e;
      await sleep(800 * (attempt + 1));
    }
  }
}

/** Local clock minus chain clock, so countdowns follow block time. */
let clockOffset = 0;
export const chainNow = () => Date.now() + clockOffset;

export async function loadItems(): Promise<ItemView[]> {
  if (!FACTORY_ID) return [];
  const refs = await view<ItemRef[]>(FACTORY_ID, "get_items", { limit: 100 });
  const items = await Promise.all(
    refs.map(async (r) => ({
      ...(await view<Omit<ItemView, "game" | "game_name" | "origin" | "verified" | "item_type" | "edition" | "max_supply" | "minted" | "stats">>(r.item_account, "get_item")),
      game: r.game,
      game_name: r.game_name,
      origin: r.origin,
      verified: r.verified,
      item_type: r.item_type,
      edition: r.edition,
      max_supply: r.max_supply,
      minted: r.minted ?? null,
      stats: r.stats ?? [],
    })),
  );
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
  if (/^Not enough NEAR/.test(anyE?.message ?? "")) return anyE.message;
  if (/does not have enough balance|NotEnoughBalance|LackBalanceForState/i.test(raw))
    return "Not enough NEAR in this account for that. Nothing was charged. Pick a shorter time or add testnet NEAR.";
  if (isRateLimited(e) || /Exceeded \d+ providers/i.test(raw))
    return "The NEAR testnet servers are busy right now. Nothing was charged. Try again in a few seconds.";
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
  const name = `lk-guest-${Math.random().toString(36).slice(2, 8)}`;
  let accountId = `${name}.testnet`;
  const keyPair = KeyPair.fromRandom("ed25519");
  const res = await fetch(FAUCET_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: keyPair.getPublicKey().toString() }),
  }).catch(() => null);
  if (!res?.ok) {
    // Faucet is rate limited: the deployment's public guest bank funds the account instead.
    const bank = (deployment as any).guestBank as { accountId: string; secretKey: string } | undefined;
    if (!bank) throw new Error(`testnet faucet refused: ${res?.status ?? "network error"}`);
    accountId = `${name}.${bank.accountId}`;
    const banker = new Account(bank.accountId, provider, KeyPairSigner.fromSecretKey(bank.secretKey as any));
    await banker.createSubAccount(name, keyPair.getPublicKey(), NEAR / 2n);
  }
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
  return BigInt((await limited(() => provider.viewAccount(accountId))).amount);
}

/**
 * The chain reserves gas up front at a pessimistic price (about 0.1 NEAR for 100 TGas on testnet)
 * and refunds what is unused, so the balance must cover that reserve on top of the deposit.
 */
const PREPAID_PER_GAS = 10n ** 9n; // yoctoNEAR
const STORAGE_ROOM = NEAR / 100n; // 0.01 NEAR

/**
 * Checks the caller can pay `deposit` plus fees before anything is sent.
 * Guests were funded by the guest bank (0.5 NEAR), so the same bank refills them when a lease would not fit.
 * Wallet users get a plain message instead of a raw chain error.
 */
export async function ensureFunds(who: Identity, deposit: bigint, gas: bigint): Promise<void> {
  const need = deposit + gas * PREPAID_PER_GAS + STORAGE_ROOM;
  const have = await getBalance(who.accountId).catch(() => null);
  if (have === null || have >= need) return;
  const bank = (deployment as any).guestBank as { accountId: string; secretKey: string } | undefined;
  if (who.kind === "guest" && bank) {
    const banker = new Account(bank.accountId, provider, KeyPairSigner.fromSecretKey(bank.secretKey as any));
    await banker.transfer({ receiverId: who.accountId, amount: need - have + NEAR / 2n });
    return;
  }
  throw new Error(
    `Not enough NEAR: this needs about ${fmtNear(need, 3)} NEAR and the account has ${fmtNear(have, 3)}. ` +
      "Pick a shorter time or add testnet NEAR from the faucet.",
  );
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
  if (deposit > 0n) await ensureFunds(who, deposit, gas);
  if (who.kind === "guest") {
    txInFlight += 1;
    try {
      // A rate-limited request never reached the chain, so it is safe to try again after a pause.
      for (let attempt = 0; ; attempt++) {
        try {
          const outcome = await who.account.callFunctionRaw({
            contractId, methodName, args, deposit, gas, waitUntil: "EXECUTED_OPTIMISTIC",
          });
          return parseOutcome<T>(outcome);
        } catch (e) {
          // Only an explicit rate-limit refusal is retried: the transaction never ran. After any other
          // server error it may already be on chain, and a new attempt could run the action twice.
          if (attempt >= 3 || !/Rate limits? exceeded|\b429\b|Too Many Requests/i.test(errText(e))) throw e;
          await sleep(1500 * (attempt + 1));
        }
      }
    } finally {
      txInFlight -= 1;
    }
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

/**
 * A link that moves this lease's play key to another device. The key travels in the URL fragment,
 * which browsers never send to any server, and it can only call use_item on this one item until the
 * lease ends, so the worst a leaked link can do is play the rest of this lease.
 */
export function playLink(item: ItemView): string | null {
  const saved = localStorage.getItem(sessionStorageKey(item.account_id));
  if (!saved) return null;
  return `${location.origin}${location.pathname}#play=${encodeURIComponent(item.account_id)}&key=${encodeURIComponent(saved)}`;
}

/** Reads a play link once: stores its key for that item and cleans the address bar. Returns the item. */
export function importPlayLink(): string | null {
  const h = new URLSearchParams(location.hash.slice(1));
  const id = h.get("play");
  const key = h.get("key");
  if (!id || !key) return null;
  try {
    KeyPair.fromString(key as any);
    localStorage.setItem(sessionStorageKey(id), key);
  } catch {
    return null;
  }
  history.replaceState(null, "", `${location.pathname}#arena`);
  return id;
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
  async send<T>(methodName: string, args: Record<string, unknown>, receiverId = this.itemId, deposit = 0n, attempt = 0): Promise<{ value: T; hash: string }> {
    if (!this.blockHash || Date.now() - this.blockAt > 60_000) await this.sync();
    this.nonce += 1n;
    const tx = createTransaction(
      this.itemId,
      this.keyPair.getPublicKey(),
      receiverId,
      this.nonce,
      [actionCreators.functionCall(methodName, args, 5n * TGAS, deposit)],
      this.blockHash!,
    );
    const [, signed] = await this.signer.signTransaction(tx);
    try {
      const outcome = await provider.sendTransactionUntil(signed, "EXECUTED_OPTIMISTIC");
      return { value: parseOutcome<T>(outcome), hash: outcome.transaction.hash as string };
    } catch (e) {
      this.blockHash = null; // resync nonce and block hash before the next send
      // Rapid strikes can reach the network out of order. Resync and try that strike again.
      if (attempt < 2 && isRateLimited(e)) {
        await sleep(1000 * (attempt + 1));
        return this.send<T>(methodName, args, receiverId, deposit, attempt + 1);
      }
      if (attempt < 2 && /nonce/i.test(String((e as any)?.type) + String((e as any)?.message))) {
        return this.send<T>(methodName, args, receiverId, deposit, attempt + 1);
      }
      throw e;
    }
  }

  useItem(action: string) {
    return this.send<UseResult>("use_item", { action });
  }
}
