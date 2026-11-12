import { apiLaunches, apiLaunchPage, apiPools, apiResolve, apiStats, apiTrades, apiTrending, UNIFIED_API } from "@/lib/ase-api";
import type { QueryClient } from "@tanstack/react-query";
import { buildPadTokenSource, buildStandardTokenSource, buildTaxTokenSource, verifyTokenSourceString, type TokenGenesis, type TokenVerification } from "@asentrise/contracts/browser";
import { toAseAddress, toHexAddress } from "@asentrise/utils";

const ASEPAD_CONTRACT = process.env.NEXT_PUBLIC_CONTRACT_ASEPAD || process.env.CONTRACT_ASEPAD || "";
const ASEDEX_CONTRACTS = [process.env.NEXT_PUBLIC_CONTRACT_ASEDEX, process.env.CONTRACT_ASEDEX].filter(Boolean).map((a) => String(a).toLowerCase());
// live-chain's block watcher classifies receipts by recipient contract.
export const asepadContractAddress = () => ASEPAD_CONTRACT.toLowerCase();
export const asedexContractAddresses = () => ASEDEX_CONTRACTS;
/** Never-throw BigInt for untrusted chain/indexer strings — a garbage field
 *  (e.g. "Probe 25" from a non-template contract) used to crash whole renders.
 *  Bad values degrade to 0n, which fails safe toward zero-state displays. */
export const safeBig = (v: unknown): bigint => {
  // Token views (totalSupply/balanceOf/sharesOf) return JSON NUMBERS (1e+27) —
  // String() would yield "1e+27" and throw; BigInt truncates the double to its
  // integer value directly. Strings still go through the digit path.
  try { return BigInt(typeof v === "number" ? Math.trunc(v) : String(v ?? "0")); } catch { return 0n; }
};
/** Whole-wei string or "0" — same trust boundary as safeBig, for stored fields. */
export const numStr = (v: unknown): string => {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? BigInt(Math.trunc(v)).toString() : "0";
  return /^\d+$/.test(String(v ?? "")) ? String(v) : "0";
};
const parseJson = <T,>(value: unknown, fallback: T): T => {
  // null/undefined must take the fallback — a contract's legit null (missing
  // launch record) used to pass through and crash mapLaunch on .totalSupply.
  try { return value == null ? fallback : (typeof value === "string" ? JSON.parse(value) as T : value as T); } catch { return fallback; }
};
// ── read-level caches ──────────────────────────────────────────────────────
// Everything below exists because the live-chain provider invalidates these
// queries on every new block (~4s): the queryFn must be cheap when nothing
// moved. Immutable reads (launchAt index, holderAt index) are cached forever;
// mutable reads are gated on a cheap change signal so a quiet block costs
// 1–2 view calls instead of hundreds.
// Sweep persistence (vault-model): the whole token→record map plus a
// `sweptUpTo` cursor persists to localStorage. Later loads enumerate only the
// index DELTA (indexes > sweptUpTo) — the chain is never re-walked for
// history. Mutable records refresh selectively: tokens flagged by live-chain
// events plus a rolling window of the newest live curves. A bonding curve
// that hasn't traded doesn't change, so re-reading all of them every sweep
// was pure RPC burn — that's what kept the grid on skeletons.
const PAD_STORE_KEY = "asepad:dir-v3";
type PadStore = { sweptUpTo: string; missed: string[]; rec: Record<string, string> };
let padStore: PadStore | undefined;
let padStoreDirty = false;
function padStoreRead(): PadStore {
  if (padStore === undefined) {
    let raw: PadStore | undefined;
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem(PAD_STORE_KEY) || "{}";
        raw = JSON.parse(stored) as PadStore;
        // A pre-slim store is megabytes of raw records — that alone can fill
        // the quota and block the wallet adapter's session write. Reshape it
        // once here so the fix lands even if nothing else writes this session.
        if (raw?.rec && stored.length > 1_500_000) {
          for (const k of Object.keys(raw.rec)) raw.rec[k] = slimRaw(raw.rec[k]);
          queueMicrotask(() => { try { localStorage.setItem(PAD_STORE_KEY, JSON.stringify(raw)); } catch { } });
        }
      } catch { raw = undefined; }
    }
    padStore = {
      sweptUpTo: raw?.sweptUpTo ?? "-1",
      missed: Array.isArray(raw?.missed) ? raw.missed : [],
      rec: raw?.rec ?? {}
    };
  }
  return padStore;
}
// localStorage quota is shared with the wallet adapter (asentum:connect:*) —
// an oversized store literally breaks wallet connect. Keep records slim (the
// fields mapLaunch + consumers actually read — raw records run ~30 fields)
// and if setItem still throws, shrink the map until it fits.
const REC_KEEP = new Set([
  "token", "name", "symbol", "creator", "status", "createdTs", "migratedTs", "bondedTs",
  "decimals", "initialized", "totalSupply", "supply", "curveSupply", "initialPriceWei",
  "aseReserve", "reserve", "tokenReserve", "tokensLeft",
  "volumeWei", "volume", "buyVolumeWei", "sellVolumeWei", "buyCount", "sellCount", "tradeCount",
  "targetWei", "lpSharesBurned", "aseDexPoolId", "aseDex", "spotPriceWei", "marketCapWei",
  "migrationStage", "migrationAseWei", "migrationTokenWei", "creatorRewardWei",
  "finalAseReserve", "finalTokenReserve", "finalPriceWei", "finalMarketCapWei",
  "lastPriceWei", "meta"
]);
const slimRaw = (raw: unknown): string => {
  try {
    const o = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!o || typeof o !== "object") return JSON.stringify(raw);
    const slim: Record<string, unknown> = {};
    for (const k of Object.keys(o as Record<string, unknown>)) if (REC_KEEP.has(k)) slim[k] = (o as Record<string, unknown>)[k];
    // meta can carry heavy fields — keep only logoUrl/socials.
    const m = slim.meta;
    if (m) {
      const mm = typeof m === "string" ? JSON.parse(m) : m;
      slim.meta = JSON.stringify({ logoUrl: mm?.logoUrl, website: mm?.website, twitter: mm?.twitter, telegram: mm?.telegram });
    }
    return JSON.stringify(slim);
  } catch { return typeof raw === "string" ? raw : JSON.stringify(raw); }
};
function padStoreWrite() {
  if (padStoreDirty || typeof window === "undefined") return; // one flush per microtask burst, not per record
  padStoreDirty = true;
  queueMicrotask(() => {
    padStoreDirty = false;
    try {
      const s = padStoreRead();
      // Bound the record map — drop oldest beyond 3000 so storage stays under quota.
      let keys = Object.keys(s.rec);
      if (keys.length > 3000) for (const k of keys.slice(0, keys.length - 3000)) delete s.rec[k];
      for (let attempt = 0; attempt < 3; attempt++) {
        try { localStorage.setItem(PAD_STORE_KEY, JSON.stringify(s)); return; } catch { }
        // Quota still exceeded — halve the oldest half and retry.
        keys = Object.keys(s.rec);
        const drop = Math.max(1, Math.floor(keys.length / 2));
        for (const k of keys.slice(0, drop)) delete s.rec[k];
      }
    } catch { /* private mode — memory caches still work */ }
  });
}
// config changes rarely — share one read across stats/list/detail for a minute.
let configMemo: { at: number; p: Promise<AsepadConfig> } | null = null;
const asepadGetConfigCached = () => {
  if (!configMemo || Date.now() - configMemo.at > 60_000) {
    configMemo = { at: Date.now(), p: asepadGetConfig() };
    void configMemo.p.catch(() => { configMemo = null; });
  }
  return configMemo.p;
};
const holderCountMemo = new Map<string, { at: number; n: Promise<number> }>();
// holderCount samples — the "holders growing" signal for trending. Persisted
// to sessionStorage so a reload keeps the window history.
const HOLDER_HIST_KEY = "asepad:holder-hist-v1";
let holderHist: Record<string, { t: number; n: number }[]> | undefined;
function holderHistRead(): Record<string, { t: number; n: number }[]> {
  if (holderHist === undefined) {
    try { holderHist = JSON.parse(sessionStorage.getItem(HOLDER_HIST_KEY) || "{}") as typeof holderHist; } catch { holderHist = {}; }
  }
  return holderHist ?? {};
}
function holderHistWrite() {
  try { sessionStorage.setItem(HOLDER_HIST_KEY, JSON.stringify(holderHistRead())); } catch { }
}
/** Holders gained over roughly `windowMs` — null until we've sampled long enough. */
function holderDelta(token: string, nowN: number, windowMs: number): number | null {
  const hist = holderHistRead();
  const k = token.toLowerCase();
  const arr = hist[k] ?? (hist[k] = []);
  const now = Date.now();
  const last = arr[arr.length - 1];
  if (!last || last.n !== nowN || now - last.t > 60_000) {
    arr.push({ t: now, n: nowN });
    while (arr.length > 40 || (arr.length && arr[0]!.t < now - windowMs * 3)) arr.shift();
    holderHistWrite();
  }
  const prev = [...arr].reverse().find((s) => s.t <= now - windowMs * 0.8);
  return prev ? nowN - prev.n : null;
}
const mapPadTrade = (t: Record<string, string>): AsepadTrade => ({
  id: t.index || "0", kind: t.kind || "TRADE", traderAddress: t.traderAddress || "",
  aseWei: t.aseWei || "0", tokenAmount: t.tokenAmount || "0", feeWei: t.feeWei || "0",
  reserveWeiAfter: t.reserveWeiAfter || "0", txHash: t.txHash || "",
  createdAt: new Date(Number(t.createdTs || "0")).toISOString()
});
// recentTrades is the trending-window source — TTL'd so per-block invalidation
// doesn't refire a 100-trade read per candidate every few seconds.
const recentTradesMemo = new Map<string, { at: number; p: Promise<AsepadTrade[]> }>();

function mapLaunch(raw: Record<string, unknown>): AsepadLaunch {
  const supply = String(raw.totalSupply ?? raw.supply ?? "0");
  const reserve = String(raw.aseReserve ?? raw.reserve ?? "0");
  const tokensLeft = String(raw.tokenReserve ?? raw.tokensLeft ?? "0");
  const volume = String(raw.volumeWei ?? raw.volume ?? "0");
  const meta = parseJson<AsepadLaunch["meta"]>(raw.meta, null);
  return {
    ...raw,
    token: String(raw.token ?? ""), name: String(raw.name ?? ""), symbol: String(raw.symbol ?? ""),
    creator: String(raw.creator ?? ""), supply, reserve, tokensLeft, volume,
    status: String(raw.status ?? "BONDING").toUpperCase() as AsepadLaunch["status"],
    createdTs: String(raw.createdTs ?? "0"), meta,
    lpBurned: safeBig(String(raw.lpSharesBurned ?? "0")) > 0n,
    aseDexPoolId: String(raw.aseDexPoolId ?? "") || null,
    targetWei: String(raw.targetWei ?? "0"),
    progressBps: ["BONDED", "MIGRATING", "MIGRATED"].includes(String(raw.status))
      ? 10000 // curve completed — reserve drains to 0 on migration, so status owns the bar
      : safeBig(String(raw.targetWei ?? "0")) > 0n
        ? Number(safeBig(reserve) * 10000n / safeBig(String(raw.targetWei))) : 0
  } as AsepadLaunch;
}

