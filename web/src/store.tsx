import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  FACTORY_ID, GAS_BUDGET, call, createGuest, forgetGuest, getBalance, loadGuest, loadItems,
  newSessionKey, openWalletModal, getSelector, walletIdentity, errorText,
  type Identity, type ItemView, type Settlement,
} from "./near";

export type Toast = { id: number; kind: "ok" | "err" | "info"; text: string };
export type Page = "home" | "market" | "mine" | "arena" | "build";
const PAGES: Page[] = ["home", "market", "mine", "arena", "build"];
const pageFromHash = (): Page => {
  const h = window.location.hash.slice(1) as Page;
  return PAGES.includes(h) ? h : "home";
};

type Chain = {
  items: ItemView[];
  loading: boolean;
  me: Identity | null;
  balance: bigint | null;
  busy: string | null;
  toasts: Toast[];
  page: Page;
  arenaItem: string | null;
  /** Item whose detail panel is open in the armory. */
  openId: string | null;
  openItem: (id: string | null) => void;
  setPage: (p: Page) => void;
  playWith: (itemId: string) => void;
  refresh: () => Promise<void>;
  toast: (kind: Toast["kind"], text: string) => void;
  guestLogin: () => Promise<void>;
  walletLogin: () => Promise<void>;
  logout: () => Promise<void>;
  /** Runs a chain action with a busy label, error toast and refresh. */
  run: <T>(label: string, fn: (me: Identity) => Promise<T>) => Promise<T | undefined>;
  rent: (item: ItemView, secs: number) => Promise<boolean>;
  endRental: (item: ItemView) => Promise<Settlement | undefined>;
};

const Ctx = createContext<Chain>(null as unknown as Chain);
export const useChain = () => useContext(Ctx);

export function ChainProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ItemView[]>([]);
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<Identity | null>(() => loadGuest());
  const [balance, setBalance] = useState<bigint | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [page, setPageState] = useState<Page>(pageFromHash);
  const [openId, setOpenId] = useState<string | null>(null);
  const setPage = useCallback((p: Page) => {
    setPageState(p);
    if (window.location.hash.slice(1) !== p) window.history.pushState(null, "", `#${p}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  useEffect(() => {
    const onPop = () => setPageState(pageFromHash());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const openItem = useCallback(
    (id: string | null) => {
      setOpenId(id);
      if (id) setPage("market");
    },
    [setPage],
  );
  const [arenaItem, setArenaItem] = useState<string | null>(null);
  const meRef = useRef(me);
  meRef.current = me;

  const toast = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6500);
  }, []);

  const refresh = useCallback(async () => {
    if (document.hidden) return; // do not spend RPC quota in a background tab
    try {
      setItems(await loadItems());
      const who = meRef.current;
      if (who) setBalance(await getBalance(who.accountId));
    } catch (e) {
      console.warn("refresh failed", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [refresh]);

  // Restore a wallet session (for example after a MyNearWallet redirect).
  useEffect(() => {
    if (meRef.current) return;
    walletIdentity().then((w) => w && !meRef.current && setMe(w)).catch(() => {});
  }, []);

  useEffect(() => {
    setBalance(null);
    if (me) getBalance(me.accountId).then(setBalance).catch(() => {});
  }, [me]);

  const guestLogin = useCallback(async () => {
    setBusy("Creating your testnet account…");
    try {
      const guest = await createGuest();
      setMe(guest);
      toast("ok", `You are ${guest.accountId}, a free throwaway testnet account.`);
    } catch (e) {
      toast("err", errorText(e));
    } finally {
      setBusy(null);
    }
  }, [toast]);

  const walletLogin = useCallback(async () => {
    try {
      const selector = await getSelector();
      selector.subscribeOnAccountChange(() => {
        walletIdentity().then((w) => w && setMe(w)).catch(() => {});
      });
      await openWalletModal();
    } catch (e) {
      toast("err", errorText(e));
    }
  }, [toast]);

  const logout = useCallback(async () => {
    const who = meRef.current;
    if (who?.kind === "wallet") await who.wallet.signOut().catch(() => {});
    if (who?.kind === "guest") forgetGuest();
    setMe(null);
  }, []);

  const run = useCallback(
    async <T,>(label: string, fn: (me: Identity) => Promise<T>): Promise<T | undefined> => {
      const who = meRef.current;
      if (!who) {
        toast("info", "Pick “Play as guest” or connect a wallet first.");
        return undefined;
      }
      setBusy(label);
      try {
        const out = await fn(who);
        await refresh();
        return out;
      } catch (e) {
        toast("err", errorText(e));
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [refresh, toast],
  );

  const rent = useCallback(
    async (item: ItemView, secs: number) => {
      const ok = await run(`Renting ${item.name}…`, async (who) => {
        const sessionKey = newSessionKey(item.account_id);
        const cost = (BigInt(item.price_per_hour) * BigInt(secs)) / 3600n;
        await call(who, item.account_id, "rent", {
          public_key: sessionKey.getPublicKey().toString(),
          duration_secs: String(secs),
        }, cost + GAS_BUDGET);
        return true;
      });
      if (ok) {
        toast("ok", `${item.name} is yours for ${Math.round(secs / 60)} min. The NFT never left its owner.`);
        setArenaItem(item.account_id);
        setPage("arena");
      }
      return !!ok;
    },
    [run, toast],
  );

  const endRental = useCallback(
    async (item: ItemView) => {
      const s = await run(`Settling ${item.name}…`, (who) =>
        call<Settlement>(who, item.account_id, "end_rental"));
      if (s) toast("ok", `${item.name} settled: owner and creator paid, session key deleted.`);
      return s;
    },
    [run, toast],
  );

  const playWith = useCallback((itemId: string) => {
    setArenaItem(itemId);
    setPage("arena");
  }, []);

  const value = useMemo<Chain>(
    () => ({
      items, loading, me, balance, busy, toasts, page, arenaItem, openId, openItem, setPage, playWith, refresh, toast,
      guestLogin, walletLogin, logout, run, rent, endRental,
    }),
    [items, loading, me, balance, busy, toasts, page, arenaItem, openId, openItem, setPage, playWith, refresh, toast, guestLogin,
      walletLogin, logout, run, rent, endRental],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const hasDeployment = !!FACTORY_ID;
