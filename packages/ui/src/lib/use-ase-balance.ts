"use client";

import { useCallback, useEffect, useState } from "react";

import { apiWallet } from "@/lib/ase-api";
import { useLiveChain } from "@/components/live/live-chain";

// One shared native-balance read per address across every component using
// this hook (header, dex, token page…), routed through the rate-aware RPC
// gate. A failed read keeps the last good value instead of blanking it.
// Balances persist to localStorage so a reload paints the wallet instantly.
type Entry = { v: string | null; at: number; p?: Promise<string | null> };
const cache = new Map<string, Entry>();
const balKey = (k: string) => `asepad:bal:${k}`;
const stored = (k: string): Entry | undefined => {
  try {
    const e = JSON.parse(localStorage.getItem(balKey(k)) || "null") as Entry | null;
    return e?.v != null ? e : undefined;
  } catch { return undefined; }
};
const store = (k: string, e: Entry) => {
  try { localStorage.setItem(balKey(k), JSON.stringify({ v: e.v, at: e.at })); } catch { }
};

function read(address: string, maxAgeMs: number): Promise<string | null> {
  const k = address.toLowerCase();
  let e = cache.get(k);
  if (!e) {
    e = stored(k);
    if (e) cache.set(k, e);
  }
  if (e?.p) return e.p;
  if (e && Date.now() - e.at < maxAgeMs) return Promise.resolve(e.v);
  // AWS wallet endpoint carries the native balance — the ONLY source for
  // display. No chain read: browsing pages never touch RPC.
  const p = apiWallet(address)
    .then((d) => { const v = String(d?.native ?? "0"); return /^\d+$/.test(v) ? v : null; })
    .then((v) => { const n = { v, at: Date.now() }; cache.set(k, n); store(k, n); return v; })
    .catch(() => { cache.set(k, { v: e?.v ?? null, at: e?.at ?? 0 }); return e?.v ?? null; });
  cache.set(k, { v: e?.v ?? null, at: e?.at ?? 0, p });
  return p;
}

export function useAseBalance(address?: string, pollMs = 15_000) {
  const [balance, setBalance] = useState<string | null>(() =>
    (address ? cache.get(address.toLowerCase())?.v ?? (typeof window !== "undefined" ? stored(address.toLowerCase())?.v ?? null : null) : null));
  const [loading, setLoading] = useState(false);
  // Event-driven refresh: every new block triggers a (deduped) balance read —
  // a receive/send shows up on the next block instead of the next poll tick.
  const { blockNumber } = useLiveChain();

  const load = useCallback(async (maxAgeMs: number) => {
    if (!address) { setBalance(null); return; }
    setLoading(true);
    try {
      const v = await read(address, maxAgeMs);
      if (v !== null) setBalance(v);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    setBalance(address ? cache.get(address.toLowerCase())?.v ?? stored(address.toLowerCase())?.v ?? null : null);
    // Reuse a fresh shared read instead of firing one per mounted component.
    void load(pollMs * 0.8);
    if (!pollMs) return;
    const t = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void load(pollMs * 0.8);
    }, pollMs);
    return () => clearInterval(t);
  }, [address, load, pollMs]);

  // New block → refresh the balance (5s floor dedupes fast blocks and shares
  // the read with the interval above — never more than one in-flight call).
  useEffect(() => {
    if (blockNumber === null || !address) return;
    void load(5_000);
  }, [blockNumber, address, load]);

  /** Force a fresh read (after a tx). */
  const refresh = useCallback(() => load(0), [load]);
  return { balance, loading, refresh };
}