export type AsepadLaunch = {
  token: string;
  name: string;
  symbol: string;
  creator: string;
  // canonical v2 fields
  totalSupply?: string;
  curveSupply?: string;
  initialPriceWei?: string;
  virtualAseWei?: string;
  aseReserve?: string;
  tokenReserve?: string;
  volumeWei?: string;
  buyVolumeWei?: string;
  sellVolumeWei?: string;
  buyCount?: string;
  sellCount?: string;
  tradeCount?: string;
  initialized?: boolean;
  k?: string;
  spotPriceWei?: string;
  marketCapWei?: string;
  feeBps?: string;
  creatorBps?: string;
  creationFeeWei?: string;
  creatorRewardWei?: string;
  treasury?: string;
  aseDex?: string;
  aseDexPoolId?: string | null;
  lpSharesBurned?: string;
  migrationStage?: string;
  migrationAseWei?: string;
  migrationTokenWei?: string;
  migrationCreatorWei?: string;
  finalAseReserve?: string;
  finalTokenReserve?: string;
  finalPriceWei?: string;
  finalMarketCapWei?: string;
  initialBuyWei?: string;
  initialBuyTokens?: string;
  migratedTs?: string;
  bondedTs?: string;
  // compatibility aliases
  supply: string;
  reserve: string;
  tokensLeft: string;
  volume: string;
  status: "BONDING" | "BONDED" | "MIGRATING" | "MIGRATED" | "RECOVERED";
  createdTs: string;
  targetWei?: string;
  progressBps?: number;
  /** Rolling-24h ASE volume — only populated on the trending board (that's
   *  the rank metric; the generic `volume` field is all-time). */
  vol24Wei?: string;
  meta?: {
    description?: string;
    logoUrl?: string;
    website?: string;
    twitter?: string;
    telegram?: string;
  } | null;
  lpBurned?: boolean;
};

/** Ensure a pasted link/image URL is usable — prepends https:// when missing. */
export function linkUrl(raw?: string): string | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  // Uploaded/data URIs pass through untouched — prefixing https:// to a
  // data URI or ipfs:// link is what broke logo previews.
  if (/^data:/i.test(v)) return v;
  // ipfs.io/dweb.link 429 in practice — pinata is the public gateway that
  // actually serves right now.
  if (/^ipfs:\/\//i.test(v)) return `https://gateway.pinata.cloud/ipfs/${v.slice(7)}`;
  // postimg.cc/<id> is a page link, not an image — og:image scrape via the
  // API resolves the real i.postimg.cc file; <img> follows the 302 fine.
  const RESOLVER = `${UNIFIED_API}/api/imgresolve`;
  if (/^https?:\/\/(www\.)?postimg\.cc\//i.test(v) && !/^https?:\/\/i\.postimg\.cc\//i.test(v))
    return `${RESOLVER}?u=${encodeURIComponent(v)}`;
  // Pinterest/pinimg URLs are real images but browser tracking prevention
  // blocks the third-party load — proxy same-origin through the API.
  if (/^https?:\/\/([^/]*\.)?(i\.)?pinimg\.com\//i.test(v) || /^https?:\/\/([^/]*\.)?pinterest\.[a-z.]+\//i.test(v))
    return `${RESOLVER}?u=${encodeURIComponent(v)}`;
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

/** Turn loose user input into a usable href: "@handle", bare handle, or bare domain. */
export function socialUrl(kind: "website" | "twitter" | "telegram", raw?: string): string | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  if (/^https?:\/\//i.test(v)) return v;
  const handle = v.startsWith("@") ? v.slice(1) : v;
  if (kind === "twitter") return /^[\w.]+$/.test(handle) ? `https://x.com/${handle}` : `https://${v}`;
  if (kind === "telegram") return /^[\w.]+$/.test(handle) ? `https://t.me/${handle}` : `https://${v}`;
  return `https://${v}`;
}

export type AsepadConfig = {
  configured: boolean;
  contract?: string;
  config?: {
    creationFeeWei?: string;
    feeBps?: string;
    targetWei?: string;
    creatorBps?: string;
    virtualAseWei?: string;
    treasury?: string;
    aseDex?: string;
    testnet?: boolean;
    heldWei?: string;
    reserveTotalWei?: string;
    paused?: boolean;
  };
  paused?: boolean;
  aseUsd?: number;
  aseUsdSource?: "on-chain" | "configured" | "fallback";
};

export const asepadGetConfig = async (): Promise<AsepadConfig> => {
  // AWS only — /api/stats.config carries the pad contract's `config` view,
  // cached server-side by the indexer's 60s chainStatsTick.
  const s = await apiStats().catch(() => null) as { config?: Record<string, unknown> } | null;
  const raw = s?.config ?? {};
  // Priority: on-chain owner-set rate → env → default. The contract's
  // aseUsdScaled is fixed-point 6 decimals (3418000 = $3.418).
  const onChain = safeBig(String(raw.aseUsdScaled ?? "0"));
  const env = Number(process.env.NEXT_PUBLIC_ASE_USD_RATE || "0");
  // Sane band — a stale persisted config once served $0.000334/ASE and every
  // USD cell silently went 10,000x small ($0.0018 spot rendered as $0.0₆17).
  // ASE can't honestly sit outside a few orders of the reference rate, so an
  // out-of-band source falls through to the env/default rather than poison.
  const sane = (v: number) => v > 0.05 && v < 500;
  const onChainUsd = Number(onChain) / 1e6;
  return {
    configured: Boolean(ASEPAD_CONTRACT), contract: ASEPAD_CONTRACT,
    config: raw as AsepadConfig["config"], paused: Boolean(raw.paused),
    aseUsd: onChain > 0n && sane(onChainUsd) ? onChainUsd : env > 0 && sane(env) ? env : 3.418,
    aseUsdSource: onChain > 0n && sane(onChainUsd) ? "on-chain" : env > 0 && sane(env) ? "configured" : "fallback"
  };
};

export type AsepadLaunchList = {
  launches: AsepadLaunch[]; total: number; cursor: number; targetWei: string;
  configured: boolean;
  /** True on streamed partial emissions — the sweep hasn't finished. */
  partial?: boolean;
};
export type AsepadCandle = { time: number; open: number; high: number; low: number; close: number; volume: number };
export type AsepadCandleData = { intervalSec: number; priceBasis: "indexed-execution"; historyLimited: boolean; candles: AsepadCandle[] };
export type AsepadHolder = { address: string; balance: string; tag?: "dev" | "bonding curve" | "asedex" | "burn"; shareBps: number };
export type AsepadHolderData = { holders: AsepadHolder[]; count: number; supply: string };
export type AsepadLaunchDetail = {
  launch: AsepadLaunch & { targetWei: string };
  price: string;
  config: NonNullable<AsepadConfig["config"]>;
  meta: AsepadLaunch["meta"];
  lpBurned: boolean;
  aseDexPoolId: string | null;
  migration: {
    status: string; migrationStage: string; aseDexPoolId: string; lpSharesBurned: string;
    creatorRewardWei: string; liquidityAseWei: string; liquidityTokenWei: string;
    finalPriceWei: string; finalMarketCapWei: string; creatorRewardPaid: boolean;
  };
  volume: { buyVolumeWei: string; sellVolumeWei: string; totalVolumeWei: string; buyCount: string; sellCount: string; tradeCount: string };
  trades: AsepadTrade[];
};

// Bounded parallel map — a launch list is ~50 view calls; unbounded Promise.all
// bursts are what trips the node rate limiter.
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) { const i = cursor++; out[i] = await fn(items[i]!); }
  });
  await Promise.all(lanes);
  return out;
}
// In-session snapshots → instant paint when a filter/tab remounts or the user
// navigates back from a token page.
const launchListCache = new Map<string, { at: number; out: AsepadLaunchList }>();
export const asepadPeekLaunches = (filter: string, q?: string) => launchListCache.get(`${filter}|${q ?? ""}`)?.out;

// ONE shared scan feeds every filter tab: switching Just Launched → Trending →
// Near Bonding → Migrated reuses the same records instead of re-reading the
// chain. The 10s memo also dedupes back-to-back invalidations (a block + a
// wallet tx landing together still costs a single sweep).
type LaunchListener = (launch: AsepadLaunch) => void;
const ALL_LAUNCHES_TTL = 30_000;
let allLaunchesMemo: {
  at: number; p: Promise<AsepadLaunch[]>; done: boolean;
  listeners: Set<LaunchListener>; resolved: AsepadLaunch[];
} | null = null;
function fetchAllLaunches(onLaunch?: LaunchListener): Promise<AsepadLaunch[]> {
  // Attach while the sweep is in flight no matter its age — a second sweep's
  // bulk reads would FIFO-queue behind the first's pending jobs, leaving a
  // newly clicked tab empty for tens of seconds. Mid-sweep attaches replay
  // everything resolved so far, then hear the rest live.
  if (allLaunchesMemo && (!allLaunchesMemo.done || Date.now() - allLaunchesMemo.at < ALL_LAUNCHES_TTL)) {
    if (onLaunch) {
      allLaunchesMemo.resolved.forEach(onLaunch);
      allLaunchesMemo.listeners.add(onLaunch);
    }
    return allLaunchesMemo.p;
  }
  const listeners = new Set<LaunchListener>(onLaunch ? [onLaunch] : []);
  const resolved: AsepadLaunch[] = [];
  const p = loadAllLaunches((launch) => {
    resolved.push(launch);
    listeners.forEach((fn) => fn(launch));
  });
  allLaunchesMemo = { at: Date.now(), p, done: false, listeners, resolved };
  void p.finally(() => { if (allLaunchesMemo?.p === p) { allLaunchesMemo.done = true; allLaunchesMemo.listeners = new Set(); } });
  // A rejected sweep must not stick in the memo — drop it so the next caller
  // starts a fresh scan instead of replaying the same failure for 10s.
  p.then(() => { }, () => { if (allLaunchesMemo?.p === p) allLaunchesMemo = null; });
  return p;
}
// Per-launch record cache — this is what keeps refresh cheap. A MIGRATED or
// RECOVERED record is immutable on-chain (status, reserves, timestamps never
// change again) so it's served from memory forever; only BONDING and BONDED
// records — the ones a trade or migration can still mutate — re-read on each
// sweep. Without this every 20s refresh re-read getLaunch for ALL launches
// through the 4-wide RPC gate and permanently starved every other read.
const launchRecordCache = new Map<string, { at: number; immutable: boolean; launch: AsepadLaunch }>();
const LIVE_RECORD_TTL = 15_000;
// The sweep's canonical record map — hydrated from disk once, then kept live.
const sweepRecords = new Map<string, AsepadLaunch>();
/** Every launch token the persistent sweep has ever seen — survives reloads
 *  via the rec map, so callers can enumerate pad tokens with zero RPC. */
