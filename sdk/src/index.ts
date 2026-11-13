/**
 * @leasekey/sdk: drop LeaseKey rentals into any NEAR game.
 *
 * A game needs three things:
 *   1. Ask whether a player may use an item right now      -> `canUse`
 *   2. Rent an item for a player with a fresh session key   -> `rent` / `rentAction`
 *   3. Send each in-game action, no wallet pop-up           -> `session.use(action)`
 *
 * Everything else (expiry, payment, the owner and creator split) is enforced by
 * the item's own account on chain.
 */
import { Account, KeyPair, KeyPairSigner, providers } from "near-api-js";
import { actionCreators, createTransaction } from "@near-js/transactions";
import { baseDecode } from "@near-js/utils";
import type { FinalExecutionOutcome } from "@near-js/types";
import type { Provider } from "@near-js/providers";

export const NEAR = 10n ** 24n;
export const TGAS = 10n ** 12n;
/** Default refundable budget that pays the gas of the renter's actions (about 100 uses). */
export const DEFAULT_GAS_BUDGET = NEAR / 20n;

export const TESTNET_RPC = "https://test.rpc.fastnear.com";

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

export type UseResult = { action: string; power: number; uses: number; uses_left: number; durability: number; ends_at: string };
export type Settlement = { renter: string; rent_earned: string; owner_cut: string; creator_cut: string; renter_refund: string; early: boolean };

/** A LeaseKey event decoded from transaction logs (`EVENT_JSON:{...}`). */
export type LeaseKeyEvent = {
  event: "item_listed" | "item_unlisted" | "item_rented" | "item_used" | "rental_extended" | "rental_settled" | "item_repaired";
  data: Record<string, unknown> & { token_id: string };
};

export type ItemRef = {
  token_id: string;
  item_account: string;
  owner: string;
  game: string | null;
  game_name: string | null;
  origin: { contract: string; token_id: string } | null;
};

/** A plain function-call description any wallet (Wallet Selector, HOT, Meteor…) can sign. */
export type CallSpec = { receiverId: string; methodName: string; args: Record<string, unknown>; deposit: bigint; gas: bigint };

export type LeaseKeyOptions = {
  /** The LeaseKey factory, e.g. `leasekey-lq3d9s.testnet`. */
  factoryId: string;
  rpcUrl?: string;
  provider?: Provider;
};

export class LeaseKey {
  readonly factoryId: string;
  readonly provider: Provider;

  constructor(opts: LeaseKeyOptions) {
    this.factoryId = opts.factoryId;
    this.provider =
      opts.provider ?? new providers.JsonRpcProvider({ url: opts.rpcUrl ?? TESTNET_RPC }, { retries: 5, backoff: 1.7, wait: 700 });
  }

  // ------------------------------------------------------------------ read

