"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { rpcPaused } from "@/lib/asentum-wallet";
import { blockReceipts, platformEventBlocks, type RpcEvent, type RpcReceipt } from "@/lib/tx-resolve";
import {
  asepadContractAddress, asedexContractAddresses, asepadNoteEvent,
  asepadPushLaunch, tokenFactoryAddress, AURADEX_LEGACY_CONTRACT
} from "@/lib/asepad";
import { toHexAddress } from "@asentrise/utils";
import { LOCK as LOCK_ADDR, LOCK_V2 } from "@/lib/lock-shared";
import { useLivePaused } from "./live-session";
import { isLivePaused } from "@/lib/live-session";
import { UNIFIED_API } from "@/lib/ase-api";

/** Query-key roots touched per event class. refetchType:"active" is the
 *  focus-priority: only queries mounted on the visible screen refetch —
 *  off-screen caches just go stale and pick up fresh data on next mount. */
const AURAS_ROOTS = ["auras-api-pairs", "auras-candles"];
// Pool-list caches (+ per-pool stats / LP-burn map) are NOT refetched per
// event — every one of them is a sweep over all pools. The AseDex listener
// (subscribeChainEvents) patches just the touched pool in place instead; these
// roots only refetch on their own slow interval or a receipts-miss wave.
const POOL_SWEEP_ROOTS = [
  "asedex-pools", "asedex-legacy-pools", "asedex-search-pool", "asedex-url-pool",
  "asedex-poolstats", "asedex-lp-burns"
];
// Cheap, selection-scoped reads any pool event can move (only mounted ones
// refetch — e.g. the open pair's trades/chart, quote, holders tab).
const DEX_POOL_EVENT_ROOTS = [
  "asedex-quote", "asedex-swaps", "asedex-shares", "asedex-pair-pool",
  "asedex-lp-burned", "asedex-holders", "asepad-token", "asepad-holders",
  // The terminal chart is indexer-backed for BOTH venues now — a dex swap
  // must bust it or AseDex candles go stale between 30s refetches.
  "auras-candles"
];
const DEX_ORDER_EVENTS = new Set([
  "LimitOrderCreated", "LimitOrderFilled", "DcaOrderCreated", "DcaSliceFilled", "OrderCancelled"
]);
// Full set (used by the receipts-miss wave + focus gate).
const DEX_ROOTS = [
  ...POOL_SWEEP_ROOTS, ...DEX_POOL_EVENT_ROOTS, "asedex-orders", "asedex-book",
  "asedex-tokbal", "asedex-held-tokens", "asedex-my-swaps", "asedex-lp-burn-tx"
];
const LEGACY_DEX_ROOTS = [...DEX_POOL_EVENT_ROOTS, "asedex-orders", "asedex-book", ...AURAS_ROOTS];
const PAD_ROOTS = [
  "asepad", "asepad-launches", "asepad-stats", "asepad-token", "asepad-candles",
  "asepad-holders", "asepad-holding", "asepad-allowance", "asepad-quote", "asepad-config",
  "asepad-tx-map"
];
// Sweep-heavy roots with their own refetch intervals — the periodic safety
// wave skips them (an interval already covers them); a receipts miss still
// includes them since events may have been lost.
const SAFETY_SKIP = new Set([...POOL_SWEEP_ROOTS, "asedex-my-swaps", "asepad-launches"]);

/** One receipt's events, handed to page listeners so they can patch their
 *  smart-cache entries in place (one pool / one launch) instead of
 *  refetching whole lists. */