export function asepadKnownTokens(): string[] {
  return [...new Set([...Object.keys(padStoreRead().rec), ...sweepRecords.keys()])];
}
/** Sweep cursor — indexes above this have never been enumerated. */
export function asepadSweepCursor(): string { return padStoreRead().sweptUpTo; }
let sweepHydrated = false;
/** A record the UI can fully paint — identity + supply. DB rows from a shard
 *  without token meta synthesize blanks; those must never replace or stand in
 *  for a chain record. */
const completeLaunch = (l?: AsepadLaunch) =>
  !!l?.token && !!(l.name || l.symbol) && safeBig(l.totalSupply ?? l.supply ?? "0") > 0n;
const STATUS_RANK: Record<string, number> = { BONDING: 0, BONDED: 1, MIGRATING: 2, MIGRATED: 3, RECOVERED: 3 };
function hydrateSweep() {
  if (sweepHydrated) return;
  sweepHydrated = true;
  const { rec } = padStoreRead();
  for (const [k, raw] of Object.entries(rec)) {
    const j = parseJson<Record<string, unknown>>(raw, {});
    // Drop persisted event records — a Trade record stored under curve_json
    // maps to a nameless zeroed card and would shadow real reads for sweeps.
    if (!j.token || "isBuy" in j || "kind" in j || "trader" in j) { delete rec[k]; continue; }
    const launch = mapLaunch(j);
    // Blank DB-seed synth (no name/supply) persisted by an older build — it
    // shadowed the real chain record. Drop it and queue a chain re-read.
    if (launch.token && !completeLaunch(launch)) { delete rec[k]; dirtyTokens.add(k); continue; }
    if (launch.token) {
      sweepRecords.set(k, launch);
      launchRecordCache.set(k, { at: Date.now(), immutable: launch.status === "MIGRATED" || launch.status === "RECOVERED", launch });
    }
  }
}
function cacheLaunchRecord(launch: AsepadLaunch, raw: unknown) {
  if (!launch.token) return;
  const key = launch.token.toLowerCase();
  const immutable = launch.status === "MIGRATED" || launch.status === "RECOVERED";
  launchRecordCache.set(key, { at: Date.now(), immutable, launch });
  sweepRecords.set(key, launch);
  // All records persist — the sweep cursor only covers what actually
  // enumerated, and a stale bonding record is still a better paint than none
  // (it re-reads when its event lands or it enters the freshness window).
  padStoreRead().rec[key] = slimRaw(raw);
  padStoreWrite();
}
// Synchronous peek at a warm launch record — the dex burn/rank UI reads
// lpBurned/status this way instead of waiting on the sharesOf sweep.
export const asepadPeekLaunchRecord = (token: string): AsepadLaunch | undefined =>
  launchRecordCache.get(token.toLowerCase())?.launch ?? sweepRecords.get(token.toLowerCase());
// Fast "latest N" path — the full sweep is overkill when a view only needs
// the freshest launches (landing strip). One launchCount read + one batched
// getLaunchById POST covers it; resolved records still seed the shared cache.
export async function asepadGetLatestLaunches(n = 40): Promise<AsepadLaunch[]> {
  // AWS only — the indexer orders newest-first, so one read replaces the
  // launchCount + getLaunchById enumeration this used to do.
  const api = await apiLaunches("all", n, true).catch(() => null);
  const rows = api?.launches ?? [];
  let targetWei = "0";
  for (const row of rows) {
    const tw = parseJson<Record<string, unknown>>(row.curve_json, {}).targetWei;
    if (tw != null) { targetWei = String(tw); break; }
  }
  const out: AsepadLaunch[] = [];
  for (const row of rows) {
    const cj = parseJson<Record<string, unknown>>(row.curve_json, {});
    const shaped = cj.token && !("isBuy" in cj) && !("kind" in cj) && !("trader" in cj);
    const raw = shaped
      ? { ...cj, name: cj.name ?? row.name ?? undefined, symbol: cj.symbol ?? row.symbol ?? undefined,
          creator: cj.creator ?? row.creator ?? undefined, meta: cj.meta ?? row.meta_json ?? undefined,
          aseReserve: cj.aseReserve ?? row.raised_wei ?? undefined, tokenReserve: cj.tokenReserve ?? row.sold_supply ?? undefined,
          status: row.status === "migrated" ? "MIGRATED" : cj.status,
          aseDexPoolId: cj.aseDexPoolId ?? (row.migration_pool ? String(row.migration_pool).split(":")[1] : undefined),
          lpSharesBurned: cj.lpSharesBurned ?? (row.status === "migrated" ? "1" : undefined) }
      : { token: row.token, creator: row.creator ?? "", name: row.name ?? "", symbol: row.symbol ?? "",
          createdTs: row.created_ts ? String(row.created_ts) : "0",
          meta: parseJson(row.meta_json, null) ?? (row.logo_url ? { logoUrl: row.logo_url } : null),
          aseReserve: row.raised_wei ?? "0", tokenReserve: row.sold_supply ?? "0", targetWei,
          status: row.status === "migrated" ? "MIGRATED" : row.status === "nearing" ? "BONDED" : "BONDING",
          volumeWei: row.vol_ase ? String(Math.round(Number(row.vol_ase))) : "0", totalSupply: "0" };
    const launch = mapLaunch(raw);
    if (launch.token) { cacheLaunchRecord(launch, JSON.stringify(raw)); out.push(launch); }
  }
  return out;
}
const dirtyTokens = new Set<string>(); // live-chain events flag these for re-read
// Tokens with a pad event this session — the signal an all-time-volume cut
// can't give trending: a sleeper that just started trading belongs in the
// scored pool even while its lifetime volumeWei is still small.
const recentActivity = new Map<string, number>();
const missedIdx: string[] = []; // indexes whose sweep read failed — retried next sweep
// Index→token is immutable: once an index maps to a launch (seed row or
// chain read) it never needs enumerating again. Persisted across sweeps —
// re-deriving it per sweep is what made every 30s tick walk all 16k indices.
const coveredIdxCache = new Set<string>();
let mutableTailCursor = 0; // rolling re-read window over older live curves
let lastTailSweepAt = 0; // tail re-reads rotate every 2min, not every sweep
let lastHeadSweepAt = 0; // newest-96 re-read every minute — live events patch between sweeps
let lastApiSeedAt = 0; // throttles the DB freshness read inside the sweep
function loadLaunchSnapshot(): Promise<number> {
  // Snapshot path retired — the unified AWS API is the live feed now.
  return Promise.resolve(-1);
}

// API launch row → raw record for mapLaunch. Shared by the sweep seed and the
// server-paged board fetch. curve_json is only usable when it holds a
// getLaunch-shaped record — historical rows stored raw Trade/LaunchCreated
// EVENTS there (isBuy/kind/trader = trade record; no meta+status = event
// record). Non-launch rows synthesize from the indexed columns instead.
function launchRowRaw(row: Record<string, unknown>, targetWei: string): Record<string, unknown> {
  const cj = parseJson<Record<string, unknown>>(row.curve_json, {});
  const launchShaped = cj.token && !("isBuy" in cj) && !("kind" in cj) && !("trader" in cj)
    && (cj.name != null || cj.meta != null || cj.aseReserve != null || cj.totalSupply != null);
  return launchShaped
    ? {
        ...cj,
        // Indexed columns fill whatever the record lacks — never overwrite
        // fields the record already carries.
        name: cj.name ?? row.name ?? undefined, symbol: cj.symbol ?? row.symbol ?? undefined,
        creator: cj.creator ?? row.creator ?? undefined,
        createdTs: cj.createdTs ?? (row.created_ts ? String(row.created_ts) : undefined),
        meta: cj.meta ?? row.meta_json ?? (row.logo_url ? { logoUrl: row.logo_url } : undefined),
        aseReserve: cj.aseReserve ?? row.raised_wei ?? undefined,
        tokenReserve: cj.tokenReserve ?? row.sold_supply ?? undefined,
        // Row status outranks a stale curve_json snapshot — the indexer
        // historically updated only columns on MigrationCompleted.
        status: row.status === "migrated" ? "MIGRATED" : cj.status,
        aseDexPoolId: cj.aseDexPoolId ?? (row.migration_pool ? String(row.migration_pool).split(":")[1] : undefined),
        lpSharesBurned: cj.lpSharesBurned ?? (row.status === "migrated" ? "1" : undefined),
        // Indexed pad-trade rollup fills volume the record never captured.
        volumeWei: cj.volumeWei ?? cj.volume ?? (row.vol_ase ? String(Math.round(Number(row.vol_ase))) : undefined)
      }
    : {
        token: row.token, creator: row.creator ?? "", name: row.name ?? "", symbol: row.symbol ?? "",
        createdTs: row.created_ts ? String(row.created_ts) : "0",
        meta: parseJson(row.meta_json, null) ?? (row.logo_url ? { logoUrl: row.logo_url } : null),
        aseReserve: row.raised_wei ?? "0", tokenReserve: row.sold_supply ?? "0",
        targetWei,
        status: row.status === "migrated" ? "MIGRATED" : row.status === "nearing" ? "BONDED" : "BONDING",
        aseDexPoolId: row.migration_pool ? String(row.migration_pool).split(":")[1] : null,
        volumeWei: row.vol_ase ? String(Math.round(Number(row.vol_ase))) : "0",
        totalSupply: "0"
      };
}

// Server-paged launch board: one page of rows per fetch — the whole directory
// (17k launches ≈ 40MB of curve_json) never lands in the browser. Tab filters
// map to handler state/minp/sort params so totals and page counts are real.
export const asepadGetLaunchesPaged = async (
  filter: string, search: string, page: number, perPage: number, targetWei: string
): Promise<{ launches: AsepadLaunch[]; total: number }> => {
  const q = normalizeSearch(search);
  const parts: string[] = [];
  if (filter === "near") parts.push("state=bonding", "minp=6000", "sort=progress");
  else if (filter === "bonding") parts.push("state=bonding", "minp=100", "sort=reserve");
  else if (filter === "migrated") parts.push("state=migrated", "sort=migrated");
  else parts.push("state=new");
  if (q) parts.push(`q=${encodeURIComponent(q)}`);
  parts.push(`limit=${perPage}`, `offset=${(Math.max(1, page) - 1) * perPage}`, "slim=1");
  const d = await apiLaunchPage(parts.join("&")).catch(() => null);
  const launches: AsepadLaunch[] = [];
  for (const row of d?.launches ?? []) {
    const l = mapLaunch(launchRowRaw(row as unknown as Record<string, unknown>, targetWei));
    if (l.token) launches.push(l);
  }
  return { launches, total: d?.total ?? 0 };
};