  async view<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
    return (await this.provider.callFunction(contractId, method, args)) as T;
  }

  /** The item account of a token, e.g. `flame-sword-1.<factory>`. */
  itemAccount(tokenId: string): string {
    return `${tokenId}.${this.factoryId}`;
  }

  /** Every item, with its live rental state. */
  async listItems(limit = 100): Promise<ItemView[]> {
    const refs = await this.view<{ item_account: string }[]>(this.factoryId, "get_items", { limit });
    return Promise.all(refs.map((r) => this.getItem(r.item_account)));
  }

  getItem(itemId: string): Promise<ItemView> {
    return this.view<ItemView>(itemId, "get_item");
  }

  /** Items currently listed and free to rent. */
  async available(): Promise<ItemView[]> {
    return (await this.listItems()).filter((i) => i.listed && !i.renter && i.durability > 0);
  }

  /** Items a player owns. */
  async ownedBy(accountId: string): Promise<ItemView[]> {
    return (await this.listItems()).filter((i) => i.owner === accountId);
  }

  /** The factory record of an item: owner, game and, for wrapped NFTs, the original. */
  getItemRef(itemId: string): Promise<ItemRef | null> {
    return this.view<ItemRef | null>(this.factoryId, "get_item_ref", { token_id: itemId.split(".")[0] });
  }

  /** The LeaseKey item wrapping an NFT from another collection, if any. */
  findWrapped(originContract: string, originTokenId: string): Promise<ItemRef | null> {
    return this.view<ItemRef | null>(this.factoryId, "find_wrapped", { origin_contract: originContract, origin_token_id: originTokenId });
  }

  /**
   * The check a game makes before honouring an item: does this player hold a
   * live lease, or own the item while it is not leased out? Pass `games` to
   * accept only items made by (or wrapped from) those games; by default a
   * game should pass its own account.
   */
  async canUse(
    itemId: string,
    accountId: string,
    opts: { games?: string[] } = {},
  ): Promise<{ ok: boolean; as: "owner" | "renter" | null; endsAt: number | null; power: number; game: string | null; reason?: string }> {
    const [i, ref] = await Promise.all([this.getItem(itemId), this.getItemRef(itemId)]);
    const game = ref?.game ?? null;
    const base = { power: i.power, game };
    if (opts.games && (!game || !opts.games.includes(game))) {
      return { ok: false, as: null, endsAt: null, ...base, reason: "item belongs to another game" };
    }
    if (i.renter === accountId && i.rental_active) return { ok: true, as: "renter", endsAt: Number(i.ends_at), ...base };
    if (i.owner === accountId && !i.renter) return { ok: true, as: "owner", endsAt: null, ...base };
    return { ok: false, as: null, endsAt: null, ...base, reason: i.renter ? "leased to someone else" : "not leased to this player" };
  }

  // ------------------------------------------------------------- wrapping

  /** Two calls that wrap an NFT the player owns into a rentable LeaseKey item. Sign them in order. */
  async wrapActions(originContract: string, originTokenId: string, listing: { name: string; pricePerHour: bigint; image?: string; power?: number; royaltyBps?: number }): Promise<[CallSpec, CallSpec]> {
    const deposit = BigInt(await this.view<string>(this.factoryId, "mint_deposit"));
    return [
      { receiverId: this.factoryId, methodName: "deposit_for_wrap", args: {}, deposit, gas: 10n * TGAS },
      {
        receiverId: originContract,
        methodName: "nft_transfer_call",
        args: {
          receiver_id: this.factoryId,
          token_id: originTokenId,
          msg: JSON.stringify({
            name: listing.name, image: listing.image, power: listing.power,
            price_per_hour: listing.pricePerHour.toString(), royalty_bps: listing.royaltyBps,
          }),
        },
        deposit: 1n,
        gas: 150n * TGAS,
      },
    ];
  }

  /** Gives the original NFT back. Fails while the item is on lease. */
  unwrapAction(itemId: string): CallSpec {
    return { receiverId: this.factoryId, methodName: "unwrap", args: { token_id: itemId.split(".")[0] }, deposit: 1n, gas: 150n * TGAS };
  }

  /** Rent (in yoctoNEAR) for `secs` seconds, excluding the refundable gas budget. */
  async quote(itemId: string, secs: number): Promise<bigint> {
    return BigInt(await this.view<string>(itemId, "quote", { duration_secs: String(secs) }));
  }

  // ----------------------------------------------------------------- write

  /**
   * Describes the `rent` call so any wallet can sign it. Generate the session
   * key first with `LeaseSession.generate()` and keep its secret on the device.
   */
  async rentAction(itemId: string, sessionPublicKey: string, secs: number, gasBudget = DEFAULT_GAS_BUDGET): Promise<CallSpec> {
    const cost = await this.quote(itemId, secs);
    return {
      receiverId: itemId,
      methodName: "rent",
      args: { public_key: sessionPublicKey, duration_secs: String(secs) },
      deposit: cost + gasBudget,
      gas: 100n * TGAS,
    };
  }

  /** Rents with a near-api-js Account (server, script or custodial flow) and returns a ready session. */
  async rent(renter: Account, itemId: string, secs: number, gasBudget = DEFAULT_GAS_BUDGET): Promise<LeaseSession> {
    const key = LeaseSession.generate();
    const spec = await this.rentAction(itemId, key.getPublicKey().toString(), secs, gasBudget);
    const outcome = await renter.callFunctionRaw({ ...spec, contractId: spec.receiverId, waitUntil: "FINAL" });
    const rental = parseOutcome<unknown>(outcome);
    if (!rental) throw new Error("rent failed: the session key could not be added, deposit refunded");
    return new LeaseSession(this, itemId, key);
  }

  /** Re-opens a session from a stored secret key. */
  session(itemId: string, secretKey: string): LeaseSession {
    return new LeaseSession(this, itemId, KeyPair.fromString(secretKey as any));
  }

  /** Ends an expired lease. Anyone may call it; it pays owner and creator and deletes the key. */
  async endRental(caller: Account, itemId: string): Promise<Settlement> {
    return parseOutcome<Settlement>(await caller.callFunctionRaw({ contractId: itemId, methodName: "end_rental", args: {}, gas: 100n * TGAS, waitUntil: "FINAL" }));
  }

  /** The renter returns early and is refunded the unused time (5% fee). */
  async returnEarly(renter: Account, itemId: string): Promise<Settlement> {
    return parseOutcome<Settlement>(await renter.callFunctionRaw({ contractId: itemId, methodName: "return_early", args: {}, gas: 100n * TGAS, waitUntil: "FINAL" }));
  }

  /**
   * A registered game mints an item to a player (`owner`, default the game itself).
   * The game is the creator and earns the royalty. Listing is done by the owner.
   */
  async mintAndList(
    game: Account,
    item: { name: string; image: string; power: number; pricePerHour: bigint; maxSecs?: number; royaltyBps?: number; owner?: string },
  ): Promise<{ token_id: string; item_account: string }> {
    const deposit = BigInt(await this.view<string>(this.factoryId, "mint_deposit"));
    const minted = parseOutcome<{ token_id: string; item_account: string } | null>(
      await game.callFunctionRaw({
        contractId: this.factoryId,
        methodName: "mint",
        args: { args: {
          name: item.name, image: item.image, power: item.power, price_per_hour: item.pricePerHour.toString(),
          max_secs: String(item.maxSecs ?? 7200), royalty_bps: item.royaltyBps ?? 1000, owner: item.owner ?? null,
        } },
        deposit,
        gas: 150n * TGAS,
        waitUntil: "FINAL",
      }),
    );
    if (!minted) throw new Error("mint failed, deposit refunded");
    if (!item.owner || item.owner === game.accountId) {
      await game.callFunctionRaw({ contractId: minted.item_account, methodName: "list", args: {}, waitUntil: "FINAL" });
    }
    return minted;
  }
}