export type ChainEventBatch = { contract: string; txHash?: string; events: RpcEvent[] }[];
type ChainListener = (batch: ChainEventBatch) => void;
const chainListeners = new Set<ChainListener>();
export function subscribeChainEvents(fn: ChainListener): () => void {
  chainListeners.add(fn);
  return () => { chainListeners.delete(fn); };
}
const PAD_MIGRATION_EVENTS = new Set([
  "BondingCompleted", "MigrationStarted", "MigrationCompleted", "MigrationPoolReady",
  "MigrationPoolRequested", "MigrationApproved", "MigrationApprovalRequested",
  "MigrationLiquidityRequested", "MigrationLPBurnRequested", "LPShareBurned",
  "MigrationAccountingFinalized", "LiquidityAdded"
]);
const FACTORY_ROOTS = ["token-factory-fee", "token-factory-fee-tax", "created-token-counts"];
// AseLock v1 — every lock event dirties the aselock roots so lock lists/
// details/vesting repaint live. v2 gets its own root set once it deploys.
const ASEL_LOCK_ROOTS = ["aselock-all", "aselock-lp", "aselock-mine", "aselock-vest",
  "aselock-detail", "aselock-detail-pool", "aselock-detail-tokens",
  "aselock-pairmeta", "aselock-poolmeta", "aselock-tok", "aselock-tokenmeta"];
// Wallet-scoped roots — any receipt event carrying the connected address
// (token Transfers, order fills, pad buys) refreshes wallet-facing queries.
const OWNER_ROOTS = ["asedex-tokbal", "asedex-held-tokens", "asedex-shares", "asedex-orders", "asepad-holding", "asepad-allowance", "asedex-my-swaps",
  "asedex-wallet-activity", "asedex-wallet-trades", "asedex-db-positions", "asedex-idx-positions", "asedex-wallet-created"];
const ALL_LIVE_ROOTS = [...PAD_ROOTS, ...DEX_ROOTS, ...LEGACY_DEX_ROOTS, ...FACTORY_ROOTS, ...OWNER_ROOTS,
  "asedex-holders", "asedex-fee", "asedex-gate", "asedex-create-asset", "asepad-stats",
  "asepad-launches", "asedex-pad-buys", "db-trending", "pad-curve-prices",
  "docs-deploy-fee", ...ASEL_LOCK_ROOTS];
const ALL_LIVE_SET = new Set(ALL_LIVE_ROOTS);
// Safety net: events we don't classify still get a broad wave every ~25th
// block (~2.5min) so nothing can go permanently stale.
const BROAD_SWEEP_EVERY = 25;

const norm = (v: unknown) => String(v ?? "").toLowerCase();
const eventText = (e: { name?: string; data?: Record<string, unknown> }) =>
  `${e?.name ?? ""} ${JSON.stringify(e?.data ?? {})}`.toLowerCase();

// Wallet token journal: when a receipt's events mention the connected wallet,
// the emitting contract is very likely a token the wallet just touched (a
// Transfer in or out). Entries land in the per-user log (localStorage) and
// feed heldTokens discovery — zero extra RPC, same trick the mobile wallet
// uses (its "journal hints").
import { userLogNoteToken, userLogNoteTransfer, userLogTokens } from "@/lib/user-log";
export function walletSeenTokens(owner: string): Set<string> {
  return userLogTokens(owner);
}
function walletNoteToken(owner: string, token: string) {
  userLogNoteToken(owner, token);
}

// Opt-in: Asentum testnet does not currently expose a public WS endpoint, so
// leave NEXT_PUBLIC_ASENTUM_RPC_WS empty and we poll blocks over HTTP instead.
const WS_URL = process.env.NEXT_PUBLIC_ASENTUM_RPC_WS || "";
const API_WS = UNIFIED_API ? UNIFIED_API.replace(/^http/, "ws") + "/ws" : "";
// The head poll rides the shared read pool (same-origin /rpc relay when the
// Functions quota is up, CORS-open HTTPS endpoints otherwise) — re-evaluated
// per tick so a dead function path can't wedge it on "Reconnecting".
// Matches MIN_REFRESH_GAP_MS — polling faster than we refresh is wasted calls.
const FALLBACK_POLL_MS = 6000;
const MAX_POLL_MS = 32_000;
// A new block invalidates every live query — cap the wave so bursts of blocks
// (or a fast poll) can't turn into an RPC storm.
const MIN_REFRESH_GAP_MS = 6000;
// Single dropped polls are normal (rate limits, flaky node); only surface
// "Reconnecting" after several misses in a row.
const FAILS_BEFORE_OFFLINE = 4;