// Trending tape: rank by the indexer's pad 24h rollup (same source the old
// client-side sort used), then batch-resolve just those launches — ~2 calls
// instead of the full directory sweep.
export const asepadGetTrending = async (targetWei: string): Promise<AsepadLaunch[]> => {
  const api = await apiTrending().catch(() => null);
  const ranked = (api?.pad ?? [])
    .map((r) => ({ token: String(r.token ?? "").toLowerCase(), v: Number(r.v) || 0 }))
    .filter((r) => r.token && r.v > 0)
    .sort((a, b) => b.v - a.v)
    .slice(0, 20);
  if (!ranked.length) return [];
  const d = await apiLaunchPage(`state=all&tokens=${ranked.map((r) => r.token).join(",")}&limit=20&slim=1`).catch(() => null);
  const vol = new Map(ranked.map((r) => [r.token, r.v]));
  const out: AsepadLaunch[] = [];
  for (const row of d?.launches ?? []) {
    const l = mapLaunch(launchRowRaw(row as unknown as Record<string, unknown>, targetWei));
    if (!l.token || l.status !== "BONDING") continue;
    l.vol24Wei = String(Math.round(vol.get(l.token.toLowerCase()) ?? 0));
    out.push(l);
  }
  return out.sort((a, b) => Number(b.vol24Wei) - Number(a.vol24Wei));
};

async function loadAllLaunches(notify?: LaunchListener): Promise<AsepadLaunch[]> {
  hydrateSweep();
  // Disk first: the persisted directory paints the board before ANY network
  // call — snapshot, API and chain reads below only patch it. Waiting on
  // launchCount + the DB seed + the first sweep batch is what left reloads
  // blank for 20s+.
  if (notify) for (const l of sweepRecords.values()) notify(l);
  const before = sweepRecords.size;
  const snapCount = await loadLaunchSnapshot();
  if (notify && sweepRecords.size !== before) for (const l of sweepRecords.values()) notify(l);
  // The ~10k-row full seed is a cold-start path ONLY: a mounted page
  // re-pulling it every 20s would scan the whole launches table per call and
  // burn the D1 read quota. Covered clients take a 500-row refresh seed,
  // throttled to one read a minute. Seed + count run in parallel.
  const cold = sweepRecords.size === 0 || lastApiSeedAt === 0;
  // Cold load pulls the whole set; every later call only needs the newest
  // slice (blocks are seconds apart — new launches/status flips always sit at
  // the top). The rev push then updates the board the moment AWS commits.
  const seedP = apiLaunches("all", cold ? 50000 : 800, true).catch(() => null);
  lastApiSeedAt = Date.now();
  // AWS is authoritative end-to-end — no launchCount read, no getLaunchById
  // enumeration, no mutable getLaunch refresh. The indexer sees every launch
  // and streams the same curve_json record the sweep used to fetch.
  const coveredIdx = new Set<string>(coveredIdxCache);
  if (seedP) {
    const api = await seedP;
    // targetWei lives inside curve_json — pull it off any launch-shaped row
    // instead of the chain config read this used to make.
    let targetWei = "0";
    for (const row of api?.launches ?? []) {
      const tw = parseJson<Record<string, unknown>>(row.curve_json, {}).targetWei;
      if (tw != null) { targetWei = String(tw); break; }
    }
    for (const row of api?.launches ?? []) {
      const key = String(row.token ?? "").toLowerCase();
      const prev = key ? sweepRecords.get(key) : undefined;
      const raw = launchRowRaw(row as Record<string, unknown>, targetWei);
      let launch = mapLaunch(raw);
      if (!launch.token) continue;
      // The API row is the live record — its curve fields (reserve, progress,
      // status, volume) always win over the persisted copy so a card can never
      // freeze on an older reserve. Identity fields fall back to the cached
      // record only where this row left them blank.
      if (completeLaunch(prev)) {
        launch = {
          ...prev, ...launch,
          name: launch.name || prev!.name, symbol: launch.symbol || prev!.symbol,
          totalSupply: launch.totalSupply || prev!.totalSupply,
          meta: launch.meta ?? prev!.meta,
        };
      }
      // Complete rows persist + cover their index. Blank rows paint (better
      // than a skeleton) but stay memory-only and uncovered, so the chain
      // sweep below still reads the real record for that index.
      if (completeLaunch(launch)) {
        if (row.idx != null) { coveredIdx.add(String(row.idx)); coveredIdxCache.add(String(row.idx)); }
        cacheLaunchRecord(launch, JSON.stringify(raw));
      } else {
        sweepRecords.set(key, launch);
        dirtyTokens.add(key);
      }
      notify?.(launch);
    }
  }
  padStoreWrite();
  return [...sweepRecords.values()];
}

// Search haystack covers everything a user can paste: name, $ticker, the 0x
// contract AND its ase1 form, plus the creator in both encodings.
const ase1Of = (v?: string) => {
  try { return /^0x[0-9a-fA-F]{40}$/.test(String(v)) ? String(toAseAddress(String(v))) : ""; } catch { return ""; }
};
const launchHaystack = (l: AsepadLaunch) =>
  `${l.name} ${l.symbol} ${l.token} ${l.creator} ${ase1Of(l.token)} ${ase1Of(l.creator)}`.toLowerCase();
/** "$honk" → "honk"; ase1/0x stay literal since the haystack carries both. */
const normalizeSearch = (raw?: string) => (raw ?? "").trim().toLowerCase().replace(/^\$+/, "");

const weiCmp = (a?: string, b?: string) => {
  const x = safeBig(a || "0"), y = safeBig(b || "0");
  return y > x ? 1 : y < x ? -1 : 0;
};
// Deterministic ordering: primary-key ties (missing createdTs, equal
// progressBps/volume) fall back to token address. Without it the streamed
// partials re-sort by whichever record resolved first and boundary tokens
// visibly bounce in and out of page 1 — the "coming and going" flicker.
const tokenCmp = (a: AsepadLaunch, b: AsepadLaunch) =>
  a.token < b.token ? -1 : a.token > b.token ? 1 : 0;
const byNum = (key: (l: AsepadLaunch) => string | number | undefined) =>
  (a: AsepadLaunch, b: AsepadLaunch) => weiCmp(String(key(a) ?? "0"), String(key(b) ?? "0")) || tokenCmp(a, b);

// The last computed 24h ranking — kept module-level so mid-sweep partial emits
// order by the REAL trending metric instead of all-time volumeWei (which is
// what made the board visibly reshuffle when the scored list landed).
const lastVol24 = new Map<string, bigint>();
const VOL24_STORE_KEY = "asepad:vol24";
// Seed from disk so a *cold* load (fresh tab, no in-memory map yet) still
// orders by the last-known 24h ranking — otherwise every reload flashes the
// all-time order until the scoring pass lands. Stale past 6h is still a
// better approximation of "hot now" than all-time volume.
// Today's UTC-day start — retained for the persisted-map freshness guard and
// the token page's "volume today" figure; the trending board itself ranks on
// a rolling 24h window (see scoreVol24) matching the "24h vol" label.
export const utcDayStart = () => new Date().setUTCHours(0, 0, 0, 0);
if (typeof window !== "undefined") {
  try {
    const raw = JSON.parse(localStorage.getItem(VOL24_STORE_KEY) || "null") as { at?: number; d?: number; m?: [string, string][] } | null;
    // Only same-UTC-day values may seed — yesterday's map isn't a hint, it's
    // a lie (the window reset at midnight).
    if (raw?.d === utcDayStart())
      for (const [k, v] of raw.m ?? []) lastVol24.set(k, BigInt(v));
  } catch { }
}
const persistVol24 = (m: Map<string, bigint>) => {
  try { localStorage.setItem(VOL24_STORE_KEY, JSON.stringify({ at: Date.now(), d: utcDayStart(), m: [...m].map(([k, v]) => [k, v.toString()]) })); } catch { }
};
// Synchronous filter + order — applied to every partial emission so streamed
// launches land in the right bucket and order from the first card.
// Trending uses the warm vol24 map; cold first load falls back to all-time
// volume until the scored ranking lands.
function shapeLaunches(launches: AsepadLaunch[], filter: string, search: string): AsepadLaunch[] {
  let filtered = launches.filter((launch) => {
    if (filter === "bonding" && launch.status !== "BONDING") return false;
    if (filter === "migrated" && launch.status !== "MIGRATED") return false;
    // Just Launched, Trending and Near Bonding only carry live bonding curves —
    // anything bonded/migrating/migrated trades on AseDex and belongs to Migrated.
    if ((filter === "new" || filter === "trending" || filter === "near") && launch.status !== "BONDING") return false;
    if (search && !launchHaystack(launch).includes(search)) return false;
    return true;
  });
  if (filter === "new") filtered = filtered.sort(byNum((l) => l.createdTs));
  if (filter === "trending") {
    filtered = [...filtered].sort((a, b) => {
      const va = lastVol24.get(a.token.toLowerCase()), vb = lastVol24.get(b.token.toLowerCase());
      if (va !== undefined || vb !== undefined) {
        const d = (vb ?? 0n) > (va ?? 0n) ? 1 : (vb ?? 0n) < (va ?? 0n) ? -1 : 0;
        if (d) return d;
      }
      return weiCmp(a.volumeWei || a.volume, b.volumeWei || b.volume) || tokenCmp(a, b);
    }).slice(0, 20);
    // Stamp the last-known 24h figure on each row so cards render the real
    // metric instantly — the scored pass re-stamps with fresh values when it
    // lands, and HOT badges key off this field so they only show on scored rows.
    for (const l of filtered) {
      const v = lastVol24.get(l.token.toLowerCase());
      if (v !== undefined) l.vol24Wei = v.toString();
    }
  }
  if (filter === "near") {
    filtered = filtered.filter((l) => (l.progressBps || 0) >= 6000)
      .sort((a, b) => (b.progressBps || 0) - (a.progressBps || 0) || tokenCmp(a, b));
  }
  // Bonding board requires real curve activity — a launch with zero buys
  // (progress under 1%) doesn't list until its first purchase lands.
  if (filter === "bonding") filtered = filtered.filter((l) => (l.progressBps || 0) >= 100).sort(byNum((l) => l.reserve));
  if (filter === "migrated") filtered = filtered.sort(byNum((l) => l.migratedTs || l.createdTs));
  return filtered;
}

// Latest-writer-wins per list: a refetch can attach a second emit stream to
// the same shared sweep while the first is still streaming — the older
// stream's smaller partial map would then overwrite newer data (the residual
// flicker). Only the newest call for a given filter+search may emit.
const emitSeq = new Map<string, number>();

const DAY_MS = 24 * 60 * 60_000;
// Trending candidate pool: top-150 by all-time volume (so a token ranked
// ~51st can still break in on a hot day) PLUS session-observed active curves
// and fresh launches (<6h) — the two groups the all-time cut alone starves.
function trendingCandidates(list: AsepadLaunch[], search: string, now: number): AsepadLaunch[] {
  const top = list
    .filter((l) => l.status === "BONDING" && (!search || launchHaystack(l).includes(search)))
    .sort(byNum((l) => l.volumeWei || l.volume))
    .slice(0, 150);
  for (const [tk, ts] of recentActivity) if (now - ts > DAY_MS) recentActivity.delete(tk);
  const inPool = new Set(top.map((l) => l.token.toLowerCase()));
  const extras = list.filter((l) =>
    l.status === "BONDING" && !inPool.has(l.token.toLowerCase()) &&
    (!search || launchHaystack(l).includes(search)) &&
    (recentActivity.has(l.token.toLowerCase()) || now - Number(l.createdTs || "0") < 6 * 60 * 60_000));
  return [...top, ...extras];
}

