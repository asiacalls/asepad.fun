"use client";

// Device-side smart cache: the whole React Query cache snapshots to
// localStorage (throttled) and rehydrates on the next visit — every section
// (markets, pools, orders, launches, holders, stats, wallet data) paints
// instantly from disk, then the normal stale/interval/live-block machinery
// refreshes it piece by piece in the background.
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { PersistQueryClientOptions } from "@tanstack/react-query-persist-client";
import type { Query } from "@tanstack/react-query";

// v2: query data shapes that used Map/bigint were serializing to "{}" on
// persist and crashing .get() readers on restore — bumping drops the
// corrupted entries so they never hydrate.
// v3: swap-history rows persisted by older builds can lack base/quote —
// restoring them crashed "reading 'symbol'" on the wallet view.
// v4: pool/asset rows could carry non-numeric wei strings ("Probe 25" from a
// non-template contract) that crashed BigInt renders — drop those restores.
// v5: a numStr validator briefly rejected numeric view results (totalSupply/
// balanceOf/sharesOf arrive as JSON numbers) and persisted them as "0".
const CACHE_KEY = "asepad:rq-cache:v5";
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // restore anything younger than a day
const MAX_QUERY_BYTES = 1536 * 1024; // skip monster payloads (quota safety)

// Roots worth carrying across visits. Ephemeral inputs (live buy/sell quotes,
// gate probes, tx-map resolution) are deliberately excluded — a stale quote is
// worse than a fresh spinner, and they recompute cheaply once their inputs
// resolve.
// Fee-bearing configs (asepad-config, asedex-fee, token-factory-fee*) are
// deliberately NOT persisted — fees are admin-settable on-chain, so a
// day-old restore could display a fee that no longer exists. They refetch
// live on every mount instead.
const PERSIST_ROOTS = new Set([
  "asepad-launches", "asepad-stats", "asepad-token", "asepad-candles",
  "asepad-holders", "asepad-holding", "asepad-allowance",
  "asepad-verification", "asepad-tx-map",
  "asedex-pools", "asedex-legacy-pools", "asedex-shares",
  "asedex-orders", "asedex-book", "asedex-swaps", "asedex-tokbal",
  "asedex-held-tokens", "asedex-holders", "asedex-lp-burned",
  "asedex-lp-burn-tx", "asedex-lp-burns", "asedex-poolstats",
  "asedex-my-swaps", "asedex-pad-buys", "asedex-url-pool",
  "asedex-token-tax", "asedex-pair-pool", "asedex-search-pool",
  "auras-api-pairs", "auras-candles",
  "created-token-counts"
]);

const persistable = (query: Query) => {
  if (query.state.status !== "success") return false;
  if (query.meta?.persist === false) return false;
  if (!PERSIST_ROOTS.has(String(query.queryKey[0] ?? ""))) return false;
  // Typed search results are throwaway — one persisted copy per search term
  // would bloat storage. Tabs/sections (empty search) are what reload paints.
  if (query.queryKey[0] === "asepad-launches" && query.queryKey[2]) return false;
  // Streamed partials (partial:true) are mid-sweep states — never persist
  // them or a reload could restore a half-built list.
  if ((query.state.data as { partial?: boolean } | undefined)?.partial === true) return false;
  // Streaming loaders seed every emit with previously-known rows (and merge
  // back anything the id cap doesn't cover), so a mid-fetch snapshot can only
  // grow vs the last persisted state — safe to persist while fetching.
  // Map/Set serialize to "{}" and restore as plain objects — callers waiting
  // on .get() would crash. bigint throws inside stringify (caught below).
  const d = query.state.data;
  if (d instanceof Map || d instanceof Set) return false;
  // Full-board launch lists (~11k records, ~13MB) can never fit the byte cap —
  // reject on length before paying a stringify every throttle tick (that
  // stringify loop froze the main thread for 80s+). The sweep's own disk
  // store + the CDN snapshot already paint reloads instantly.
  if (query.queryKey[0] === "asepad-launches" && ((d as { launches?: unknown[] } | undefined)?.launches?.length ?? 0) > 400) return false;
  try {
    return JSON.stringify(query.state.data).length <= MAX_QUERY_BYTES;
  } catch {
    return false;
  }
};

/** Persist options shared by the provider. Browser-only by construction —
 *  the persister is created inside the client component. */
export const queryPersistOptions = (): Omit<PersistQueryClientOptions, "queryClient"> | null => {
  if (typeof window === "undefined") return null;
  try {
    const persister = createAsyncStoragePersister({
      storage: window.localStorage,
      key: CACHE_KEY,
      throttleTime: 1500
    });
    return {
      persister,
      maxAge: MAX_AGE_MS,
      buster: CACHE_KEY,
      dehydrateOptions: { shouldDehydrateQuery: persistable }
    };
  } catch {
    return null;
  }
};
