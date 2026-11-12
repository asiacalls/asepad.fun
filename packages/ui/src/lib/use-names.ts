"use client";
import { useEffect, useRef, useState } from "react";
import { UNIFIED_API } from "@/lib/ase-api";

/** Resolve ase1/hex addresses → on-chain @names via the names batch API.
 *  Shared so every address surface shows @username where one exists. */
const cache = new Map<string, string>();
// Addresses with NO name get a short negative cache — most wallets never
// register one, and re-probing them on every mount was the /api/names/batch
// repeat traffic.
const missCache = new Map<string, number>();
const MISS_TTL = 5 * 60_000;
export function useNames(addrs: (string | undefined | null)[]): Record<string, string> {
  const [names, setNames] = useState<Record<string, string>>({});
  const key = addrs.filter(Boolean).map((a) => String(a).toLowerCase()).sort().join(",");
  const last = useRef("");
  useEffect(() => {
    if (!key || key === last.current || !UNIFIED_API) return;
    last.current = key;
    const now = Date.now();
    const missing = key.split(",").filter((a) => a && !cache.has(a) && (missCache.get(a) ?? 0) < now);
    if (!missing.length) { setNames(Object.fromEntries(cache)); return; }
    const out: Record<string, string> = {};
    for (let i = 0; i < missing.length; i += 50) {
      const slice = missing.slice(i, i + 50);
      fetch(`${UNIFIED_API}/api/names/batch?addrs=${encodeURIComponent(slice.join(","))}`, { signal: AbortSignal.timeout(8000) })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          const map = j?.names ?? j ?? {};
          for (const a of slice) if (!(a in map)) missCache.set(a, Date.now() + MISS_TTL);
          for (const [a, n] of Object.entries(map)) { cache.set(String(a).toLowerCase(), String(n)); out[String(a).toLowerCase()] = String(n); }
          setNames((p) => ({ ...p, ...out }));
        })
        .catch(() => {});
    }
  }, [key]);
  return names;
}
/** Display helper: @name when resolved, else shortened address. */
export const namedAddr = (addr: string, names: Record<string, string>, shorten: (a: string) => string) => {
  const n = names[addr.toLowerCase()];
  return n ? `@${n.replace(/^@/, "")}` : shorten(addr);
};