// recentTrades for every candidate — warm memo hits are free, misses ride one
// chunked JSON-RPC batch on the wallet lane (a user-visible board ranks ahead
// of background enumeration, behind direct clicks).
// The DB trending aggregate (indexed Trade events, rolling 24h, EVERY token)
// seeds the map — the chain pass then max-merges its candidates on top, so a
// partial indexer can only under-report, never over-rank.
const scoreVol24 = async (_candidates: AsepadLaunch[]): Promise<Map<string, bigint>> => {
  // apiTrending is authoritative — the indexer's pad_trade rollup already
  // carries the rolling 24h window. No per-token recentTrades chain batch:
  // an absent indexer yields an empty map, not a 150-read storm.
  const api = await apiTrending().catch(() => null);
  const vol24 = new Map<string, bigint>();
  for (const r of api?.pad ?? []) {
    if (r.token) vol24.set(String(r.token).toLowerCase(), safeBig(Math.round(Number(r.v) || 0)));
  }
  return vol24;
};

export const asepadGetLaunches = async (
  filter: string, q?: string, cursor = 0,
  onPartial?: (out: AsepadLaunchList) => void,
  seed?: AsepadLaunch[]
): Promise<AsepadLaunchList> => {
  const search = normalizeSearch(q);
  const seqKey = `${filter}|${search}`;
  const mySeq = (emitSeq.get(seqKey) ?? 0) + 1;
  emitSeq.set(seqKey, mySeq);
  // Progressive paint: each resolved launch streams through the shape pipeline
  // and into the query cache — the grid fills card-by-card instead of sitting
  // on skeletons for the whole sweep. When a previous list exists it's seeded
  // in and records update IN PLACE as fresh versions resolve — the refresh
  // replaces rows one by one instead of shrinking then regrowing.
  const partials = new Map<string, AsepadLaunch>((seed ?? []).map((l) => [l.token.toLowerCase(), l]));
  // `alive` gates emissions: the listener stays attached to the shared sweep
  // even after this call resolves, and without the gate a late notify would
  // overwrite the final result with a partial:true state — visible flicker.
  let alive = true;
  // Throttle commits — up to 500 resolves shouldn't mean 500 re-renders.
  // ~8 commits/sec still reads as items streaming in one by one. A trailing
  // flush is required, not just leading: mid-sweep attaches replay the whole
  // resolved set synchronously, so every emit after the first hits the
  // throttle window — without the trailing commit the replayed records sit
  // in `partials` invisible until the next live resolve lands.
  let lastEmit = 0;
  let lastSig = "";
  // Adaptive commit gap: shaping sorts the whole board (~11k records with a
  // full snapshot) — gap stays ≥3× the last commit's cost so streaming can
  // never monopolize the main thread.
  let emitGap = 120;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const commitPartial = () => {
    const c0 = performance.now();
    lastEmit = Date.now();
    const shaped = shapeLaunches([...partials.values()], filter, search);
    // No-op sweep guard — a 20s re-probe that changed nothing must not touch
    // the query cache at all: the grid keeps its card instances (no repaint
    // churn) and only real arrivals/updates cause a render. The signature
    // encodes order + every field a card can display.
    const sig = shaped.map((l) => `${l.token}:${l.status}:${l.createdTs}:${l.progressBps ?? ""}:${l.reserve}:${l.volume}:${l.vol24Wei ?? ""}:${l.tradeCount ?? ""}:${l.lpBurned ? 1 : 0}:${l.meta?.logoUrl ?? ""}`).join("|");
    emitGap = Math.max(120, Math.round((performance.now() - c0) * 3));
    if (sig === lastSig) return;
    lastSig = sig;
    onPartial!({
      launches: shaped, total: shaped.length, cursor: cursor + shaped.length,
      targetWei: String(partials.values().next().value?.targetWei || "0"),
      configured: Boolean(ASEPAD_CONTRACT),
      partial: true
    });
  };
  const emit = onPartial && ((launch: AsepadLaunch) => {
    if (!alive || emitSeq.get(seqKey) !== mySeq) return;
    partials.set(launch.token.toLowerCase(), launch);
    const gap = Date.now() - lastEmit;
    if (gap >= emitGap) commitPartial();
    else if (!flushTimer) flushTimer = setTimeout(() => {
      flushTimer = null;
      if (alive && emitSeq.get(seqKey) === mySeq) commitPartial();
    }, emitGap - gap);
  });
  // Trending: fire the 24h scoring pass NOW against the persisted record
  // snapshot — the ~150 trades calls then overlap the directory sweep instead
  // of queueing behind it. After the sweep, only candidates the early pass
  // missed get scored (usually none — the all-time top-150 barely churns).
  const scoreNow = Date.now();
  let earlyScore: Promise<Map<string, bigint>> | undefined;
  let earlyTokens: Set<string> | undefined;
  if (filter === "trending") {
    hydrateSweep(); // populate sweepRecords from the persisted directory first
    const snap = trendingCandidates([...sweepRecords.values()], search, scoreNow);
    earlyTokens = new Set(snap.map((l) => l.token.toLowerCase()));
    earlyScore = scoreVol24(snap);
  }
  const launches = await fetchAllLaunches(emit ?? undefined);
  alive = false; // sweep done — this caller's stream is finished
  // Merge fresh records over the seed: a single dropped launchAt/getLaunch
  // read must not make a card vanish for a sweep and pop back next cycle —
  // the last known record stands in until the next read succeeds.
  const merged = new Map<string, AsepadLaunch>();
  for (const l of seed ?? []) merged.set(l.token.toLowerCase(), l);
  for (const l of launches) merged.set(l.token.toLowerCase(), l);
  const mergedList = [...merged.values()];
  let filtered = shapeLaunches(mergedList, filter, search);
  if (filter === "trending") {
    // 24h-volume ranking — highest rolling-day volume on top, lowest at the
    // bottom, capped at 12 slots (every board slot carries a HOT tag). No buy-pressure/holder/buyer criteria: a
    // live quiet token ranks low rather than dropping out, and rank churn is
    // pure volume — a token drops off the board the moment others out-trade it.
    // Recomputed on every focused refresh. The heavy scoring already overlapped
    // the sweep (earlyScore) — here we only cover candidates the snapshot
    // missed, then merge the two maps.
    const now = Date.now();
    const candidates = trendingCandidates(mergedList, search, now);
    const extras = candidates.filter((l) => !earlyTokens?.has(l.token.toLowerCase()));
    const [base = new Map<string, bigint>(), extraVol] = await Promise.all([
      earlyScore,
      extras.length ? scoreVol24(extras) : Promise.resolve(new Map<string, bigint>())
    ]);
    const vol24 = new Map<string, bigint>([...base, ...extraVol]);
    // Feed the module ranking map so later partial emits keep this order.
    lastVol24.clear();
    for (const [k, v] of vol24) lastVol24.set(k, v);
    persistVol24(vol24);
    // Rank EVERY bonding launch — the DB aggregate already covered the tail
    // the ~150 chain-scored candidates couldn't reach, so a mid-cap token on
    // a hot day can break in instead of being invisible to the scorer.
    filtered = mergedList
      .filter((l) => l.status === "BONDING" && (!search || launchHaystack(l).includes(search)))
      .sort((a, b) => {
      const va = vol24.get(a.token.toLowerCase()) ?? 0n, vb = vol24.get(b.token.toLowerCase()) ?? 0n;
      // Quiet ties (mostly the 0-vol tail) rank by lifetime volume, not address
      // order — an established-but-quiet token reads more honestly than an
      // arbitrary alphabetical fill.
      return vb > va ? 1 : vb < va ? -1 : (weiCmp(a.volumeWei || a.volume, b.volumeWei || b.volume) || tokenCmp(a, b));
    }).slice(0, 20);
    // Stamp the rank metric on each row — the card shows "24h vol" instead of
    // all-time volume so the order on the board is self-evident.
    for (const l of filtered) l.vol24Wei = (vol24.get(l.token.toLowerCase()) ?? 0n).toString();
  }
  const targetWei = String(filtered[0]?.targetWei || "0");
  const out: AsepadLaunchList = { launches: filtered, total: filtered.length, cursor: cursor + filtered.length, targetWei, configured: Boolean(ASEPAD_CONTRACT) };
  launchListCache.set(`${filter}|${q ?? ""}`, { at: Date.now(), out });
  return out;
};

// ── event-driven cache pushes ──────────────────────────────────────────────
// live-chain scans each block's receipts: a pad event busts only the caches
// that event can move and patches mounted list queries directly — the UI
// shows the event instantly instead of waiting for the next sweep interval.

/** A Trade/Buy/Sell (or any launch-mutating event) landed for `token`: force
 *  its record, recent-trades and holder-count caches to re-read on the next
 *  fetch — otherwise their TTLs would hide the event for up to 30s. */
export function asepadNoteEvent(token: string) {
  const k = token.toLowerCase();
  launchRecordCache.delete(k);
  dirtyTokens.add(k); // next sweep re-reads it even if outside the freshness window
  recentActivity.set(k, Date.now());
  for (const key of [...recentTradesMemo.keys()]) if (key.startsWith(`${k}|`)) recentTradesMemo.delete(key);
  holderCountMemo.delete(k);
}

/** LaunchCreated → read the record and merge it into every mounted
 *  asepad-launches query (key[1]=filter, key[2]=search) — the new card
 *  appears in under a second, without waiting for the sweep. The record read
 *  retries: a 429 on the first attempt right after the event would otherwise
 *  drop the instant path entirely. Feeding the launch into the sweep's live
 *  listener bus keeps it sticky — an in-flight emit built from a pre-launch
 *  index snapshot would otherwise re-emit a list without it. */
export async function asepadPushLaunch(qc: QueryClient, token: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    // AWS launch row — the indexer's curve_json hydrates within a tick of
    // LaunchCreated; retries cover the commit gap instead of a chain read.
    const row = await apiLaunches(`all&q=${token}`, 1).then((d) => d?.launches?.[0] as Record<string, unknown> | undefined).catch(() => null);
    const raw = row ? { ...parseJson<Record<string, unknown>>(row.curve_json, {}), ...(row.status ? { status: String(row.status).toUpperCase() } : {}), token: row.token ?? token, meta: row.meta_json ?? undefined } : null;
    const launch = raw ? mapLaunch(raw) : null;
    if (!launch?.token) {
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
      continue;
    }
    for (const [key, old] of qc.getQueriesData<AsepadLaunchList>({ queryKey: ["asepad-launches"] })) {
      if (!old?.launches) continue;
      const filter = String(key[1] ?? "new"), search = String(key[2] ?? "");
      const merged = new Map(old.launches.map((l) => [l.token.toLowerCase(), l] as const));
      merged.set(launch.token.toLowerCase(), launch);
      const shaped = shapeLaunches([...merged.values()], filter, search);
      qc.setQueryData(key, { ...old, launches: shaped, total: shaped.length });
    }
    // Keep the row inside any in-flight sweep — its index snapshot predates
    // this launch, so its next emit would drop the card again.
    if (allLaunchesMemo) {
      if (!allLaunchesMemo.resolved.some((l) => l.token.toLowerCase() === launch.token.toLowerCase())) {
        allLaunchesMemo.resolved.push(launch);
      }
      allLaunchesMemo.listeners.forEach((fn) => fn(launch));
    }
    return;
  }
}