type LiveState = { blockNumber: bigint | null; connected: boolean; mode: "websocket" | "polling" };
const LiveChainContext = createContext<LiveState>({ blockNumber: null, connected: false, mode: "polling" });

export function useLiveChain() {
  return useContext(LiveChainContext);
}

export function LiveChainProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const paused = useLivePaused();
  const [state, setState] = useState<LiveState>({ blockNumber: null, connected: false, mode: "polling" });
  const lastBlock = useRef<bigint | null>(null);
  const lastRefresh = useRef(0);
  const scannedUpTo = useRef<bigint | null>(null);
  const blocksSeen = useRef(0);
  // Receipts-miss cooldown: after a 429/flaky read, stop ASKING for receipts
  // for a while — marking roots stale instead of refetching them still costs
  // the block fetch itself, which was the remaining storm.
  const receiptsMissUntil = useRef(0);

  useEffect(() => {
    if (paused) {
      setState((previous) => ({ ...previous, connected: false }));
      return;
    }
    lastRefresh.current = 0;
    scannedUpTo.current = null;
    let socket: WebSocket | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let pushTimer: ReturnType<typeof setTimeout> | null = null;
    const pushed = new Map<bigint, RpcReceipt[]>();
    let retryDelay = 2000;
    let disposed = false;

    const pad = asepadContractAddress();
    const dexes = new Set(asedexContractAddresses());
    const legacyDex = norm(AURADEX_LEGACY_CONTRACT);
    const factory = norm(tokenFactoryAddress());
    const ownerHex = (): string => {
      try {
        const raw = (localStorage.getItem("asentum:connect:address") || "").trim();
        if (/^0x[0-9a-fA-F]{40}$/.test(raw)) return raw.toLowerCase();
        if (raw.startsWith("ase1")) return norm(toHexAddress(raw));
      } catch { /* no wallet */ }
      return "";
    };

    // Event-driven updates: read each new block's receipts once (cached by
    // tx-resolve), classify events by emitting contract, and touch ONLY the
    // caches they can move — then patch lists in place. A quiet block costs
    // the poll + one /block fetch and zero view calls. If the receipts read
    // fails we can't see events, so fall back to the broad wave (never blind).
    const processBlocks = async (tip: bigint, supplied?: Map<bigint, RpcReceipt[]>) => {
      if (disposed || isLivePaused()) return;
      const from = supplied?.size ? [...supplied.keys()].reduce((a, b) => a < b ? a : b)
        : scannedUpTo.current === null || tip - scannedUpTo.current > 3n
        ? (tip > 2n ? tip - 2n : 1n)
        : scannedUpTo.current + 1n;
      scannedUpTo.current = tip;
      blocksSeen.current += 1;
      // Focus gate: if the user isn't viewing anything live (no mounted query
      // under a live root), events can't update any visible data — skip the
      // receipts fetch entirely. A browser on a static view costs ~0 RPC.
      const hasLiveQuery = queryClient.getQueryCache().findAll({ type: "active" })
        .some((q) => ALL_LIVE_SET.has(String(q.queryKey[0])));
      if (!hasLiveQuery) return;
      const dirty = new Set<string>();
      const owner = ownerHex();
      let receiptsMissing = false;
      // One batched eth_getLogs covers the whole range for every platform
      // contract — quiet blocks cost a single POST and produce zero receipts
      // fetches. REST receipts only come down for blocks that actually
      // emitted platform events (sparse on a quiet chain).
      let busyBlocks: Set<number> | null = null;
      if (!supplied) {
        busyBlocks = Date.now() < receiptsMissUntil.current ? null
          : await platformEventBlocks(Number(from), Number(tip), [pad, ...dexes, legacyDex, factory, LOCK_ADDR, LOCK_V2].filter(Boolean) as string[]);
        if (busyBlocks === null) receiptsMissing = true;
      }
      const batch: ChainEventBatch = [];
      for (let n = from; n <= tip; n++) {
        if (disposed || isLivePaused()) return;
        const receipts = supplied ? supplied.get(n) ?? []
          : busyBlocks === null ? null
          : !busyBlocks.has(Number(n)) ? []
          : await blockReceipts(Number(n));
        if (receipts === null) { receiptsMissing = true; continue; }
        for (const rc of receipts) {
          if (rc.success === false || !rc.events?.length) continue;
          const to = norm(rc.recipient);
          if (to === pad || dexes.has(to) || to === legacyDex || to === factory) {
            batch.push({ contract: to, txHash: rc.txHash, events: rc.events });
          }
          if (to === pad) {
            for (const e of rc.events) {
              PAD_ROOTS.forEach((r) => dirty.add(r));
              const token = norm(e?.data?.token);
              if (token) asepadNoteEvent(token); // bust record/trade caches NOW
              if (e?.name === "LaunchCreated") {
                if (token) void asepadPushLaunch(queryClient, token);
                dirty.add("created-token-counts"); // Create page counts pad launches too
              }
              // Migration seeds/creates an AseDex pool — the dex listener
              // patches it; refresh the cheap pool-scoped reads here.
              if (e?.name && PAD_MIGRATION_EVENTS.has(e.name)) DEX_POOL_EVENT_ROOTS.forEach((r) => dirty.add(r));
            }
          } else if (dexes.has(to) || to === legacyDex) {
            (to === legacyDex ? LEGACY_DEX_ROOTS : DEX_POOL_EVENT_ROOTS).forEach((r) => dirty.add(r));
            if (to !== legacyDex) dirty.add("asepad-stats"); // dex volume feeds the total card
            if (rc.events.some((e) => e?.name && DEX_ORDER_EVENTS.has(e.name))) dirty.add("asedex-book");
          } else if (to === factory) {
            FACTORY_ROOTS.forEach((r) => dirty.add(r));
          } else if (to === norm(LOCK_ADDR) || to === norm(LOCK_V2)) {
            ASEL_LOCK_ROOTS.forEach((r) => dirty.add(r));
          }
          // Wallet-scoped: any event carrying the connected address
          // (token Transfer, order fill, curve buy) refreshes wallet queries.
          // Non-platform emitters touching the wallet are token contracts —
          // journal them so heldTokens discovers inbound receives too.
          if (owner) {
            const platform = to === pad || dexes.has(to) || to === legacyDex || to === factory;
            for (const e of rc.events) {
              if (eventText(e).includes(owner)) {
                OWNER_ROOTS.forEach((r) => dirty.add(r));
                if (!platform && /^0x[0-9a-f]{40}$/.test(to)) {
                  walletNoteToken(owner, to);
                  // Transfer events carry from/to/value — log the movement so
                  // wallet history has real entries, not just token hints.
                  if (/transfer/i.test(String(e?.name || ""))) {
                    const d = (e?.data ?? {}) as Record<string, unknown>;
                    const dir = norm(d.to) === owner ? "in" as const : norm(d.from) === owner ? "out" as const : null;
                    if (dir) {
                      const amount = String(d.value ?? d.amount ?? "0");
                      const counterparty = norm(dir === "in" ? d.from : d.to);
                      userLogNoteTransfer(owner, { token: to, dir, amount, counterparty: /^0x[0-9a-f]{40}$/.test(counterparty) ? counterparty : undefined, txHash: rc.txHash });
                    }
                  }
                }
              }
            }
          }
        }
      }
      // Listeners patch their caches in place from the raw events (sync — they
      // schedule their own reads). A throwing listener can't break the wave.
      if (batch.length) for (const fn of chainListeners) { try { fn(batch); } catch { /* listener bug */ } }
      // Couldn't read receipts → broad wave so nothing goes stale silently.
      // Every 25th block a lighter safety wave skips sweep-heavy roots that
      // already refresh on their own interval.
      if (receiptsMissing) {
        // Receipts read failed (429/flaky node) — mark live roots STALE only.
        // Refetching every root here was the storm feedback loop: the wave
        // fired chain reads that 429'd the receipts that dirty the wave.
        // Cool down the receipts lane so the next block doesn't even fetch.
        receiptsMissUntil.current = Date.now() + 60_000;
        void queryClient.invalidateQueries({ predicate: (q) => ALL_LIVE_SET.has(String(q.queryKey[0])), refetchType: "none" });
        return;
      }
      if (blocksSeen.current % BROAD_SWEEP_EVERY === 0) {
        ALL_LIVE_ROOTS.forEach((r) => { if (!SAFETY_SKIP.has(r)) dirty.add(r); });
      }
      if (!dirty.size) return; // quiet block — nothing to fetch, zero RPC
      void queryClient.invalidateQueries(
        {
          predicate: (query) => dirty.has(String(query.queryKey[0])),
          refetchType: "active"
        },
        // Never abort an in-flight stream: streaming loaders enumerate ids
        // newest-first, so a cancel-restart loop would pin the list at
        // "how far it gets in one event gap" and never reach the tail.
        // Marking stale joins/queues the refetch after the current sweep.
        { cancelRefetch: false }
      );
    };

    const onBlock = (block: bigint, mode: LiveState["mode"]) => {
      if (disposed || isLivePaused()) return;
      if (lastBlock.current !== null && block <= lastBlock.current) {
        setState((previous) => ({ ...previous, connected: true, mode }));
        return;
      }
      lastBlock.current = block;
      setState({ blockNumber: block, connected: true, mode });
      const now = Date.now();
      if (now - lastRefresh.current < MIN_REFRESH_GAP_MS) return;
      // Rate-limit cooldown or wallet signing: skip the receipts read, but
      // still mark live roots STALE — "refetchType: none" queues no requests,
      // so the queries refetch on their next natural trigger (interval, focus,
      // mount) instead of looking fresh-forever while the gate is paused.
      if (rpcPaused()) {
        void queryClient.invalidateQueries({ predicate: (q) => ALL_LIVE_SET.has(String(q.queryKey[0])), refetchType: "none" });
        return;
      }
      lastRefresh.current = now;
      // Cursor advanced = the indexer committed new data. Invalidate every
      // live-fed root (they refetch through the AWS API) — identical to the
      // WS "rev" trigger. No receipts reads: RPC is reserved for user actions.
      void queryClient.invalidateQueries({ predicate: (q) => ALL_LIVE_SET.has(String(q.queryKey[0])), refetchType: "active" }, { cancelRefetch: false });
    };

    let failStreak = 0;
    const poll = async () => {
      if (disposed || isLivePaused()) return;
      // AWS cursor poll — /api/stats.cursor is the latest block the indexer
      // committed. Live-ness is driven by INDEXED data (that's what the pages
      // paint), not raw chain height, so an indexer's cursor advance is the
      // truest tick and costs zero RPC. Edge-cached upstream, so the 6s cadence
      // is ~1 D1 read per PoP.
      try {
        const res = await fetch(`${UNIFIED_API}/api/stats`, { headers: { accept: "application/json" } }).catch(() => null);
        const body = res?.ok ? await res.json().catch(() => null) as { cursor?: number } | null : null;
        const cursor = Number(body?.cursor);
        if (!res?.ok || !Number.isSafeInteger(cursor) || cursor <= 0) throw new Error("bad stats");
        failStreak = 0;
        onBlock(BigInt(cursor), "polling");
        return;
      } catch {
        failStreak += 1;
        if (failStreak >= FAILS_BEFORE_OFFLINE) {
          setState((prev) => (prev.connected ? { ...prev, connected: false, mode: "polling" } : prev));
        }
      }
    };

    const startPolling = () => {
      if (pollTimer || disposed) return;
      const tick = async () => {
        // Hidden tab: skip the call (not a failure). The head poll keeps
        // running through RPC pauses — it's one cheap GET outside the
        // JSON-RPC budget, and a stopped heartbeat would freeze every
        // page's freshness for the whole cooldown.
        const hidden = typeof document !== "undefined" && document.visibilityState !== "visible";
        if (!hidden) await poll();
        if (disposed) return;
        // Back off while failing (6s → 32s) so we don't hammer a limited node.
        // Jitter spreads many browsers over the window — fixed cadence makes
        // hundreds of clients synchronize into a thundering herd on the RPC.
        const delay = Math.min(FALLBACK_POLL_MS * 2 ** Math.min(failStreak, 3), MAX_POLL_MS)
          + Math.floor(Math.random() * 1500);
        pollTimer = setTimeout(() => { void tick(); }, delay);
      };
      pollTimer = setTimeout(() => { void tick(); }, 0);
    };
    const stopPolling = () => {
      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = null;
    };

    const connect = () => {
      if (disposed || typeof WebSocket === "undefined" || (!API_WS && !WS_URL)) return startPolling();
      try {
        socket = new WebSocket(API_WS || WS_URL);
      } catch {
        return startPolling();
      }
      socket.onopen = () => {
        retryDelay = 2000;
        if (!API_WS) socket?.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["newHeads"] }));
      };
      socket.onmessage = (event) => {
        try {
          if (disposed || isLivePaused()) return;
          const msg = JSON.parse(String(event.data)) as { t?: string; cursor?: number; blocks?: { number: number; receipts: RpcReceipt[] }[]; params?: { result?: { number?: string } } };
          if (API_WS && (msg.t === "hello" || msg.t === "blocks") && Number.isSafeInteger(msg.cursor)) {
            stopPolling();
            const tip = BigInt(msg.cursor!);
            lastBlock.current = tip;
            setState({ blockNumber: tip, connected: true, mode: "websocket" });
            if (msg.t === "hello") {
              void queryClient.invalidateQueries({ predicate: (q) => ALL_LIVE_SET.has(String(q.queryKey[0])), refetchType: "active" }, { cancelRefetch: false });
            } else {
              for (const block of msg.blocks ?? []) pushed.set(BigInt(block.number), block.receipts);
              // Keep every received block while coalescing query refreshes.
              if (!pushTimer) pushTimer = setTimeout(() => {
                pushTimer = null;
                const batch = new Map(pushed); pushed.clear();
                lastRefresh.current = Date.now();
                void processBlocks(lastBlock.current ?? tip, batch);
              }, Math.max(0, MIN_REFRESH_GAP_MS - (Date.now() - lastRefresh.current)));
            }
            return;
          }
          // AWS indexer commit — data_rev bumped → /api/* bodies changed. This
          // is the truest AWS-live trigger: invalidate every live-fed query so
          // stats/launches/trending repaint at indexer cadence, not block cadence.
          if (API_WS && msg.t === "rev") {
            stopPolling();
            lastRefresh.current = Date.now();
            void queryClient.invalidateQueries({ predicate: (q) => ALL_LIVE_SET.has(String(q.queryKey[0])), refetchType: "active" }, { cancelRefetch: false });
            return;
          }
          const number = msg.params?.result?.number;
          if (number) {
            stopPolling();
            onBlock(BigInt(number), "websocket");
          }
        } catch { /* ignore malformed frames */ }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (disposed) return;
        startPolling();
        retryTimer = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30000);
      };
    };

    startPolling();
    connect();

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void poll();
      // Focus refresh: wallet-facing data may have moved while the tab was
      // hidden even with no new events — touch owner-scoped roots so the
      // mounted ones refetch and merge into the user log.
      void queryClient.invalidateQueries({
        predicate: (q) => OWNER_ROOTS.includes(String(q.queryKey[0])),
        refetchType: "active"
      }, { cancelRefetch: false });
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisible);
      stopPolling();
      if (retryTimer) clearTimeout(retryTimer);
      if (pushTimer) clearTimeout(pushTimer);
      socket?.close();
    };
  }, [queryClient, paused]);

  return <LiveChainContext.Provider value={state}>{children}</LiveChainContext.Provider>;
}

/** Small "Live · block N" indicator for page headers. */
export function LiveIndicator({ className = "" }: { className?: string }) {
  const { blockNumber, connected } = useLiveChain();
  const paused = useLivePaused();
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] text-white/65 ${className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${connected ? "animate-pulse bg-emerald-400" : "bg-amber-400"}`} />
      {paused ? "Paused" : connected ? "Live" : "Reconnecting"}{blockNumber !== null ? ` · block ${blockNumber.toString()}` : ""}
    </span>
  );
}