/**
 * A renter's session: signs `use_item` AS the item account with the renter's
 * function-call key. No wallet, no pop-up, and the item pays the gas. The key
 * can do nothing else: the protocol rejects any other method or contract.
 */
export class LeaseSession {
  private signer: KeyPairSigner;
  private nonce = 0n;
  private blockHash: Uint8Array | null = null;
  private blockAt = 0;
  private syncing: Promise<void> | null = null;

  static generate(): KeyPair {
    return KeyPair.fromRandom("ed25519");
  }

  constructor(readonly client: LeaseKey, readonly itemId: string, readonly keyPair: KeyPair) {
    this.signer = new KeyPairSigner(keyPair);
  }

  /** Store this on the player's device to resume the session later. */
  get secretKey(): string {
    return this.keyPair.toString();
  }

  get publicKey(): string {
    return this.keyPair.getPublicKey().toString();
  }

  private sync(): Promise<void> {
    this.syncing ??= (async () => {
      try {
        const [key, block] = await Promise.all([
          this.client.provider.viewAccessKey(this.itemId, this.keyPair.getPublicKey()),
          this.client.provider.viewBlock({ finality: "final" }),
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

  /** Performs one in-game action on chain. `action` is any label up to 32 bytes, e.g. "slash". */
  async use(action: string): Promise<UseResult & { txHash: string; events: LeaseKeyEvent[] }> {
    if (!this.blockHash || Date.now() - this.blockAt > 60_000) await this.sync();
    this.nonce += 1n;
    const tx = createTransaction(
      this.itemId,
      this.keyPair.getPublicKey(),
      this.itemId,
      this.nonce,
      [actionCreators.functionCall("use_item", { action }, 10n * TGAS, 0n)],
      this.blockHash!,
    );
    const [, signed] = await this.signer.signTransaction(tx);
    try {
      const outcome = await this.client.provider.sendTransactionUntil(signed, "EXECUTED_OPTIMISTIC");
      return { ...parseOutcome<UseResult>(outcome), txHash: outcome.transaction.hash, events: eventsOf(outcome) };
    } catch (e) {
      this.blockHash = null;
      throw e;
    }
  }

  /** Whether the lease behind this session is still live. */
  async active(): Promise<boolean> {
    const i = await this.client.getItem(this.itemId);
    return i.rental_active && i.renter_pk === this.publicKey;
  }
}

// ------------------------------------------------------------------ helpers

/** Decodes LeaseKey events from any transaction outcome. */
export function eventsOf(outcome: FinalExecutionOutcome): LeaseKeyEvent[] {
  return parseEventLogs(outcome.receipts_outcome.flatMap((r) => r.outcome.logs));
}

export function parseEventLogs(logs: string[]): LeaseKeyEvent[] {
  const out: LeaseKeyEvent[] = [];
  for (const log of logs) {
    if (!log.startsWith("EVENT_JSON:")) continue;
    try {
      const e = JSON.parse(log.slice("EVENT_JSON:".length));
      if (e.standard === "leasekey") out.push({ event: e.event, data: e.data });
    } catch {
      /* not ours */
    }
  }
  return out;
}

export function parseOutcome<T>(outcome: FinalExecutionOutcome): T {
  const all = [outcome.transaction_outcome, ...outcome.receipts_outcome];
  const failure = (outcome.status as any)?.Failure ?? all.map((o) => (o.outcome.status as any)?.Failure).find(Boolean);
  if (failure) {
    const text = JSON.stringify(failure);
    throw new Error(text.match(/Smart contract panicked: ([^"\\]+)/)?.[1] ?? text.slice(0, 200));
  }
  const value = (outcome.status as any)?.SuccessValue;
  if (!value) return undefined as T;
  try {
    return JSON.parse(typeof atob === "function" ? atob(value) : Buffer.from(value, "base64").toString()) as T;
  } catch {
    return undefined as T;
  }
}

export function formatNear(yocto: bigint | string, digits = 4): string {
  const v = BigInt(yocto);
  const scale = 10n ** BigInt(digits);
  const scaled = (v * scale) / NEAR;
  return `${scaled / scale}.${(scaled % scale).toString().padStart(digits, "0")}`;
}