/** Synchronous scan of the warm launch caches (list + record memos shared with
 *  the pad pages). A name/ticker/address hit on a migrated launch carries its
 *  aseDexPoolId + venue — the dex search resolves it with one getPool read
 *  instead of waiting for the pool sweep. Cold caches return []. */
export function asepadCachedLaunchMatches(q: string): AsepadLaunch[] {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  const seen = new Map<string, AsepadLaunch>();
  const test = (l: AsepadLaunch | undefined) => {
    if (!l?.token) return;
    const hay = `${l.name} ${l.symbol} ${l.token}`.toLowerCase();
    if (hay.includes(query)) seen.set(l.token.toLowerCase(), l);
  };
  for (const rec of launchRecordCache.values()) test(rec.launch);
  for (const entry of launchListCache.values()) for (const l of entry.out?.launches ?? []) test(l);
  return [...seen.values()];
}

// Token detail page: invalidated every block, but price/trades/migration only
// move when the launch record does — so `getLaunch` is the cheap signal that
// gates the rest. Quiet block = 1 view call; a trade = the full 5.
const launchDetailCache = new Map<string, { sig: string; out: AsepadLaunchDetail }>();
export const asepadPeekLaunch = (token: string) => launchDetailCache.get(token.toLowerCase())?.out;

export const asepadGetLaunch = async (token: string): Promise<AsepadLaunchDetail> => {
  // AWS only — apiResolve carries the launch's curve_json (launch fields,
  // spotPriceWei, migration + volume fields) and apiTrades serves the pad
  // trade feed journaled as dex=<pad> pool_id=pad:<token>. No getLaunch/
  // getSpotPrice/getVolume/recentTrades chain reads on a browse page.
  const [resolved, tradesRes] = await Promise.all([
    apiLaunches(`all&q=${token}`, 1).catch(() => null),
    apiTrades({ pool: `${ASEPAD_CONTRACT}:pad:${token}`, limit: 256 }).catch(() => null),
  ]);
  const row = resolved?.launches?.[0] as Record<string, unknown> | null | undefined;
  const cj = parseJson<Record<string, unknown>>(row?.curve_json, {});
  // curve_json can lag the row's own status/migration_pool columns (migration
  // events historically updated only the columns) — the row wins when fresher.
  if (cj.token && !cj.aseDexPoolId && row?.migration_pool) cj.aseDexPoolId = String(row.migration_pool).split(":").pop();
  if (cj.token && row?.status === "migrated" && cj.status !== "MIGRATED") { cj.status = "MIGRATED"; cj.graduated = "true"; }
  if (row?.idx != null) cj.idx = row.idx;
  // Pad migrations always burn the minted LP (LPShareBurned) — a migrated row
  // with a pool is burned even when curve_json lacks the amount (sentinel 1).
  if (cj.token && row?.status === "migrated" && !cj.lpSharesBurned) cj.lpSharesBurned = "1";
  const raw = cj.token ? cj : { token, name: row?.name ?? "", symbol: row?.symbol ?? "", creator: row?.creator ?? "", status: row?.status ?? "BONDING", meta: row?.meta_json ?? undefined };
  const launch = mapLaunch(raw);
  const sig = `${launch.tradeCount}|${launch.reserve}|${launch.tokensLeft}|${launch.status}|${launch.migrationStage}`;
  const cached = launchDetailCache.get(token.toLowerCase());
  if (cached?.sig === sig) {
    const prev = cached.out;
    const out: AsepadLaunchDetail = { ...prev, launch: { ...prev.launch, ...launch, targetWei: String(launch.targetWei || "0") }, meta: launch.meta };
    cached.out = out;
    return out;
  }
  const trades: AsepadTrade[] = (tradesRes?.trades ?? []).map((t, i) => ({
    id: `${t.tx ?? ""}#${t.block ?? 0}.${i}`, kind: "TRADE", traderAddress: String(t.trader ?? ""),
    aseWei: t.ase_wei ?? "0", tokenAmount: t.side === "sell" ? (t.amount_in ?? "0") : (t.amount_out ?? "0"),
    feeWei: "0", reserveWeiAfter: "0", txHash: t.tx ?? "",
    createdAt: new Date(Number(t.ts ?? 0)).toISOString(),
  }));
  recentTradesMemo.set(`${token.toLowerCase()}|256`, { at: Date.now(), p: Promise.resolve(trades) });
  lastVol24.set(token.toLowerCase(), trades
    .filter((t) => Date.parse(t.createdAt) >= utcDayStart())
    .reduce((s, t) => s + safeBig(t.aseWei || "0"), 0n));
  persistVol24(lastVol24);
  const s = (k: string) => String(cj[k] ?? "");
  const out: AsepadLaunchDetail = {
    launch: { ...launch, targetWei: String(launch.targetWei || "0") },
    price: s("spotPriceWei") || "0", config: { targetWei: String(launch.targetWei || "0"), feeBps: s("feeBps") } as NonNullable<AsepadConfig["config"]>,
    meta: launch.meta, lpBurned: launch.lpBurned ?? false,
    aseDexPoolId: launch.aseDexPoolId ?? null,
    migration: {
      status: s("status") || launch.status,
      migrationStage: s("migrationStage") || launch.migrationStage || "NONE",
      aseDexPoolId: s("aseDexPoolId") || launch.aseDexPoolId || "",
      lpSharesBurned: s("lpSharesBurned") || launch.lpSharesBurned || "0",
      creatorRewardWei: s("creatorRewardWei") || launch.creatorRewardWei || "0",
      liquidityAseWei: s("liquidityAseWei") || s("migrationAseWei") || "0",
      liquidityTokenWei: s("liquidityTokenWei") || s("migrationTokenWei") || "0",
      finalPriceWei: s("finalPriceWei") || launch.finalPriceWei || "0",
      finalMarketCapWei: s("finalMarketCapWei") || launch.finalMarketCapWei || "0",
      creatorRewardPaid: Boolean(cj.creatorRewardPaid)
    },
    volume: {
      buyVolumeWei: s("buyVolumeWei") || launch.buyVolumeWei || "0",
      sellVolumeWei: s("sellVolumeWei") || launch.sellVolumeWei || "0",
      totalVolumeWei: s("totalVolumeWei") || s("volumeWei") || launch.volumeWei || "0",
      buyCount: s("buyCount") || launch.buyCount || "0",
      sellCount: s("sellCount") || launch.sellCount || "0",
      tradeCount: s("tradeCount") || launch.tradeCount || "0"
    },
    trades
  };
  launchDetailCache.set(token.toLowerCase(), { sig, out });
  return out;
};

export type AsepadTrade = {
  id: string; kind: string; traderAddress: string; aseWei: string;
  tokenAmount: string; feeWei: string; reserveWeiAfter: string;
  txHash: string; createdAt: string;
};

export type AsepadBuyQuote = {
  feasible?: boolean;
  reason?: string;
  userSentWei?: string;
  grossAseWei?: string;
  protocolFeeWei?: string;
  netAseWei?: string;
  currentSpotPriceWei?: string;
  tokensOut: string;
  executionPriceWei?: string;
  newSpotPriceWei?: string;
  priceImpactBps?: string;
  newAseReserveWei?: string;
  newTokenReserveWei?: string;
  bondingProgressBpsAfter?: string;
  willReachBondingTarget?: boolean;
};

export type AsepadSellQuote = {
  feasible?: boolean;
  reason?: string;
  tokensIn?: string;
  currentSpotPriceWei?: string;
  grossAseOutWei?: string;
  protocolFeeWei?: string;
  netAseOutWei?: string;
  aseOut: string;
  executionPriceWei?: string;
  newSpotPriceWei?: string;
  priceImpactBps?: string;
  newAseReserveWei?: string;
  newTokenReserveWei?: string;
};

export const asepadGetStats = async () => {
  // AWS only: /api/stats gives the counts; curve volume/TVL and dex TVL come
  // from the launch + pool rows the indexer already rolled up. No
  // launchCount/platformStats/pool enumeration reads.
  const [stats, launches] = await Promise.all([
    apiStats().catch(() => null),
    apiLaunches("all", 20000, true).catch(() => null),
  ]);
  let curveVolumeWei = 0n, curveTvlWei = 0n, bondedCount = 0n, migratedCount = 0n;
  for (const row of launches?.launches ?? []) {
    const cj = parseJson<Record<string, unknown>>(row.curve_json, {});
    curveVolumeWei += safeBig(String(cj.volumeWei ?? cj.volume ?? (row.vol_ase ? Math.round(row.vol_ase) : "0")));
    curveTvlWei += safeBig(String(cj.aseReserve ?? row.raised_wei ?? "0"));
    const st = cj.status ?? row.status;
    if (st === "migrated" || st === "MIGRATED") migratedCount++;
    else if (st !== "BONDING" && st !== "bonding" && st !== "RECOVERED") bondedCount++;
  }
  // All-time AseDex volume + TVL — /api/stats.dex_vol sums pool_vol across
  // every bucket since genesis; dex_tvl sums ASE-side reserves over every
  // pool. Both filtered to the AseDex contract — no row caps, no pools fetch.
  let dexTvlWei = 0n, dexVolumeWei = 0n;
  const st = stats as { dex_vol?: Record<string, number>; dex_tvl?: Record<string, number>; curve_vol?: number; curve_tvl?: number } | null;
  for (const [dex, ase] of Object.entries(st?.dex_vol ?? {})) {
    // BigInt(number), not safeBig(String) — e+23 values stringify in
    // scientific notation which safeBig can't parse (zeroed every card).
    if (ASEDEX_CONTRACTS.includes(dex.toLowerCase())) dexVolumeWei += BigInt(Math.round(ase));
  }
  for (const [dex, ase] of Object.entries(st?.dex_tvl ?? {})) {
    if (ASEDEX_CONTRACTS.includes(dex.toLowerCase())) dexTvlWei += BigInt(Math.round(ase));
  }
  // Chain-truth curve figures when the indexer's platformStats cache exists.
  if (st?.curve_vol) curveVolumeWei = BigInt(Math.round(st.curve_vol));
  if (st?.curve_tvl) curveTvlWei = BigInt(Math.round(st.curve_tvl));
  const launchCount = stats?.launches ?? launches?.launches.length ?? 0;
  return {
    launches: launchCount, bonded: Number(bondedCount), migrated: Number(stats?.migrated ?? migratedCount),
    curveTvlWei: curveTvlWei.toString(), dexTvlWei: dexTvlWei.toString(),
    tvlWei: (curveTvlWei + dexTvlWei).toString(), curveVolumeWei: curveVolumeWei.toString(),
    dexVolumeWei: dexVolumeWei.toString(), volumeWei: (curveVolumeWei + dexVolumeWei).toString(),
    bondedAseWei: curveTvlWei.toString()
  };
};

// Token genesis + a readable token card are baked into the deployed source
// (shared builder in @asentrise/contracts, also used by the contract simulation).
export type { TokenGenesis } from "@asentrise/contracts/browser";
/** AsePad launch token: full supply is credited to the bound AsePad at genesis. */
export const asepadTokenSource = (g: TokenGenesis & { pad: string }) => buildPadTokenSource(g);
/** Standard ARC-20: full supply is credited to the creator at genesis. */
export const standardTokenSource = (g: TokenGenesis) => buildStandardTokenSource(g);

/** Legacy dex (still live on-chain) — bound as the tax token's second venue so
 *  buy/sell tax can't be dodged by trading the pair on the old dex. */
export const AURADEX_LEGACY_CONTRACT = process.env.NEXT_PUBLIC_CONTRACT_AURADEX_V1 || "0x63f640a9b98b6f28e06cb5cc0fce5d72b6c0eabd";
/** AuraDex v2 — the auras team's new AMM (third venue alongside AseDex). */
export const AURADEX_V2_CONTRACT = process.env.NEXT_PUBLIC_CONTRACT_AURADEX_V2 || "0xcc1c9029cfe92004bca76c013cef2fdaa75351a2";

/** Tax ARC-20 source: dex=AseDex, dex2=legacy AuraDex — no registry coupling. */
export const taxTokenSource = (g: TokenGenesis & {
  buyTaxBps: string; sellTaxBps: string; taxWallet?: string;
}) => buildTaxTokenSource({
  ...g,
  dex: ASEDEX_CONTRACTS[0] || "",
  dex2: AURADEX_LEGACY_CONTRACT
});

/** Valid Asentum address input: ase1… bech32 or 0x-hex (checksum-insensitive). */
export const isValidAddressInput = (value: string): boolean => {
  const v = value.trim();
  if (!v) return false;
  try { return /^0x[0-9a-fA-F]{40}$/.test(toHexAddress(v)); } catch { return false; }
};

// ── Source verification (shared matcher lives in @asentrise/contracts) ────
export { verifyTokenSourceString };
export type { TokenVerification } from "@asentrise/contracts/browser";
export type TokenVerificationResult = TokenVerification | "unknown";
/** "verified-*" = byte-exact template (current or a known legacy version);
 *  "unverified" = custom/manipulated contract; "unknown" = RPC failed. */
export async function verifyTokenSource(address: string): Promise<TokenVerificationResult> {
  // AWS-only — the indexer's `kind` is written from the deploy path itself:
  // pad launches, factory "standard" and factory "tax" tokens can only exist
  // from the canonical templates, so kind maps 1:1 onto the byte-match
  // classes without an eth_getCode on every page paint. A token with no
  // registry row is a custom deploy → "unverified" until indexed.
  const r = await apiResolve(address).catch(() => null);
  if (r === null) return "unknown";
  const kind = String((r.token as { kind?: string } | null | undefined)?.kind ?? "").toLowerCase();
  if (r.launch || kind === "pad") return "verified-pad";
  if (kind === "tax") return "verified-tax";
  if (kind === "standard") return "verified-standard";
  return "unverified";
}
const FACTORY_CONTRACT = process.env.NEXT_PUBLIC_CONTRACT_ARC20_FACTORY || process.env.CONTRACT_ARC20_FACTORY || "";
export const tokenFactoryAddress = () => FACTORY_CONTRACT;
/** Tokens created through each path: AsePad bonding-curve launches + standard ARC-20s.
 *  AWS only — /api/stats carries launch count + the indexer's cached factory
 *  tokenCount (chain-truth, refreshed server-side every minute). */
export const getCreatedTokenCounts = async () => {
  const s = await apiStats().catch(() => null) as { launches?: number; standards?: number } | null;
  return { asepad: String(s?.launches ?? 0), standard: String(s?.standards ?? 0) };
};
export const getStandardTokenFeeWei = async () => {
  const s = await apiStats().catch(() => null) as { fee_standard?: string } | null;
  return String(s?.fee_standard ?? "0");
};
export const getTaxTokenFeeWei = async () => {
  const s = await apiStats().catch(() => null) as { fee_tax?: string } | null;
  return String(s?.fee_tax ?? "0");
};

// ── CEX-style candle normalization ─────────────────────────────────────────
// Shared by the AseDex terminal (indexer + swap-derived candles) and the pad
// token chart. Raw feeds arrive sparse and open at the first trade of each
// bucket — that renders as scattered dashes with vertical cliffs. This pass:
//   1. dedupes/merges buckets and enforces OHLC invariants
//   2. chains each open to the previous real close (bodies connect cleanly)
//   3. fill=true: fills empty buckets with thin carry candles + bounded tail
//      fill=false (trade-only): candles exist only where trades printed —
//      quiet stretches are honest empty space, no fake flat bodies
export type CandleLike = { time: number; open: number; high: number; low: number; close: number; volume?: number };
export const normalizeCandles = (
  raw: CandleLike[],
  intervalSec: number,
  opts?: { maxReal?: number; tailBuckets?: number; maxOut?: number; fill?: boolean }
): CandleLike[] => {
  const maxReal = opts?.maxReal ?? 160;
  const tail = opts?.tailBuckets ?? 24;
  const maxOut = opts?.maxOut ?? 360;
  if (!raw.length || !(intervalSec > 0)) return [];
  const byTime = new Map<number, CandleLike>();
  for (const c of raw) {
    const t = Math.floor(c.time / intervalSec) * intervalSec;
    if (!Number.isFinite(t) || ![c.open, c.high, c.low, c.close].every((v) => Number.isFinite(v) && v > 0)) continue;
    const prev = byTime.get(t);
    if (!prev) {
      byTime.set(t, { time: t, open: c.open, high: Math.max(c.open, c.close, c.high), low: Math.min(c.open, c.close, c.low), close: c.close, volume: c.volume ?? 0 });
    } else {
      prev.high = Math.max(prev.high, c.high);
      prev.low = Math.min(prev.low, c.low);
      prev.close = c.close;
      prev.volume = (prev.volume ?? 0) + (c.volume ?? 0);
    }
  }
  const real = [...byTime.values()].sort((a, b) => a.time - b.time).slice(-maxReal);
  if (!real.length) return [];
  const chain = (c: CandleLike, lastClose: number): CandleLike => ({
    time: c.time, open: lastClose, high: Math.max(lastClose, c.high), low: Math.min(lastClose, c.low), close: c.close, volume: c.volume ?? 0
  });
  // Trade-only mode — every rendered candle is a real print; opens still
  // chain so consecutive bodies connect even across time gaps.
  if (opts?.fill === false) {
    let lastClose = real[0]!.open;
    return real.map((c) => { const out = chain(c, lastClose); lastClose = c.close; return out; });
  }
  const nowBucket = Math.floor(Date.now() / 1000 / intervalSec) * intervalSec;
  const end = Math.min(nowBucket, real.at(-1)!.time + tail * intervalSec);
  const out: CandleLike[] = [];
  let lastClose = real[0]!.open;
  for (let t = real[0]!.time; t <= end; t += intervalSec) {
    const c = byTime.get(t);
    if (c) {
      out.push(chain(c, lastClose));
      lastClose = c.close;
    } else {
      out.push({ time: t, open: lastClose, high: lastClose, low: lastClose, close: lastClose, volume: 0 });
    }
  }
  return out.slice(-maxOut);
};

// Candles only change when a trade lands — getLaunch carries tradeCount, so
// one cheap view gates the 256-trade re-read per block.
const candleCache = new Map<string, { sig: string; out: AsepadCandleData }>();
export const asepadPeekCandles = (token: string, interval = 60) => candleCache.get(`${token.toLowerCase()}|${interval}`)?.out;

export const asepadGetCandles = async (token: string, interval = 60): Promise<AsepadCandleData> => {
  const k = token.toLowerCase();
  const ck = `${k}|${interval}`;
  // AWS-only: launch record for the seed/meta, pad curve trades journaled as
  // pool_id="pad:<token>" — execution prices already in each row.
  const [row, tradesRes] = await Promise.all([
    apiLaunches(`all&q=${token}`, 1).then((d) => d?.launches?.[0] as Record<string, unknown> | undefined).catch(() => null),
    apiTrades({ pool: `${ASEPAD_CONTRACT}:pad:${token}`, limit: 256 }).catch(() => null),
  ]);
  const cj = row ? parseJson<Record<string, unknown>>(row.curve_json, {}) : {};
  const launchMeta = {
    initialPriceWei: cj.initialPriceWei ?? cj.initial_price_wei,
    createdTs: cj.createdTs ?? cj.created_ts ?? (row?.created_ts ? String(row.created_ts) : undefined),
    curveSupply: cj.curveSupply ?? cj.curve_supply,
    totalSupply: cj.totalSupply ?? cj.total_supply ?? row?.total_supply,
    virtualAseWei: cj.virtualAseWei ?? cj.virtual_ase_wei
  };
  const sig = `${tradesRes?.trades?.length ?? 0}|${tradesRes?.trades?.[0]?.ts ?? 0}|${row?.status ?? ""}`;
  const cached = candleCache.get(ck);
  if (cached && cached.sig === sig && row) return cached.out;
  const candles = new Map<number, { time: number; open: number; high: number; low: number; close: number; volume: number }>();

  // Seed the series at the launch price so the chart starts at curve-open,
  // not at the first trade. Running lastClose makes each candle open at the
  // previous close — sells below it render red, buys above render green.
  let lastClose = 0;
  const initPrice = Number(safeBig(launchMeta?.initialPriceWei || "0")) / 1e18;
  const launchedAt = Number(launchMeta?.createdTs || "0") / 1000;
  if (initPrice > 0 && launchedAt > 0) {
    const t0 = Math.floor(launchedAt / interval) * interval;
    candles.set(t0, { time: t0, open: initPrice, high: initPrice, low: initPrice, close: initPrice, volume: 0 });
    lastClose = initPrice;
  }

  // Price basis = indexed execution price per trade (ASE/token), exactly what
  // the curve charged. Trades arrive newest-first — reverse into order.
  const trades = [...(tradesRes?.trades ?? [])].reverse();
  for (const trade of trades) {
    const time = Math.floor(Number(trade.ts || "0") / 1000 / interval) * interval;
    const price = Number(trade.price ?? 0) || (() => {
      const ase = Number(safeBig(trade.ase_wei || "0")) / 1e18;
      // Buy: ASE in → token out (amount_out); sell: token in → ASE out (amount_in).
      const tokenWei = String(trade.side ?? "").toLowerCase() === "sell" ? trade.amount_in : trade.amount_out;
      const qty = Number(safeBig(tokenWei || "0")) / 1e18;
      return qty > 0 ? ase / qty : 0;
    })();
    const volume = Number(safeBig(trade.ase_wei || "0")) / 1e18;
    if (!Number.isFinite(price) || price <= 0) continue;
    const candle = candles.get(time);
    if (!candle) {
      const open = lastClose > 0 ? lastClose : price;
      candles.set(time, { time, open, high: Math.max(open, price), low: Math.min(open, price), close: price, volume });
    } else {
      candle.high = Math.max(candle.high, price);
      candle.low = Math.min(candle.low, price);
      candle.close = price;
      candle.volume += volume;
    }
    lastClose = price;
  }
  // CEX-style normalization — trade-only candles (no fake flat bodies),
  // opens chained to the previous real close.
  const filled = normalizeCandles([...candles.values()], interval, { fill: false });
  const out: AsepadCandleData = {
    intervalSec: interval, priceBasis: "indexed-execution" as const,
    historyLimited: false,
    candles: filled.slice(-200).map((c) => ({ ...c, volume: c.volume ?? 0 }))
  };
  candleCache.set(ck, { sig, out });
  return out;
};

// Holders was the single heaviest read on the platform: holderAt + balanceOf
// per holder (~1000 calls at 500 holders) fired on every block invalidation.
// Now: holderAt indexes are immutable (cached forever), holder metadata is
// cached, and one `holderCount` read gates the whole sweep — balances re-read
// at most every HOLDER_SWEEP_MS or when the holder count moves.
const HOLDER_SWEEP_MS = 20_000;
const HOLDER_ADDR_CAP = 300;
const holderSweepCache = new Map<string, { at: number; count: number; out: AsepadHolderData }>();
export const asepadPeekHolders = (token: string) => holderSweepCache.get(token.toLowerCase())?.out;

export const asepadGetHolders = async (token: string): Promise<AsepadHolderData> => {
  const k = token.toLowerCase();
  const cached = holderSweepCache.get(k);
  if (cached && Date.now() - cached.at < HOLDER_SWEEP_MS) return cached.out;

  // AWS holders index — the Transfer crawl serves the real list in one HTTP
  // read. Launch record supplies creator/bonding-curve tags + supply.
  const launch = sweepRecords.get(k);
  const creator = String(launch?.creator ?? "");
  const pad = ASEPAD_CONTRACT;
  const res = UNIFIED_API
    ? await fetch(`${UNIFIED_API}/api/holders/${token}?size=${HOLDER_ADDR_CAP}`, { signal: AbortSignal.timeout(8000) }).catch(() => null)
    : null;
  const j = res?.ok ? await res.json().catch(() => null) as { rows?: { holder?: string; balance?: string }[]; total?: number; token?: { decimals?: number; total_supply?: string } } | null : null;
  const supply = numStr(j?.token?.total_supply) !== "0" ? numStr(j?.token?.total_supply) : numStr(launch?.totalSupply);
  const holders = (j?.rows ?? []).map((r) => {
    let address = String(r.holder || "");
    if (/^ase1/i.test(address)) { try { address = toHexAddress(address); } catch { } }
    const al = address.toLowerCase();
    return {
      address: al,
      balance: numStr(r.balance),
      tag: al === creator.toLowerCase() ? "dev" as const
        : al === pad.toLowerCase() ? "bonding curve" as const
        : al === "0x0000000000000000000000000000000000000000"
          || al === "0x000000000000000000000000000000000000dead" ? "burn" as const
        : ASEDEX_CONTRACTS.includes(al) ? "asedex" as const : undefined
    };
  }).filter((h) => /^0x[0-9a-f]{40}$/.test(h.address) && safeBig(h.balance) > 0n);
  const live = holders.sort((a, b) => safeBig(a.balance) > safeBig(b.balance) ? -1 : 1);
  const count = Number(j?.total ?? live.length) || live.length;
  const out: AsepadHolderData = {
    holders: live.map((holder) => ({ ...holder, shareBps: safeBig(supply) > 0n ? Number(safeBig(holder.balance) * 10000n / safeBig(supply)) : 0 })),
    count, supply
  };
  holderSweepCache.set(k, { at: Date.now(), count, out });
  return out;
};

// ── formatting ──────────────────────────────────────────────────────────────
// ASEPAD UI shows native ase1 addresses everywhere — hex is internal only.
export const shortenAddress = (a: string, head = 12, tail = 6) => {
  // convert 20-byte hex to ase1; leave anything else (tx hashes etc.) as-is
  const ase = /^0x[0-9a-fA-F]{40}$/.test(a) ? (toAseAddress(a) || a) : a;
  return ase.length > head + tail + 3 ? `${ase.slice(0, head)}…${ase.slice(-tail)}` : ase;
};


export function formatTokenPrice(value: number): string {
  if (!Number.isFinite(value)) return "-";
  if (value === 0) return "0";
  const rounded = Number(Math.abs(value).toPrecision(6));
  const [coefficient, exponent] = rounded.toExponential().split("e");
  const zeros = -Number(exponent) - 1;
  const sign = value < 0 ? "−" : "";
  if (zeros > 3) {
    const superscript = String(zeros).replace(/\d/g, (digit) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[Number(digit)]);
    const significant = coefficient.replace(".", "").replace(/0+$/, "");
    return `${sign}0.0${superscript}${significant}`;
  }
  return sign + rounded.toLocaleString("en-US", { maximumSignificantDigits: 6 });
}

export function formatTokenPriceLabel(value: number, currency: "USD" | "ASE", compact = true): string {
  if (!Number.isFinite(value)) return "-";
  const number = compact ? formatTokenPrice(value)
    : value.toLocaleString("en-US", { useGrouping: false, maximumSignificantDigits: 21 });
  return currency === "USD" ? `$${number}` : `${number} ASE`;
}

// Superscript digits (⁰¹²³…) are missing from many mobile fonts — canvas text
// (chart axes/crosshair) can't use <sup>, so tiny prices render ASCII-safe.
const SUP_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹";
export function formatTokenPriceAxis(value: number, currency?: "USD" | "ASE"): string {
  const n = formatTokenPrice(value).replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g,
    (m) => `(${[...m].map((c) => SUP_DIGITS.indexOf(c)).join("")})`);
  return !currency ? n : currency === "USD" ? `$${n}` : `${n} ASE`;
}

export const fmtAse = (wei: string | bigint | undefined, digits = 4) => {
  if (wei === undefined) return "0";
  const n = Number(safeBig(wei)) / 1e18;
  if (n === 0) return "0";
  if (n >= 0.001) return n.toLocaleString(undefined, { maximumFractionDigits: digits });
  // tiny prices — show 6 significant digits with a superscript leading-zero count
  return formatTokenPrice(n);
};
/** Explicit magnitude ladder — K/M/B/T/Q — deterministic across locales
 *  (Intl "compact" renders "100m" in some). Values past ~1000Q fall back to
 *  exponential instead of inventing nonstandard suffixes. */
const COMPACT_UNITS: [number, string][] = [[1e15, "Q"], [1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]];
export const compactNum = (v: number): string => {
  if (!Number.isFinite(v) || v <= 0) return "0";
  const u = COMPACT_UNITS.find(([n]) => v >= n);
  if (!u) return v.toLocaleString(undefined, { maximumFractionDigits: 3 });
  const s = v / u[0];
  return s >= 1000 ? v.toExponential(2) : `${Number(s.toFixed(3))}${u[1]}`;
};
export const fmtAseCompact = (wei: string | bigint | undefined) => {
  if (wei === undefined) return "0";
  const n = Number(safeBig(wei)) / 1e18;
  if (n === 0) return "0";
  if (n < 0.001) return formatTokenPrice(n);
  return compactNum(n);
};
export const fmtTokens = (wei: string | bigint | undefined) => {
  if (wei === undefined) return "0";
  const n = Number(safeBig(wei)) / 1e18;
  if (n === 0) return "0";
  if (n >= 1000) return compactNum(n);
  return n.toFixed(2);
};

export const weiToDecimal = (wei: string | bigint) => {
  const n = safeBig(wei);
  const sign = n < 0n ? "-" : "";
  const abs = n < 0n ? -n : n;
  const whole = abs / 10n ** 18n;
  const fraction = (abs % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return `${sign}${whole.toString()}${fraction ? `.${fraction}` : ""}`;
};

export const fmtExactWei = (wei: string | bigint) => {
  const n = safeBig(wei);
  const sign = n < 0n ? "-" : "";
  const abs = n < 0n ? -n : n;
  const whole = abs / 10n ** 18n;
  const fraction = (abs % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return `${sign}${whole.toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
};
// USD display — rate comes from /asepad/config (aseUsd)
export const fmtUsd = (aseAmount: number, rate: number | undefined) => {
  if (!rate || rate <= 0) return null;
  const usd = aseAmount * rate;
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${formatTokenPrice(usd)}`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(2)}M`;
  if (usd >= 1e3) return `$${(usd / 1e3).toFixed(2)}K`;
  return `$${usd.toFixed(2)}`;
};

export const aseToWei = (ase: string) => {
  const [w, f = ""] = ase.split(".");
  return (safeBig(w || "0") * 10n ** 18n + safeBig((f + "0".repeat(18)).slice(0, 18))).toString();
};

export function bondingMessage(pct: number): string {
  if (pct >= 100) return "Bonding target reached. Liquidity is on AseDex.";
  if (pct >= 99) return "Nearly bonded, final trades before migration.";
  if (pct >= 90) return "Approaching the bonding threshold.";
  if (pct >= 75) return "Three quarters of the way to bonding.";
  if (pct >= 50) return "Halfway to the bonding target.";
  if (pct >= 25) return "The curve is gaining traction.";
  if (pct >= 10) return "Early activity on the curve.";
  return "Newly launched, the curve just opened.";
}

export type StatusBadgeIcon = "gem" | "waves" | "flame" | "migrate" | "pulse";

export function statusBadge(status: AsepadLaunch["status"], lpBurned?: boolean): { label: string; cls: string; icon: StatusBadgeIcon } {
  if (status === "MIGRATED" && lpBurned) return { label: "LIVE ON ASEDEX", cls: "text-cyan-300 border-cyan-400/30 bg-cyan-400/10", icon: "gem" };
  if (status === "MIGRATED") return { label: "MIGRATED", cls: "text-cyan-300 border-cyan-400/30 bg-cyan-400/10", icon: "waves" };
  if (status === "BONDED") return { label: "BONDED", cls: "text-orange-300 border-orange-400/30 bg-orange-400/10", icon: "flame" };
  if (status === "MIGRATING") return { label: "MIGRATING", cls: "text-violet-300 border-violet-400/30 bg-violet-400/10", icon: "migrate" };
  if (status === "RECOVERED") return { label: "RECOVERED", cls: "text-amber-300 border-amber-400/30 bg-amber-400/10", icon: "waves" };
  return { label: "BONDING", cls: "text-emerald-300 border-emerald-400/30 bg-emerald-400/10", icon: "pulse" };
}
