"use client";

import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useAseBalance } from "@/lib/use-ase-balance";
import { AnimatePresence, motion } from "framer-motion";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { LiveIndicator, subscribeChainEvents, walletSeenTokens } from "@/components/live/live-chain";
import { userLogNoteTrade, userLogSetPortfolio, userLogTokens, userLogTrades } from "@/lib/user-log";
import { TokenChart } from "@/components/token-chart";
import { ChartSkeleton } from "@/components/chart-skeleton";
import { PageShell } from "@/components/page-shell";
import { PricePower } from "@/components/price-power";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWalletStore } from "@/stores/wallet";
import { sendWalletCall, requireWalletTxMined, viewContract, viewContractBatch, rpcPaused, type ViewBatchCall } from "@/lib/asentum-wallet";
import { asepadGetConfig, asepadGetLaunch, asepadCachedLaunchMatches, asepadKnownTokens, asepadPeekHolders, asepadPeekLaunchRecord, tokenFactoryAddress, shortenAddress, normalizeCandles, compactNum, formatTokenPriceAxis, socialUrl, linkUrl } from "@/lib/asepad";
import { useNames, namedAddr } from "@/lib/use-names";
import { toAseAddress, toHexAddress, sameAddress } from "@asentrise/utils";
import { cn } from "@/lib/cn";
import { ArrowDownUp, ArrowLeftRight, BadgeCheck, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Download, ExternalLink, Flame, Globe, Lock, LockKeyhole, Search, Send, ShieldCheck, Star, X } from "lucide-react";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/explorer";

import { fetchAllLocks } from "@/lib/lock-shared";
import { gateCache, dexGateInvalidate, type DexGate } from "@/lib/dex-gate";
import { apiGate, apiLaunches, apiOrders, apiPool, apiPools, apiResolve, apiResolveBatch, apiTokens, apiTrades, apiTrending, apiVerified, apiWallet, apiWalletPositions, UNIFIED_API } from "@/lib/ase-api";
import { ASEDEX_GOTO_EVENT } from "@/lib/asedex-nav";
import { href as siteHref } from "@/lib/site";

const DEX = process.env.NEXT_PUBLIC_CONTRACT_ASEDEX || process.env.CONTRACT_ASEDEX || "";
const PAD = process.env.NEXT_PUBLIC_CONTRACT_ASEPAD || "";
const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
// token (lowercase) → LP-burn tx hash; "" marks "checked, no burn tx". Burn
// hashes are immutable, so this survives query-key rotations forever.
const padBurnTxCache = new Map<string, string>();
const padBurnTxTried = new Map<string, number>();
// Pool-keyed burn-tx map seeded by /api/burns — pad migration txs and
// LPShareBurned events arrive in the same bulk response that carries share
// totals, so most flames never need a per-pool /api/burn probe at all.
const burnTxByPool = new Map<string, string>();
// Pools AWS confirms are pad migrations — a missing tx is terminal (pad-page
// fallback), never re-probed.
const burnPadPools = new Set<string>();
const ASE_LOGO = "/ase.png";
const AseLogo = ({ size = 16, className }: { size?: number; className?: string }) => (
  <img src={ASE_LOGO} alt="ASE" width={size} height={size} className={cn("inline-block rounded-full object-cover", className)} />
);
const ZERO = "0x0000000000000000000000000000000000000000";
// AseLock escrow — token locks + unclaimed vesting sit here, so its balance
// of a token is excluded from circulating supply (same address as /lock).
const LOCK = (process.env.NEXT_PUBLIC_CONTRACT_LOCK || "0xf3ae3ad546263cb8fe761dc22209c7b8f434244d").toLowerCase();
const LOCK_V2 = (process.env.NEXT_PUBLIC_CONTRACT_LOCK_V2 || "0x73622dfbb0f43c033d634996a1ea3787f1516232").toLowerCase();
// Conventional burn address — tokens can't be sent to 0x0 (the ARC-20
// templates assert against it), so real burns land on the dead address.
const DEAD = "0x000000000000000000000000000000000000dead";
const SLIPPAGE_PRESETS = ["0.5", "1", "3", "5", "10"];
// AseDex venues — the single live AseDex deployment. Pre-upgrade dexes are
// retired from the platform: their pools aren't listed or routed here.
const VENUES = [DEX].filter(Boolean);
const PRIMARY_DEX = VENUES[0] || DEX;
// Legacy AuraDex — pools live there pre-rebrand; the wallet scan checks its
// tokens so migrated holdings still show up.
// Auras venues: v1 (legacy, read+swap+LP-remove only) + v2 (their new AMM —
// the only auras contract that accepts new pools). Both keep serving pools
// and trades; pool creation always targets v2.
const AURADEX_V2 = "0xcc1c9029cfe92004bca76c013cef2fdaa75351a2";
const LEGACY_DEXES = ["0x63f640a9b98b6f28e06cb5cc0fce5d72b6c0eabd", AURADEX_V2].filter((a) => !VENUES.includes(a));
const isLegacyDex = (dex?: string) => LEGACY_DEXES.includes(String(dex || "").toLowerCase());
const dexName = (dex?: string) => (String(dex || "").toLowerCase() === AURADEX_V2 ? "AURAS V2" : isLegacyDex(dex) ? "AURAS" : "ASEDEX");
// Short venue slugs for terminal URLs: /asedex/terminal/<asedex|auras|auras/v2>/<id>
// v1 keeps the plain "auras" slug forever (old links); v2 gets "auras/v2".
const dexSlug = (dex?: string) => (String(dex || "").toLowerCase() === AURADEX_V2 ? "auras/v2" : isLegacyDex(dex) ? "auras" : "asedex");
const slugDex = (slug?: string) => {
  const s = String(slug || "").toLowerCase();
  if (s === "auras" || s === "aura") return LEGACY_DEXES[0];
  if (s === "aurasv2" || s === "auras2") return AURADEX_V2;
  if (s === "asedex" || s === "dex") return PRIMARY_DEX;
  return undefined;
};
// Auras public indexer — the legacy AuraDex contract predates trade logs and
// order books, so AuraDex candles, trades and 24h stats come from here.
const AURAS_API = process.env.NEXT_PUBLIC_AURAS_API || process.env.NEXT_PUBLIC_ASE_API_URL || "";
type AuraPair = { poolId: string; chainPoolId?: string; amm: string; price: number; change24: number; volume24: number; trades24: number; tvlQuote?: number; lastTradeAt?: string; token0?: string; token1?: string; base?: string; quote?: string; feeBps?: number; reserve0?: string; reserve1?: string; shares?: string; lastTs?: string };
type AuraTrade = { poolId?: string; txHash?: string; ts?: string; trader?: string; side?: string; price?: number; amountIn?: string; amountOut?: string; tokenIn?: string; tokenOut?: string; sizeQuote?: number };
async function auraApi<T>(path: string): Promise<T | null> {
  // AWS unified API shape: pool params arrive as "asedex-<id>" here but the
  // indexer's trades/positions want "<dex>:<id>". Rewrite on the wire.
  const wire = path.replace(/([?&]pool=)asedex-(\d+)/i, (_m, p, id) => `${p}${DEX}:${id}`);
  try { const r = await fetch(`${AURAS_API}${wire}`, { cache: "no-store" }); return r.ok ? (await r.json() as T) : null; } catch { return null; }
}
// The real AuraDex indexer — v1/v2 pools' swap tapes, wallet activity and
// per-token positions our ops shard hasn't backfilled. Gap-fill only:
// AWS wins wherever both index the same row.
async function aurasIdx<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`https://auras.asentum.com${path}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    return r.ok ? (await r.json() as T) : null;
  } catch { return null; }
}
// ONE /api/pairs snapshot shared by every consumer — pool-list builds, 24h
// stats, pair-map, URL resolve, wallet token discovery. 15s freshness +
// in-flight dedupe: callers firing inside the window reuse the same HTTP
// response instead of each polling the identical endpoint.
let auraPairsCache: { at: number; data: { pairs?: AuraPair[] } | null } | null = null;
let auraPairsInflight: Promise<{ pairs?: AuraPair[] } | null> | null = null;
// AWS /api/pools rows → AuraPair shape. Pool ids keep the "asedex-<id>" form
// the legacy feed used so every downstream consumer (pairIdOf etc.) is
// unchanged; chainPoolId carries the bare chain id.
type AwsPoolRow = { dex: string; pool_id: string; token0: string; token1: string; reserve0?: string; reserve1?: string; fee_bps?: number; lp_supply?: string | null; vol24_ase?: number | null; updated_at?: number | null; t0_decimals?: number | null; t0_symbol?: string | null; t1_symbol?: string | null };
function awsPoolToPair(p: AwsPoolRow): AuraPair {
  const r0 = safeBig(p.reserve0 ?? "0"), r1 = safeBig(p.reserve1 ?? "0");
  const dec0 = p.t0_decimals ?? 18;
  // ASE-quoted pools: token1 = native ASE (18dp). Price = quote-reserve /
  // base-reserve in real units, so token decimals shift the decimal point.
  const price = r0 > 0n && r1 > 0n
    ? (Number(r1) / 1e18) / (Number(r0) / 10 ** dec0)
    : 0;
  return {
    poolId: `asedex-${p.pool_id}`, chainPoolId: p.pool_id, amm: p.dex,
    price, change24: 0, volume24: Number(p.vol24_ase ?? 0) / 1e18, trades24: 0,
    tvlQuote: r1 > 0n ? Number(r1) / 1e18 * 2 : undefined,
    token0: p.token0, token1: p.token1, base: p.t0_symbol ?? undefined, quote: p.t1_symbol ?? undefined,
    feeBps: p.fee_bps ?? 30, reserve0: p.reserve0, reserve1: p.reserve1,
    shares: p.lp_supply ?? undefined, lastTs: String(p.updated_at ?? 0),
    lastTradeAt: p.updated_at ? new Date(p.updated_at).toISOString() : undefined
  };
}
function fetchAuraPairs(): Promise<{ pairs?: AuraPair[] } | null> {
  if (auraPairsCache && Date.now() - auraPairsCache.at < 15_000) return Promise.resolve(auraPairsCache.data);
  auraPairsInflight ??= (async () => {
      // The API has no offset — escalate the limit until the response comes
      // back short, so the whole universe arrives without a hardcoded cap.
      let rows: AwsPoolRow[] = [];
      for (let limit = 2000; ; limit *= 4) {
        const d = await auraApi<{ pools?: AwsPoolRow[] }>(`/api/pools?limit=${limit}`);
        rows = d?.pools ?? [];
        if (rows.length < limit) break;
      }
      return { pools: rows };
    })()
    .then(async (d) => {
      const pairs = d.pools.map(awsPoolToPair);
      // AuraDex indexer overlay — its per-pair market stats (tvlQuote, price,
      // 24h volume) cover pools our indexer lists but hasn't hydrated reserves
      // for yet (v2 especially). AWS rows stay canonical for ids/reserves;
      // the feed only fills stat gaps and adds pools our index hasn't seen.
      const ext = await fetch("https://auras.asentum.com/api/pairs", { cache: "no-store", signal: AbortSignal.timeout(8000) })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null) as { pairs?: AuraPair[] } | null;
      if (ext?.pairs?.length) {
        const byKey = new Map<string, AuraPair>();
        for (const p of pairs) byKey.set(poolKey(String(p.amm || "").toLowerCase(), pairIdOf(p)), p);
        for (const e of ext.pairs) {
          const k = poolKey(String(e.amm || "").toLowerCase(), pairIdOf(e));
          const cur = byKey.get(k);
          if (!cur) { pairs.push(e); byKey.set(k, e); continue; }
          // Feed-only fields ride over — reserves/shares/meta stay AWS-side.
          if (cur.tvlQuote == null && e.tvlQuote != null) cur.tvlQuote = e.tvlQuote;
          if (!cur.price && e.price) cur.price = e.price;
          if (!cur.volume24 && e.volume24) cur.volume24 = e.volume24;
          if (!cur.trades24 && e.trades24) cur.trades24 = e.trades24;
          if (cur.change24 == null && e.change24 != null) cur.change24 = e.change24;
          if (!cur.lastTradeAt && e.lastTradeAt) cur.lastTradeAt = e.lastTradeAt;
        }
      }
      return { pairs };
    })
    .then((out) => { auraPairsCache = { at: Date.now(), data: out }; return out; })
    .finally(() => { auraPairsInflight = null; });
  return auraPairsInflight;
}
// Explorer indexer — one call returns the wallet's whole token portfolio
// (address + symbol/name/decimals + balance). Canonical ase1 addressing;
// replaces the multi-source candidate enumeration when it answers.
// Same-origin path: the indexer API sends no CORS headers, so calls ride the
// same-origin proxy (next.config rewrites in dev, Netlify _redirects in prod).
type IndexerToken = { address?: string; symbol?: string; name?: string; decimals?: number; balance?: string };
// Back off for a few minutes after a failure — a missing proxy (preview
// domains) used to get hammered with 404s on every wallet refetch.
let indexerDownUntil = 0;
const indexerDown = () => { indexerDownUntil = Date.now() + 5 * 60_000; };
const indexerPaused = () => Date.now() < indexerDownUntil;
// Same-origin proxy only (the explorer indexer sends no CORS). When the
// Pages Function is dead — free Workers quota is finite — the call fails
// fast and the caller's other sources (auras positions, transfer journal,
// live-chain sweep) paint held tokens instead. Public CORS relays all proved
// too flaky to hold this slot (timeouts/429s stall the paint worse).
// Same-origin proxy only (the explorer indexer sends no CORS). Origin fall-
// back order: same-origin /api/indexer (Pages fn / dev rewrite), then the
// AWS unified API mirrors /api/indexer/* — no Cloudflare lanes remain.
// Same-origin proxy ONLY: /api/indexer/* redirects to the explorer indexer.
// The AWS API serves /api/indexer → 404 (its /indexer lane is secret-gated)
// and the explorer sends no CORS headers — so both remote origins could
// never answer from a browser and were pure wasted requests per call.
const INDEXER_ORIGINS = [""];
async function indexerFetch(path: string): Promise<Response | null> {
  for (const origin of INDEXER_ORIGINS) {
    try {
      const r = await fetch(`${origin}/api/indexer${path}`, { cache: "no-store" });
      if (r.ok) return r;
      // 404/405 = no route on this origin; 5xx = a dead/saturated upstream —
      // both must fall through to the AWS mirror (independent failure
      // domain). Returning a 502 was killing the whole indexer lane.
      if (r.status < 500 && r.status !== 404 && r.status !== 405) return r;
    } catch { }
  }
  return null;
}
async function indexerTokens(ownerAse: string): Promise<IndexerToken[] | null> {
  if (indexerPaused()) return null;
  try {
    const r = await indexerFetch(`/address/${encodeURIComponent(ownerAse)}/tokens`);
    if (!r || !r.ok) { indexerDown(); return null; }
    const j = (await r.json()) as { tokens?: IndexerToken[] };
    return Array.isArray(j.tokens) ? j.tokens : null;
  } catch { indexerDown(); return null; }
}
// The transfers feed is also the wallet history source — grouped by tx_hash,
// a tx with one asset out and a different asset in is a trade (DEX swap,
// bonding-curve buy/sell, token↔token). Pages are 100 legs each.
type IndexerLeg = { tx_hash?: string; kind?: string; token?: string | null; from_addr?: string; to_addr?: string; value?: string; symbol?: string | null; token_name?: string | null; decimals?: number | null; timestamp?: number; block_number?: number; side?: string };
async function indexerTransfers(ownerAse: string, pages = 2): Promise<IndexerLeg[] | null> {
  if (indexerPaused()) return null;
  // Sequential with stop-on-first-miss: a dead indexer costs ONE request,
  // not N parallel page probes fanning out every refetch.
  const out: IndexerLeg[] = [];
  let hit = false;
  for (let i = 0; i < pages; i++) {
    const r = await indexerFetch(`/address/${encodeURIComponent(ownerAse)}/transfers?page=${i + 1}&size=100`).catch(() => null);
    const rows = r?.ok ? ((await r.json().catch(() => null)) as { rows?: IndexerLeg[] } | null)?.rows : undefined;
    if (!rows?.length) break;
    hit = true;
    out.push(...rows);
    if (rows.length < 100) break;
  }
  if (!hit) { indexerDown(); return null; }
  return out;
}
// Bare-terminal default pair — picked per session from the market's top-3
// pools by 24h volume (see trendingTop3 below); a chosen pair or deep link
// always wins.
type Pool = {
  id: string; dex: string; token0: string; token1: string; reserve0: string; reserve1: string;
  totalShares: string; feeBps: string; price0Cumulative: string; price1Cumulative: string; lastTs: string;
  volumeAseWei?: string; // lifetime ASE-denominated volume (AseDex only)
  // Indexer-derived TVL — present only on AuraDex rows built from /api/pairs
  // (lazy hydration: real reserves/shares arrive via getPool on demand).
  tvlQuote?: number;
};
type TokenCard = { description?: string; website?: string; twitter?: string; telegram?: string };
type Asset = { address: string; name: string; symbol: string; decimals: number; logoUrl?: string; fromPad?: boolean; totalSupply?: string; metaBad?: boolean; meta?: TokenCard };
const ASE_ASSET: Asset = { address: NATIVE, name: "Asentum", symbol: "ASE", decimals: 18 };
// accepts ase1 or 0x — everything on-chain is normalized to hex.
const normAddr = (raw: string) => (/^0x[0-9a-f]{40}$/i.test(raw.trim()) ? raw.trim().toLowerCase() : (toHexAddress(raw.trim()) ?? "").toLowerCase());

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button"
      onClick={async (e) => { e.stopPropagation(); try { await navigator.clipboard.writeText(toAseAddress(text)); setOk(true); setTimeout(() => setOk(false), 1200); } catch { } }}
      title="Copy contract address" aria-label="Copy contract address"
      className="inline-flex items-center justify-center text-white/50 transition hover:text-accent">
      {ok ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
    </button>
  );
}
function PadTag({ token, className }: { token?: string; className?: string }) {
  // Shield tick marks every migrated pad token — ASE pairs only (callers
  // gate on the ASE leg; token↔token pad pairs get no mark). A verified
  // token shows the blue tick INSTEAD — the shield comes back if the tick
  // is removed.
  const official = useContext(OfficialTokensCtx);
  if (token && officialLabel(token, official)) return null;
  const body = <ShieldCheck className={cn("h-4 w-4 shrink-0 self-center align-middle text-emerald-300 transition hover:text-emerald-200", className)} />;
  return token ? (
    <a href={siteHref(`/asepad/token/${toAseAddress(token)}`)} onClick={(e) => e.stopPropagation()} title="AsePad Migrated · view token page">{body}</a>
  ) : (
    <span title="AsePad Migrated">{body}</span>
  );
}
// Platform-owned assets — the blue tick (reserved for the ASEPAD official
// token and the native ASE coin; migrated pads carry the shield instead).
const ASEPAD_TOKEN = "0x1b508b96167b2cc078f06ed60bf92bf90e76f626";
const OFFICIAL_LABELS: Record<string, string> = {
  [ASEPAD_TOKEN]: "Official AsePad token",
  [NATIVE]: "Native Asentum coin"
};
// Admin-granted blue ticks — a Set of lowercase token addresses fed by the
// factory's on-chain "official:<token>" flag (query in the app component).
const OfficialTokensCtx = createContext<ReadonlyMap<string, string>>(new Map());
const EMPTY_TOKEN_SET: ReadonlyMap<string, string> = new Map();
const officialLabel = (addr?: string, extra?: ReadonlyMap<string, string>) =>
  addr ? OFFICIAL_LABELS[addr.toLowerCase()] ?? extra?.get(addr.toLowerCase()) : undefined;
function OfficialTag({ addr, className }: { addr?: string; className?: string }) {
  // Hover: browser title tooltip. Tap/click: small pill pops for ~2.5s so
  // mobile users get the same label (title alone never shows on touch).
  const [show, setShow] = useState(false);
  const extra = useContext(OfficialTokensCtx);
  const label = officialLabel(addr, extra);
  if (!label) return null;
  return (
    <span className="relative inline-flex shrink-0 self-center align-middle">
      <span role="button" tabIndex={0} title={label} aria-label={label}
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setShow((s) => !s); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); e.preventDefault(); setShow((s) => !s); } }}
        onBlur={() => setShow(false)}
        className="inline-flex items-center justify-center text-sky-300 transition hover:text-sky-200">
        <BadgeCheck className={cn("h-4 w-4 shrink-0", className)} />
      </span>
      {show ? (
        <span className="pointer-events-none absolute -top-7 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md border border-sky-400/30 bg-zinc-950 px-2 py-0.5 text-[10px] font-semibold text-sky-200 shadow-lg">
          {label}
        </span>
      ) : null}
    </span>
  );
}
// Futures-style stat column — tiny uppercase label over a mono value, used by
// the terminal header strip (same layout language as the AsePadFutures header).
function TermStat({ label, value, title, accent }: { label: string; value: ReactNode; title?: string; accent?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/40">{label}</p>
      <p className={cn("mt-0.5 truncate font-mono text-xs", accent ? "font-semibold" : "text-white/75")} title={title}>{value}</p>
    </div>
  );
}
// Venue tag — which dex contract the pool lives on (AseDex vs legacy AuraDex).
// Third-party logo hosts can refuse cross-origin embeds (CORP) or die —
// a failed <img> swaps to the initials tile instead of a broken icon.
function TokenImg({ src, symbol, cls }: { src?: string; symbol: string; cls: string }) {
  // Track WHICH url failed — a later, different src must get its own attempt
  // (rows upgrade logoUrl in place as metadata lanes resolve).
  const [badFor, setBadFor] = useState<string | undefined>(undefined);
  if (!src || badFor === src) {
    return <span className={cn(cls, "flex items-center justify-center bg-gradient-to-br from-chrome-400/30 to-zinc-500/30 font-bold")}>{symbol.slice(0, 2)}</span>;
  }
  return <img src={linkUrl(src)} alt="" loading="lazy" className={cls} onError={() => setBadFor(src)} />;
}
function DexTag({ dex, className }: { dex: string; className?: string }) {
  const legacy = isLegacyDex(dex);
  const label = legacy ? "AURAS" : "ASEDEX";
  return (
    <span title={`${label} pool`} className={cn("inline-flex h-4 shrink-0 items-center self-center rounded-full border px-1.5 text-[8px] font-bold uppercase leading-none tracking-wider shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] sm:h-5 sm:px-2 sm:text-xs",
      legacy ? "border-violet-300/40 bg-violet-400/20 text-violet-300" : "border-white/25 bg-white/10 text-white", className)}>
      {label}
    </span>
  );
}
// Depleted pool — base leg is dust or the quote leg can't clear the same
// ~100 ASE floor BFS uses, so the implied spot is marginal math, not market
// truth. Rows/terminal flag it and hide the stats that read as real.
const DEPLETED_QUOTE_MIN_ASE = 100;
function poolDepleted(pool: { token0: string; reserve0: string; reserve1: string }, baseAddr: string, quoteAddr: string, quoteDecimals: number, quoteAsePrice: number): boolean {
  const baseRes = safeBig(baseAddr === pool.token0 ? pool.reserve0 : pool.reserve1);
  if (baseRes === 0n) return true;
  const quoteRes = safeBig(quoteAddr === pool.token0 ? pool.reserve0 : pool.reserve1);
  const qVal = quoteAddr === NATIVE
    ? Number(quoteRes) / 1e18
    : (Number(quoteRes) / 10 ** quoteDecimals) * quoteAsePrice;
  return quoteAddr === NATIVE ? qVal < DEPLETED_QUOTE_MIN_ASE : (qVal > 0 && qVal < DEPLETED_QUOTE_MIN_ASE);
}
function ListPager({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (n: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-white/[0.05] px-4 py-2">
      <span className="text-[11px] text-white/45">{total.toLocaleString()} pairs · page {page} of {pages}</span>
      <div className="flex items-center gap-1">
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 text-white/60 transition hover:bg-white/5 hover:text-white disabled:opacity-30"><ChevronLeft className="h-3.5 w-3.5" /></button>
        <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 text-white/60 transition hover:bg-white/5 hover:text-white disabled:opacity-30"><ChevronRight className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  );
}

function LowLiqTag({ className }: { className?: string }) {
  return (
    <span title="Pool reserves are too thin to price this market — headline stats are hidden"
      className={cn("inline-flex h-4 shrink-0 items-center rounded-full border border-amber-400/40 bg-amber-400/15 px-1.5 text-[8px] font-bold uppercase leading-none tracking-wider text-amber-300", className)}>
      Low LP
    </span>
  );
}
// Top-3 volume marker in the markets drawer — the tag follows the pair, so a
// pool picks it up when it climbs and drops it when volume moves elsewhere.
function MarketHotTag({ rank }: { rank: number }) {
  return (
    <span title={`HOT #${rank}`}
      className="inline-flex items-center gap-0.5 rounded-full border border-orange-400/40 bg-orange-400/10 px-1.5 py-px text-[8px] font-bold text-orange-300">
      <Flame className="h-2.5 w-2.5" />HOT #{rank}
    </span>
  );
}
// Lock badges on market rows — LP locks (sky) and token/vesting locks
// (violet) are deliberately different so users never confuse the two. Both
// link straight to the lock's detail page at /lock/<id>.
function LockTag({ id, kind, v2 }: { id: string; kind: "lp" | "token"; v2?: boolean }) {
  return (
    <a href={siteHref(v2 ? `/lock/v2/${id}` : `/lock/${id}`)} onClick={(e) => e.stopPropagation()}
      title={kind === "lp" ? `LP locked · Lock #${id}` : `Tokens locked · Lock #${id}`}
      className={cn("inline-flex items-center gap-0.5 rounded-full border px-1.5 py-px text-[8px] font-bold",
        kind === "lp"
          ? "border-sky-400/40 bg-sky-400/10 text-sky-300"
          : "border-violet-400/40 bg-violet-400/10 text-violet-300")}>
      {kind === "lp" ? <LockKeyhole className="h-2.5 w-2.5" /> : <Lock className="h-2.5 w-2.5" />}{kind === "lp" ? "LP" : "LOCK"}#{id}
    </a>
  );
}
// Viability gate — a pool under ~0.1 ASE of depth can't price and can't trade
// meaningfully, so it stops earning metadata/stats reads and drops out of the
// market lists. Distinct from poolDepleted (the ~100 ASE pricing-trust flag):
// viable = worth processing at all. Dead pools stay visible in LP/position
// views so their creator can still find and fund them.
const VIABLE_MIN_ASE_WEI = 10n ** 17n;
function poolViable(pool: { token0: string; token1: string; reserve0: string; reserve1: string; totalShares?: string; tvlQuote?: number }): boolean {
  // Indexer-built AuraDex rows carry no reserves/shares until hydrated —
  // the indexer's quote-denominated TVL is the viability signal there.
  if (pool.tvlQuote != null) return Number(pool.tvlQuote) > 0;
  if (pool.totalShares !== undefined && safeBig(pool.totalShares || "0") === 0n) return false;
  if (safeBig(pool.reserve0 || "0") === 0n || safeBig(pool.reserve1 || "0") === 0n) return false;
  const n0 = pool.token0 === NATIVE, n1 = pool.token1 === NATIVE;
  if (!n0 && !n1) return true; // token↔token — depth needs decimals, judged post-pricing
  return safeBig(n0 ? pool.reserve0 : pool.reserve1) * 2n >= VIABLE_MIN_ASE_WEI;
}
// token↔token post-cut — runs after the price map: a pair whose legs can't be
// valued AND whose quote side is dust in units has no market to show.
const TT_MIN_QUOTE_UNITS = 0.0001;
// LP-burn indicator — fire color + % when shares sit at the zero address,
// greyed when none. `pill` for the terminal header, icon-only elsewhere.
// One shared burn modal — every flame (rows, header, any screen size) opens it.
// Tiny anchored popover (no overlay/blur) — opens at the clicked flame and
// shows pct, burned shares, and the burn-tx link. Same shape as the terminal's
// burn dropdown, works at every screen size.
let burnModalSetter: ((v: { pct: number; shares?: string; tx?: string; x: number; y: number } | null) => void) | null = null;
const openBurnModal = (v: { pct: number; shares?: string; tx?: string; x: number; y: number }) => burnModalSetter?.(v);

function BurnModal({ pct, shares, tx, x, y, onClose }: { pct: number; shares?: string; tx?: string; x: number; y: number; onClose: () => void }) {
  const W = 208, H = 96;
  const left = Math.max(8, Math.min(x - W / 2, (typeof window !== "undefined" ? window.innerWidth : 400) - W - 8));
  const flip = typeof window !== "undefined" && y + H + 12 > window.innerHeight;
  return (
    <>
      <div className="fixed inset-0 z-[299]" onClick={onClose} />
      <div className="fixed z-[300] rounded-xl border border-white/10 bg-[#0d0f16] p-2.5 text-left shadow-xl"
        style={{ left, top: flip ? Math.max(8, y - H - 8) : y + 8, width: W }}
        onClick={(e) => e.stopPropagation()}>
        <p className="flex items-center gap-1.5 text-xs font-bold text-orange-400">
          <Flame className="h-3.5 w-3.5" />{pct >= 99.95 ? "100" : pct.toFixed(1)}% LP burned
        </p>
        {shares ? <p className="mt-1 font-mono text-[10px] text-white/60">{fmtWeiCompact(shares)} shares burned</p> : null}
        {tx ? (
          <a href={explorerTxUrl(tx)} target="_blank" rel="noreferrer"
            className="mt-1.5 flex items-center gap-1 text-[11px] text-white/60 transition hover:text-white">
            <ExternalLink className="h-3 w-3" /> Burn transaction
          </a>
        ) : null}
      </div>
    </>
  );
}

function LpBurnTag({ pct, shares, tx, pill = false, className }: { pct: number; shares?: string; tx?: string; pill?: boolean; className?: string }) {
  const burned = pct > 0;
  // Icon-only below lg; desktop reveals "Burn X%". Click opens the shared burn
  // popover which links the burn tx (the exact hash the token page found,
  // shared via padBurnTxCache).
  const tip = `Burn ${pct >= 99.95 ? 100 : pct.toFixed(1)}%`;
  // <span>, not <button> — rows are already buttons, and a nested <button>
  // is invalid HTML (hydration error). stopPropagation keeps the row click.
  return (
    <span role="button" tabIndex={0} title={tip}
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); openBurnModal({ pct, shares, tx, x: e.clientX, y: e.clientY }); }}
      onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); openBurnModal({ pct, shares, tx, x: r.left + r.width / 2, y: r.bottom }); } }}
      className={cn("inline-flex items-center gap-1 self-center", className)}>
      <Flame className={cn("h-4 w-4 transition", burned ? "text-orange-400" : "text-white/30")} />
      {pill ? (
        <span className={cn("hidden self-center text-xs font-bold leading-4 lg:inline", burned ? "text-orange-400" : "text-white/40")}>
          Burn {pct >= 99.95 ? 100 : pct.toFixed(1)}%
        </span>
      ) : null}
    </span>
  );
}
function TaxTag({ buy, sell, pending, className }: { buy: bigint; sell: bigint; pending?: boolean; className?: string }) {
  const taxed = buy > 0n || sell > 0n;
  const b = Number(buy) / 100, s = Number(sell) / 100;
  const tip = pending
    ? "Reading the token's tax rates…"
    : taxed
      ? `${b}% buy tax · ${s}% sell tax. Locked at deploy, collected to the token's tax wallet`
      : "No buy or sell tax";
  if (pending) {
    return (
      <span title={tip} className={cn("inline-flex shrink-0 items-center gap-1 self-center", className)}>
        <span className="inline-flex h-5 animate-pulse items-center rounded-full border border-white/10 bg-white/[0.03] px-2 text-[10px] font-bold leading-none text-white/40">?/?%</span>
      </span>
    );
  }
  // Inside the pill the "/" char is the divider — left value sits on green
  // (buy tax), right value on red (sell tax).
  return (
    <span title={tip} className={cn("inline-flex shrink-0 items-center gap-1 self-center", className)}>
      <span className="inline-flex h-5 items-stretch overflow-hidden rounded-full border border-white/10">
        <span className="flex items-center bg-emerald-400/15 px-1.5 text-[10px] font-bold leading-none text-white">{b}%</span>
        <span className="flex items-center bg-white/[0.04] px-px text-[10px] font-bold leading-none text-white/50">/</span>
        <span className="flex items-center bg-red-400/15 px-1.5 text-[10px] font-bold leading-none text-white">{s}%</span>
      </span>
    </span>
  );
}
// Token combobox — the input IS the search bar: paste a contract, type to
// filter held tokens by symbol/name/address, or open the list with the arrow.
// The list never pops on focus; typing a partial name opens it with matches,
// a full ase1…/0x… address is treated as free input and resolves below.
function TokenSearchPick({ tokens, value, onChange, placeholder, allowNative }: {
  tokens: (Asset & { balance: string })[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  allowNative?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const q = value.trim().toLowerCase();
  const isAddr = /^0x[0-9a-f]{40}$/i.test(value.trim()) || /^ase1[02-9ac-hj-np-z]{20,}$/i.test(value.trim());
  const filtered = q && !isAddr
    ? tokens.filter((t) =>
        t.symbol.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.address.toLowerCase().includes(q) ||
        toAseAddress(t.address).toLowerCase().includes(q))
    : tokens;
  const aseMatches = Boolean(allowNative && (!q || "ase".includes(q) || "asentum".includes(q)));
  const showList = open || Boolean(q && !isAddr && (filtered.length || aseMatches));
  const close = () => setOpen(false);
  return (
    <div className="relative mt-1.5">
      <div className={cn("flex h-10 items-center rounded-lg border bg-black/30 transition", showList ? "border-accent/40" : "border-white/10 focus-within:border-white/25")}>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") close(); }}
          placeholder={placeholder}
          inputMode="text"
          className="min-w-0 flex-1 bg-transparent px-3 font-mono text-xs text-white placeholder:text-white/45 focus:outline-none" />
        <button type="button" onClick={() => setOpen((o) => !o)} aria-label="Pick from wallet tokens"
          className="mr-1.5 shrink-0 rounded-md p-1.5 text-white/55 transition hover:bg-white/[0.07] hover:text-white">
          <ChevronDown className={cn("h-4 w-4 transition-transform", showList && "rotate-180")} />
        </button>
      </div>
      {showList ? (
        <>
          <div className="fixed inset-0 z-40" onClick={close} />
          <div className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-56 overflow-y-auto rounded-xl border border-white/[0.12] bg-[#0b0d14] p-1 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.9)]">
            {aseMatches ? (
              <button type="button" onClick={() => { onChange(""); close(); }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-white/[0.06]">
                <AseLogo size={24} className="h-6 w-6 rounded-full border border-white/10 object-cover" />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1 text-xs font-semibold text-white"><span className="truncate">ASE</span><OfficialTag addr={NATIVE} className="h-3 w-3" /></span>
                  <span className="block truncate font-mono text-[9px] text-white/50">Asentum native</span>
                </span>
              </button>
            ) : null}
            {filtered.map((t) => (
              <button key={t.address} type="button"
                onClick={() => { onChange(t.address); close(); }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-white/[0.06]">
                <TokenImg src={t.logoUrl} symbol={t.symbol} cls="h-6 w-6 rounded-lg border border-white/10 object-cover text-[8px]" />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1 text-xs font-semibold text-white">
                    <span className="truncate">{t.symbol}</span>
                    {t.fromPad ? <PadTag token={t.address} className="h-3 w-3" /> : null}
                    <OfficialTag addr={t.address} className="h-3 w-3" />
                  </span>
                  <span className="block truncate font-mono text-[9px] text-white/50">{shortenAddress(t.address)}</span>
                </span>
                <span className="font-mono text-[10px] text-white/70">{formatUnits(t.balance, t.decimals, 4)}</span>
              </button>
            ))}
            {!filtered.length && !aseMatches ? <p className="px-3 py-4 text-center text-[11px] text-white/55">{tokens.length ? "No matching held token — paste the contract" : "No held tokens — paste the contract"}</p> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
type PoolRow = { pool: Pool; asset0: Asset; asset1: Asset; seenAt?: number };
type Order = {
  id: string; owner: string; poolId: string; kind: "LIMIT" | "DCA";
  tokenIn: string; amountLeft: string; totalIn: string; minOut: string;
  sliceIn: string; slicesTotal: string; slicesDone: string; intervalSec: string;
  nextTs: string; status: string; createdAt: string; totalOut?: string;
  dex: string;
};
type ViewClient = { view: (to: string, method: string, args?: unknown[], opts?: { bulk?: boolean; wallet?: boolean; urgent?: boolean }) => Promise<unknown> };

type ViewName = "markets" | "radar" | "terminal" | "pools" | "wallet";
const VIEWS: readonly string[] = ["markets", "radar", "terminal", "pools", "wallet"];
const VIEW_TITLES: Record<ViewName, { label: string; img: string }> = {
  markets: { label: "Markets", img: "/brand/markettitle.png" },
  radar: { label: "Radar", img: "/brand/radartitle.png" },
  terminal: { label: "Terminal", img: "/brand/terminaltitle.png" },
  pools: { label: "Pools", img: "/brand/poolstitle.png" },
  wallet: { label: "Wallet", img: "/brand/wallettitle.png" }
};
const poolKey = (dex: string, id: string) => `${dex}:${id}`;
const EMPTY_POOL_ROWS: PoolRow[] = [];
type PoolStat = { volWei: string; volQuoteWei?: string; trades: number; change: number; lastTs: number; lastPrice: number; lastBuy: boolean | null };
const EMPTY_STAT: PoolStat = { volWei: "0", trades: 0, change: 0, lastTs: 0, lastPrice: 0, lastBuy: null };
// 24h % label — a dust pool re-priced by a liquidity seed can legitimately
// compute +5,000,000%; past five figures the number stops being signal, so
// clamp the label and keep the sign instead of printing noise.
function fmtChgPct(v: number): string {
  const a = Math.abs(v);
  if (a >= 9999.5) return `${v >= 0 ? ">+" : ">-"}9,999%`;
  return `${v >= 0 ? "+" : "-"}${a.toFixed(2)}%`;
}
// Small-number formatter — toPrecision flips to "2.99e-7" under 1e-6, which is
// unreadable on a trading UI. Show leading zeros + significant digits instead.
const fmtTiny = (v: number, sig = 4) => {
  if (!Number.isFinite(v) || v <= 0) return "-";
  if (v >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (v >= 0.01) return v.toPrecision(sig).replace(/\.?0+$/, "");
  const fixed = v.toFixed(20);
  const zeros = fixed.slice(2).search(/[1-9]/);
  if (zeros < 0) return "0";
  // More than 3 leading zeros → compact power notation, ≤5 sig digits:
  // 0.0000123456 → 0.0⁴12345. (Wrap output in <PricePower> — raw superscript
  // glyphs box out on some mobile fonts.)
  if (zeros > 3) {
    const sup = String(zeros).replace(/\d/g, (d) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[Number(d)]);
    const significant = fixed.slice(2 + zeros, 2 + zeros + 5).replace(/0+$/, "");
    return `0.0${sup}${significant}`;
  }
  // ≤3 leading zeros → plain, capped at 6 decimals (0.000123 shows as-is).
  return v.toFixed(6).replace(/\.?0+$/, "");
};
const fmtUsd = (v: number) => !Number.isFinite(v) || v <= 0 ? "-" : v >= 1 ? `$${v.toLocaleString(undefined, { maximumFractionDigits: 4 })}` : `$${fmtTiny(v)}`;
// Anything past this is a broken price path, not a real valuation — no pool
// or token on this chain is honestly worth more. USD cells past the cap fall
// back to their token-denominated display.
const MAX_USD_DISPLAY = 2.5e8;
// Compact for big amounts — 42.59M / 1.2K style for depth cells & stats.
const fmtCompact = (v: number) => !Number.isFinite(v) || v <= 0 ? "-"
  : v < 0.001 ? fmtTiny(v)
  : compactNum(v);
const fmtWeiCompact = (wei: string | bigint, decimals = 18) => fmtCompact(Number(safeBig(wei)) / 10 ** decimals);
// Markets row — memoized so the 1s clock tick, sort-pill switches and other
// renders reconcile by keys instead of rebuilding ~400 image/tag subtrees.
// Every prop is a primitive or a stable ref (memoized map, RQ data, stable
// callback), so unchanged rows bail out of rendering entirely.
const MarketListRow = memo(function MarketListRow({ row, volRank, usdRate, priceMap, stat, burnedWei, burnPct, burnShares, burnTx, burnUrl, priceCls, chgCls, lpLockId, tokLockId, isFav, onFav, onOpen, usd }: {
  row: PoolRow;
  volRank: number;
  usdRate: number;
  usd: boolean;
  priceMap: Map<string, { price: number; nativeRes: bigint }>;
  stat?: PoolStat;
  burnedWei: bigint;
  burnPct: number;
  burnShares?: string;
  burnTx?: string;
  burnUrl?: string;
  priceCls: string;
  chgCls: string;
  lpLockId?: { id: string; v2: boolean };
  tokLockId?: { id: string; v2: boolean };
  isFav: boolean;
  onFav: (key: string) => void;
  onOpen: (key: string) => void;
}) {
  const pk = poolKey(row.pool.dex, row.pool.id);
  const nativeRes = safeBig(row.pool.token0 === NATIVE ? row.pool.reserve0 : row.pool.token1 === NATIVE ? row.pool.reserve1 : "0");
  const tokenRes = safeBig(row.pool.token0 === NATIVE ? row.pool.reserve1 : row.pool.token1 === NATIVE ? row.pool.reserve0 : "0");
  const logoAsset = row.asset0.address === NATIVE ? row.asset1 : row.asset0;
  const price = humanPrice(tokenRes.toString(), logoAsset.decimals, nativeRes.toString(), 18);
  const qAsset = row.asset0.address === logoAsset.address ? row.asset1 : row.asset0;
  const qPrice = price === 0 ? humanPrice(
    row.asset0.address === logoAsset.address ? row.pool.reserve0 : row.pool.reserve1,
    logoAsset.decimals,
    row.asset0.address === logoAsset.address ? row.pool.reserve1 : row.pool.reserve0,
    qAsset.decimals
  ) : 0;
  const logoAsePx = priceMap.get(logoAsset.address)?.price ?? 0;
  const qAsePx = priceMap.get(qAsset.address)?.price ?? 0;
  const usdPx = price > 0 ? price * usdRate
    : logoAsePx > 0 ? logoAsePx * usdRate
    : qPrice > 0 && qAsePx > 0 ? qPrice * qAsePx * usdRate
    : 0;
  const supplyNum = (() => {
    const raw = logoAsset.totalSupply ? safeBig(logoAsset.totalSupply) : 0n;
    if (raw <= 0n) return 0;
    const dec = logoAsset.decimals ?? 18;
    // Mixed units: raw chain supply ≥ 10^decimals, human indexer supply below it.
    const human = raw >= 10n ** BigInt(dec) ? Number(raw) / 10 ** dec : Number(raw);
    return Math.max(0, human - Number(burnedWei) / 10 ** dec);
  })();
  const mcUsd = usdPx > 0 && supplyNum > 0 && usdPx * supplyNum <= MAX_USD_DISPLAY ? usdPx * supplyNum : 0;
  const rst = stat ?? EMPTY_STAT;
  const rowDepleted = poolDepleted(row.pool, logoAsset.address, qAsset.address, qAsset.decimals, qAsePx);
  // Hard rule: a pair that would carry the "Low LP" tag never renders in
  // Markets (All/Trending/Gainers/Losers alike).
  if (rowDepleted) return null;
  // Per-leg ASE valuation for the LP cell — ASE leg prices directly, token
  // legs ride their own ASE price (direct pool or hop through token↔token
  // pairs). Both legs priced → honest sum; one priced → balanced estimate;
  // neither → fall back to raw quote units rather than print fantasy zero.
  const legVal = (addr: string, res: string | undefined, dec: number): number => {
    const r = safeBig(res || "0");
    if (r <= 0n) return 0;
    if (addr === NATIVE) return Number(r) / 1e18;
    const l = priceMap.get(addr) ?? priceMap.get(addr.toLowerCase());
    return l ? (Number(r) / 10 ** dec) * l.price : 0;
  };
  const v0 = legVal(row.pool.token0, row.pool.reserve0, row.asset0.decimals);
  const v1 = legVal(row.pool.token1, row.pool.reserve1, row.asset1.decimals);
  let aseLiq = v0 > 0 && v1 > 0 ? v0 + v1 : Math.max(v0, v1) * 2;
  // Fantasy-USD guard — a garbage hop price can't print trillion-dollar LPs;
  // beyond the cap the row falls back to raw quote-token units.
  if (aseLiq * usdRate > MAX_USD_DISPLAY) aseLiq = 0;
  const lpLabel = aseLiq > 0
    ? (usd && usdRate > 0 ? fmtUsd(aseLiq * usdRate) : `${fmtTiny(aseLiq, 2)} ASE`)
    : `${fmtWeiCompact((row.asset0.address === logoAsset.address ? row.pool.reserve1 : row.pool.reserve0).toString(), qAsset.decimals)} ${qAsset.symbol}`;
  // div + onClick (not <button>) so the fav star can be a real button —
  // nested <button> is invalid HTML and React drops the inner handler.
  return (
    <div onClick={() => onOpen(pk)}
      className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-white/[0.04] px-4 py-2.5 text-left transition hover:bg-white/[0.04] md:grid-cols-[minmax(0,1.8fr)_1fr_0.8fr_1fr_1fr_1fr]">
      <span className="flex min-w-0 items-center gap-2.5">
        <button onClick={(e) => { e.stopPropagation(); onFav(pk); }} aria-label={isFav ? "Remove favourite" : "Add favourite"} title={isFav ? "Remove favourite" : "Add favourite"}
          className={cn("-ml-1 shrink-0 p-1 transition", isFav ? "text-amber-300" : "text-white/25 hover:text-white/60")}>
          <Star className={cn("h-3.5 w-3.5", isFav && "fill-amber-300")} />
        </button>
        <TokenImg src={logoAsset.logoUrl} symbol={logoAsset.symbol} cls="h-8 w-8 shrink-0 rounded-lg border border-white/10 object-cover text-[9px]" />
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-1 text-xs font-semibold">
            {logoAsset.symbol}<span className="text-white/45">/{qAsset.symbol}</span>
            {logoAsset.fromPad && qAsset.address === NATIVE ? <PadTag token={logoAsset.address} /> : null}
            <OfficialTag addr={logoAsset.address} />
            <LpBurnTag pct={burnPct} shares={burnShares} tx={burnTx} />
            {lpLockId ? <LockTag id={lpLockId.id} kind="lp" v2={lpLockId.v2} /> : null}
            {tokLockId ? <LockTag id={tokLockId.id} kind="token" v2={tokLockId.v2} /> : null}
            <DexTag dex={row.pool.dex} />
            {volRank > 0 ? <MarketHotTag rank={volRank} /> : null}
          </span>
          <span className="block truncate text-[10px] text-white/45">{logoAsset.name ?? logoAsset.symbol} · Pool #{row.pool.id}</span>
        </span>
      </span>
      <span className="text-right md:contents">
        <span className={cn("block text-right font-mono text-xs", priceCls)}>
          {usdPx > 0 ? fmtUsd(usdPx) : qPrice > 0 ? `${fmtTiny(qPrice, 4)} ${qAsset.symbol}` : "-"}
        </span>
        <span className={cn("block text-right font-mono text-[11px]", chgCls)}>
          {rst.change ? fmtChgPct(rst.change) : "0.0%"}
        </span>
        <span className="hidden text-right font-mono text-[11px] text-white/70 md:block" title={safeBig(rst.volWei) > 0n ? `${fmtWeiCompact(rst.volWei)} ASE` : undefined}>
          {safeBig(rst.volWei) > 0n
            ? (usd && usdRate > 0 ? fmtUsd(Number(safeBig(rst.volWei)) / 1e18 * usdRate) : `${fmtWeiCompact(rst.volWei)} ASE`)
            : "-"}
        </span>
        <span className="hidden text-right font-mono text-[11px] text-white/70 md:block">{lpLabel}</span>
        <span className="hidden text-right font-mono text-[11px] text-white/70 md:block">{mcUsd > 0 ? `$${fmtCompact(mcUsd)}` : "-"}</span>
      </span>
    </div>
  );
});

// Row-shaped loading placeholder — mirrors the real pair-row layout (fav dot
// + logo box + two text lines + right-side number stack) so the swap from
// skeleton → content doesn't jump. Used by Markets/Radar/Pools/Wallet/picker.
const PairRowSkeleton = () => (
  <div className="flex items-center gap-2.5 border-b border-white/[0.04] px-4 py-2.5" aria-hidden>
    <div className="h-3.5 w-3.5 shrink-0 animate-pulse rounded-full bg-white/[0.07]" />
    <div className="h-8 w-8 shrink-0 animate-pulse rounded-lg bg-white/[0.07]" />
    <div className="min-w-0 flex-1 space-y-1.5">
      <div className="h-3 w-28 animate-pulse rounded bg-white/[0.07]" />
      <div className="h-2.5 w-40 max-w-full animate-pulse rounded bg-white/[0.05]" />
    </div>
    <div className="shrink-0 space-y-1.5">
      <div className="ml-auto h-3 w-14 animate-pulse rounded bg-white/[0.07]" />
      <div className="ml-auto h-2.5 w-10 animate-pulse rounded bg-white/[0.05]" />
    </div>
  </div>
);

// Pair-picker modal row — memoized so starring one pair or typing in search
// doesn't re-render the whole list. content-visibility keeps offscreen rows
// cheap to mount so the modal opens instantly.
const PairPickRow = memo(function PairPickRow({ row, isFav, stat, usdRate, priceMap, onOpen, onFav }: {
  row: PoolRow;
  isFav: boolean;
  stat: PoolStat;
  usdRate: number;
  priceMap: Map<string, { price: number; nativeRes: bigint }>;
  onOpen: (key: string) => void;
  onFav: (key: string) => void;
}) {
  const pk = poolKey(row.pool.dex, row.pool.id);
  const logoAsset = row.asset0.address === NATIVE ? row.asset1 : row.asset0;
  const qAsset = row.asset0.address === logoAsset.address ? row.asset1 : row.asset0;
  const nativeRes = safeBig(row.pool.token0 === NATIVE ? row.pool.reserve0 : row.pool.token1 === NATIVE ? row.pool.reserve1 : "0");
  const tokenRes = safeBig(row.pool.token0 === NATIVE ? row.pool.reserve1 : row.pool.token1 === NATIVE ? row.pool.reserve0 : "0");
  const asePx = humanPrice(tokenRes.toString(), logoAsset.decimals, nativeRes.toString(), 18);
  const qPrice = asePx === 0 ? humanPrice(
    row.asset0.address === logoAsset.address ? row.pool.reserve0 : row.pool.reserve1,
    logoAsset.decimals,
    row.asset0.address === logoAsset.address ? row.pool.reserve1 : row.pool.reserve0,
    qAsset.decimals) : 0;
  const logoAsePx = priceMap.get(logoAsset.address)?.price ?? 0;
  const qAsePx = priceMap.get(qAsset.address)?.price ?? 0;
  const usdPx = asePx > 0 ? asePx * usdRate
    : logoAsePx > 0 ? logoAsePx * usdRate
    : qPrice > 0 && qAsePx > 0 ? qPrice * qAsePx * usdRate : 0;
  return (
    <div onClick={() => onOpen(pk)} style={{ contentVisibility: "auto", containIntrinsicSize: "auto 52px" }}
      className="flex w-full cursor-pointer items-center gap-2.5 border-b border-white/[0.04] px-3 py-2.5 transition hover:bg-white/[0.04]">
      <button onClick={(e) => { e.stopPropagation(); onFav(pk); }} aria-label={isFav ? "Remove favourite" : "Add favourite"}
        className={cn("shrink-0 p-1 transition", isFav ? "text-amber-300" : "text-white/25 hover:text-white/60")}>
        <Star className={cn("h-4 w-4", isFav && "fill-amber-300")} />
      </button>
      <TokenImg src={logoAsset.logoUrl} symbol={logoAsset.symbol} cls="h-8 w-8 shrink-0 rounded-lg border border-white/10 object-cover text-[9px]" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-xs font-semibold">
          <span className="truncate">{logoAsset.symbol}</span><span className="text-white/45">/{qAsset.symbol}</span>
          {logoAsset.fromPad && qAsset.address === NATIVE ? <PadTag token={logoAsset.address} className="h-3 w-3" /> : null}
          <OfficialTag addr={logoAsset.address} className="h-3 w-3" />
          <DexTag dex={row.pool.dex} className="sm:h-4 sm:px-1.5 sm:text-[8px]" />
        </span>
        <span className="block truncate text-[10px] text-white/45">{logoAsset.name ?? logoAsset.symbol} · #{row.pool.id}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block font-mono text-xs text-white/85">
          {usdPx > 0 ? fmtUsd(usdPx) : qPrice > 0 ? `${fmtTiny(qPrice, 4)} ${qAsset.symbol}` : "-"}
        </span>
        <span className={cn("block font-mono text-[11px]", stat.change > 0 ? "text-emerald-300" : stat.change < 0 ? "text-red-300" : "text-white/50")}>
          {stat.change ? fmtChgPct(stat.change) : "0.0%"}
        </span>
      </span>
    </div>
  );
});
// Legacy AuraDex orders lack kind/slices fields — normalize to the Order shape.
const toOrder = (o: Partial<Order> & { amountIn?: string; filledOut?: string }, dex: string): Order => ({
  ...o,
  dex,
  kind: o.kind || "LIMIT",
  amountLeft: o.amountLeft ?? o.amountIn ?? "0",
  totalIn: o.totalIn ?? o.amountIn ?? "0",
  minOut: o.minOut ?? "0",
  totalOut: o.totalOut ?? o.filledOut,
  sliceIn: o.sliceIn ?? "0",
  slicesTotal: o.slicesTotal ?? "1",
  slicesDone: o.slicesDone ?? "0",
  intervalSec: o.intervalSec ?? "0",
  nextTs: o.nextTs ?? "0",
  createdAt: o.createdAt ?? "0",
} as Order);
const matchSide = (r: PoolRow, tok: string, side: 0 | 1) => {
  const a = side === 0 ? r.asset0 : r.asset1;
  const t = tok.toLowerCase();
  // toHexAddress maps ase1→hex and echoes non-addresses — covers both encodings
  // plus tickers in one compare.
  return a.symbol.toLowerCase() === t || a.address.toLowerCase() === t || a.address === toHexAddress(t);
};
const matchesPair = (r: PoolRow, a?: string, b?: string) => {
  if (!a) return true;
  if (!b) return matchSide(r, a, 0) || matchSide(r, a, 1);
  return (matchSide(r, a, 0) && matchSide(r, b, 1)) || (matchSide(r, a, 1) && matchSide(r, b, 0));
};
// Token short-link target: a token address URL resolves to that token's best
// ASE pair — deepest native reserve wins, current venue wins ties over legacy.
function bestAsePoolForToken(token: string, rows: PoolRow[]): PoolRow | undefined {
  const t = token.toLowerCase();
  if (!t || t === NATIVE) return undefined;
  let best: PoolRow | undefined, bestRes = 0n;
  for (const r of rows) {
    const n0 = r.pool.token0 === NATIVE, n1 = r.pool.token1 === NATIVE;
    if (!((n0 && r.pool.token1.toLowerCase() === t) || (n1 && r.pool.token0.toLowerCase() === t))) continue;
    const res = safeBig((n0 ? r.pool.reserve0 : r.pool.reserve1) || "0");
    if (!best || res > bestRes || (res === bestRes && isLegacyDex(best.pool.dex) && !isLegacyDex(r.pool.dex))) {
      best = r; bestRes = res;
    }
  }
  return best;
}
// Terminal pool segment forms: /terminal/<ase1|0x token> (ASE-pair short link),
// /terminal/<asedex|aura>/<id>/… (short links), /terminal/<dex>:<id>/… (older
// dex-qualified), /terminal/<id>/… (bare). segs excludes the leading "asedex".
function poolFromSegs(segs: string[], rows: PoolRow[]): PoolRow | undefined {
  if ((segs[0] ?? "").toLowerCase() !== "terminal" || !segs[1]) return undefined;
  // Token address → best ASE pool for that token.
  const tokenHex = (() => { try { return normAddr(segs[1]!); } catch { return ""; } })();
  if (/^0x[0-9a-f]{40}$/.test(tokenHex)) return bestAsePoolForToken(tokenHex, rows);
  let poolId = segs[1]!, tokA = segs[2], tokB = segs[3];
  let venueDex: string | undefined;
  if (!poolId.includes(":") && !/^\d+$/.test(poolId)) {
    venueDex = slugDex(poolId);
    if (venueDex) { poolId = segs[2] ?? ""; tokA = segs[3]; tokB = segs[4]; }
    // /terminal/auras/v2/<id> — v2 slug carries one extra segment.
    if (poolId.toLowerCase() === "v2" && isLegacyDex(venueDex)) {
      venueDex = AURADEX_V2;
      poolId = segs[3] ?? ""; tokA = segs[4]; tokB = segs[5];
    }
  }
  if (poolId.includes(":")) return rows.find((r) => poolKey(r.pool.dex, r.pool.id).toLowerCase() === poolId.toLowerCase());
  if (venueDex) return rows.find((r) => r.pool.dex === venueDex && r.pool.id === poolId && matchesPair(r, tokA, tokB));
  return rows.find((r) => r.pool.id === poolId && matchesPair(r, tokA, tokB));
}

/** Never-throw BigInt for untrusted chain/indexer strings — a garbage field
 *  (e.g. "Probe 25" from a non-template contract) used to crash whole renders.
 *  Bad values degrade to 0n, which fails safe toward no-quote/insufficient. */
const safeBig = (v: unknown): bigint => {
  // Token views (totalSupply/balanceOf/sharesOf) return JSON NUMBERS (1e+27) —
  // String() would yield "1e+27" and throw; BigInt truncates the double to its
  // integer value directly. Strings still go through the digit path.
  try { return BigInt(typeof v === "number" ? Math.trunc(v) : String(v ?? "0")); } catch { return 0n; }
};
/** Whole-wei string or "0" — same trust boundary as safeBig, for stored fields. */
const numStr = (v: unknown): string => {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? BigInt(Math.trunc(v)).toString() : "0";
  return /^\d+$/.test(String(v ?? "")) ? String(v) : "0";
};
// Pool fields the contract serialises as decimal strings — a malformed value
// reaches BigInt call sites all over the UI, so normalise once at ingest.
const POOL_NUM_FIELDS = ["reserve0", "reserve1", "totalShares", "feeBps", "rps0", "rps1", "pot0", "pot1", "price0Cumulative", "price1Cumulative", "volumeAseWei", "swapCount", "lastTs"] as const;
const sanPool = <T extends Record<string, unknown>>(p: T): T => {
  for (const f of POOL_NUM_FIELDS) if (f in p) (p as Record<string, unknown>)[f] = numStr(p[f]);
  return p;
};

function parseUnits(value: string, decimals: number): bigint | null {
  if (!/^\d*(\.\d*)?$/.test(value) || !value || value === ".") return null;
  const [whole = "0", fraction = ""] = value.split(".");
  if (fraction.length > decimals) return null;
  return safeBig(whole || "0") * 10n ** safeBig(decimals) + safeBig((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
}
function formatUnits(value: string | bigint, decimals: number, digits = 4) {
  const n = Number(safeBig(value)) / 10 ** decimals;
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: digits }) : "0";
}

function slipBps(value: string): bigint {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error("Enter slippage with up to 2 decimal places");
  const [whole, fraction = ""] = value.split(".");
  const bps = safeBig(whole) * 100n + safeBig((fraction + "00").slice(0, 2));
  if (bps <= 0n || bps > 5000n) throw new Error("Slippage must be above 0% and no more than 50%");
  return bps;
}
function sqrt(n: bigint) {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + n / x) / 2n; }
  return x;
}
function humanPrice(reserveIn: string, decimalsIn: number, reserveOut: string, decimalsOut: number) {
  const input = Number(reserveIn) / 10 ** decimalsIn;
  const output = Number(reserveOut) / 10 ** decimalsOut;
  return input > 0 ? output / input : 0;
}
function weiToDecimalStr(value: bigint, decimals: number): string {
  const s = value.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals) || "0";
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}
// Bounded concurrency — the read nodes rate-limit, so batch work fans out a
// few calls at a time instead of one Promise.all burst per list.
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) { const i = cursor++; out[i] = await fn(items[i]!, i); }
  });
  await Promise.all(lanes);
  return out;
}
// Token metadata is (near-)immutable — cache it for the session so a token in
// N pools doesn't fire N×6 view calls. Resolved assets also persist to
// sessionStorage so revisits skip the metadata calls entirely.
const assetCache = new Map<string, Promise<Asset>>();
// Tokens absent from every shard index cost a 5-lane resolve walk each pass —
// remember "not indexed" briefly (~the indexer tick) so repeated asset batches
// go straight to chain reads instead of re-walking 404s on every lane.
const resolveMissAt = new Map<string, number>();
const RESOLVE_MISS_TTL = 90_000;
// v4: v3 assets could carry factory totalSupply in whole units (misread as wei).
const ASSET_SS_KEY = "asedex-asset-meta-v6";
let assetSS: Record<string, Asset> | undefined;
function assetSSRead(): Record<string, Asset> {
  if (assetSS === undefined) {
    try { assetSS = JSON.parse(sessionStorage.getItem(ASSET_SS_KEY) || "{}") as Record<string, Asset>; } catch { assetSS = {}; }
  }
  return assetSS ?? {};
}
function assetSSWrite(key: string, asset: Asset) {
  try {
    const { metaBad: _drop, ...rest } = asset;
    assetSSRead()[key] = rest;
    sessionStorage.setItem(ASSET_SS_KEY, JSON.stringify(assetSSRead()));
  } catch { }
}
function tokenAsset(client: ViewClient, token: string, bulk = false): Promise<Asset> {
  const k = token.toLowerCase();
  let p = assetCache.get(k);
  if (!p) {
    const ss = assetSSRead()[k];
    p = ss ? Promise.resolve(ss) : fetchTokenAsset(client, token, bulk);
    assetCache.set(k, p);
    void p.then((a) => {
      // A transient RPC failure resolves to placeholder metadata — evict soon
      // so the next pass retries instead of pinning a junk ticker all session.
      if (a.metaBad) setTimeout(() => { if (assetCache.get(k) === p) assetCache.delete(k); }, 12_000);
      else assetSSWrite(k, a);
    }).catch(() => { if (assetCache.get(k) === p) assetCache.delete(k); });
  }
  return p;
}
/** Seed an API row's joined token metadata (name/symbol/decimals/logo/card/
 *  supply/pad flag) straight into the asset caches — pool and wallet rows
 *  paint their real ticker + logo in the first emit instead of "Unknown"
 *  while per-token resolves run. Only fills ABSENT entries: richer records
 *  already resolved are never clobbered. A sparse seed (name but no logo or
 *  card) is marked metaBad — it paints instantly, self-evicts in ~12s, and
 *  the next tokenAsset call re-resolves through apiResolve/chain so gaps
 *  still fill. Rich seeds persist to session storage like factory assets. */
const seedDbAsset = (addr: string | null | undefined, f: { name?: string | null; symbol?: string | null; decimals?: number | null; logoUrl?: string | null; totalSupply?: string | null; card?: string | null; pad?: boolean | number | null } | undefined) => {
  if (!addr || !f) return;
  const k = addr.toLowerCase();
  if (k === NATIVE) return;
  const { card: meta, logoUrl: cardLogo } = dbCardMeta(f.card);
  const logoUrl = metaStr(f.logoUrl) ?? cardLogo;
  const name = metaStr(f.name), symbol = metaStr(f.symbol);
  if (!name && !symbol && !logoUrl && !meta) return;
  const prev = assetSSRead()[k];
  // Richer records are never clobbered — but a sparse entry (name/symbol only)
  // must not shadow a DB row that carries the logo/card/supply it lacks, or
  // every surface paints initials until a contract read refills the gap.
  if (prev && (prev.logoUrl || prev.meta)) return;
  const rich = Boolean(logoUrl || meta);
  if (!rich && prev) return;
  const asset: Asset = {
    address: addr,
    name: name ?? prev?.name ?? "Unknown token",
    symbol: symbol ?? prev?.symbol ?? `TKN${addr.slice(-4).toUpperCase()}`,
    decimals: f.decimals ?? prev?.decimals ?? 18,
    logoUrl: logoUrl ?? prev?.logoUrl,
    fromPad: Boolean(f.pad) || Boolean(prev?.fromPad),
    totalSupply: numStr(f.totalSupply ?? "0") !== "0" ? numStr(f.totalSupply ?? "0") : prev?.totalSupply,
    meta: meta ?? prev?.meta,
    metaBad: !(logoUrl ?? prev?.logoUrl) && !(meta ?? prev?.meta)
  };
  const cp = assetCache.get(k);
  if (!rich && cp) {
    // A placeholder/metaBad entry must never block the DB's real ticker —
    // upgrade it, but never clobber a fully-resolved asset.
    void cp.then((cur) => {
      const bad = cur.metaBad || /^TKN[0-9A-F]{4}$/.test(cur.symbol || "") || cur.name === "Unknown token";
      if (bad && assetCache.get(k) === cp) assetCache.set(k, Promise.resolve(asset));
    });
    return;
  }
  assetCache.set(k, Promise.resolve(asset));
  if (!asset.metaBad) assetSSWrite(k, asset);
};
/** Display-only ticker clip — "MICROSTRATEGY" → "MICROST…" so 20-char
 *  symbols can't blow up stat cells, buttons or trade labels. Data/logic
 *  always keeps the full symbol; only what reaches the DOM is trimmed. */
const trimSym = (s: string | null | undefined): string => {
  const t = (s ?? "").trim();
  return t.length > 8 ? `${t.slice(0, 7)}…` : t;
};
const metaStr = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim()
    : typeof v === "number" && Number.isFinite(v) ? String(v)
    : null;
// Creator card (description + socials) rides the same launch `meta` / factory
// `config.metadata` JSON as logoUrl — keep it so info panels render the card
// without another fetch.
const pickTokenMeta = (m: unknown): TokenCard | undefined => {
  const o = (m ?? {}) as Record<string, unknown>;
  const out: TokenCard = {
    description: metaStr(o.description) ?? undefined,
    website: metaStr(o.website) ?? undefined,
    twitter: metaStr(o.twitter) ?? undefined,
    telegram: metaStr(o.telegram) ?? undefined
  };
  return out.description || out.website || out.twitter || out.telegram ? out : undefined;
};
// DB card JSON comes in two shapes: launch `meta_json` stores the card flat
// ({logoUrl, description, ...}); factory `card_json` is the whole deploy
// config with the card nested under `config.metadata`. Both resolve here —
// top-level lookups alone leave every factory token logo-less.
const dbCardMeta = (raw: unknown): { card?: TokenCard; logoUrl?: string } => {
  try {
    const o = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!o || typeof o !== "object") return {};
    const rec = o as Record<string, unknown>;
    const nested = rec.metadata && typeof rec.metadata === "object" ? rec.metadata as Record<string, unknown> : rec;
    return { card: pickTokenMeta(nested), logoUrl: metaStr(nested.logoUrl) ?? metaStr(rec.logoUrl) ?? undefined };
  } catch { return {}; }
};
// Launch meta and factory config.metadata each carry whatever the creator
// filled in — merge per-field (launch wins) so a sparse launch card never
// hides a social/logo the factory record does carry.
const mergeTokenMeta = (a?: TokenCard, b?: TokenCard): TokenCard | undefined => {
  if (!a && !b) return undefined;
  const out: TokenCard = {
    description: a?.description ?? b?.description,
    website: a?.website ?? b?.website,
    twitter: a?.twitter ?? b?.twitter,
    telegram: a?.telegram ?? b?.telegram
  };
  return out.description || out.website || out.twitter || out.telegram ? out : undefined;
};
// A re-read that partially fails (429 blip) must never erase fields a previous
// read already resolved — rows merge forward, never regress.
const mergeAsset = (prev: Asset | undefined, next: Asset | undefined): Asset | undefined => {
  if (!next) return prev;
  if (!prev) return next;
  return {
    ...next,
    name: next.name || prev.name,
    symbol: next.symbol || prev.symbol,
    logoUrl: next.logoUrl ?? prev.logoUrl,
    meta: next.meta ?? prev.meta,
    fromPad: next.fromPad ?? prev.fromPad,
    totalSupply: next.totalSupply ?? prev.totalSupply
  };
};
async function fetchTokenAsset(client: ViewClient, token: string, bulk = false): Promise<Asset> {
  if (token === NATIVE) return { address: NATIVE, name: "Asentum", symbol: "ASE", decimals: 18 };
  const o = { bulk };
  // DB fast path — /api/resolve answers name/symbol/decimals/logo/card/supply/
  // launch in one read, replacing the whole six-view batch for indexed tokens.
  // Misses and meta gaps fall through to the live reads below untouched.
  {
    const k = token.toLowerCase();
    const miss = (resolveMissAt.get(k) ?? 0) > Date.now();
    const r = miss ? null : await apiResolve(token).catch(() => null);
    if (!miss && !r?.found) resolveMissAt.set(k, Date.now() + RESOLVE_MISS_TTL);
    if (r?.found && (r.token || r.launch)) {
      const t = (r.token ?? {}) as Record<string, unknown>;
      const lm = (r.launch ?? {}) as Record<string, unknown>;
      const lmCard = dbCardMeta(lm.meta_json);
      const tkCard = dbCardMeta(t.card_json);
      const card = mergeTokenMeta(lmCard.card, tkCard.card);
      let logoUrl = lmCard.logoUrl ?? tkCard.logoUrl ?? metaStr(t.logo_url) ?? undefined;
      const name = metaStr(t.name);
      const symbol = metaStr(t.symbol);
      const totalSupply = numStr(t.total_supply) !== "0" ? numStr(t.total_supply)
        : [lm.curve_supply, lm.supply].map(numStr).find((s) => s !== "0") ?? "0";
      const prev = assetSSRead()[token.toLowerCase()];
      // Only answer when the DB row carries real metadata — a launched-token
      // stub (launch row exists, meta_json not yet hydrated) or meta-less
      // registry stub must fall through so the live reads resolve logo/card
      // from getLaunch + the token contract like before. Pad launches answer
      // on name/symbol alone: their launch record IS the authoritative meta
      // source, so a missing card/logo can't be fixed by a chain read — it
      // would only buy a seconds-long "Resolving token" stall.
      if ((name || symbol) && (card || logoUrl || r.type === "launch")) return {
        address: token,
        name: name ?? prev?.name ?? "Unknown token",
        symbol: symbol ?? prev?.symbol ?? `TKN${token.slice(-4).toUpperCase()}`,
        decimals: Number(t.decimals) || prev?.decimals || 18,
        logoUrl: logoUrl ?? prev?.logoUrl,
        fromPad: r.type === "launch" || Boolean(r.launch),
        totalSupply: totalSupply !== "0" ? totalSupply : prev?.totalSupply,
        meta: card ?? prev?.meta,
        metaBad: name === null && symbol === null && !prev
      };
    }
  }
  // The card lives in factory config.metadata too — the registry syncs lazily
  // inside tokenAssetsBatch. Kick it off in the background rather than gating
  // the token's own reads on the (huge, rate-limited) sweep: the launch record
  // usually carries card+supply, so the registry is only awaited when both miss.
  const refresh = factoryTokensKnown().length
    ? null
    : factoryTokensRefresh((a, m, args, so) => client.view(a, m, args, so)).catch(() => factoryTokensKnown());
  // AWS-only: no contract reads for display meta. A token the API resolve
  // missed is either brand-new (indexer tick ~1min picks it up) or carries no
  // indexed meta — the factory registry (also AWS-backed) is the last source.
  if (refresh) await refresh;
  let logoUrl: string | undefined;
  let card: TokenCard | undefined;
  const fromPad = false;
  let totalSupply = "0";
  const fTok = factoryTokensKnown().find((f) => f.token === token.toLowerCase());
  if (fTok) {
    logoUrl = fTok.logoUrl;
    card = fTok.meta;
    totalSupply = numStr(fTok.totalSupply);
  }
  const name = fTok?.name ?? null;
  const symbol = fTok?.symbol ?? null;
  const decimals = fTok?.decimals ?? null;
  if (totalSupply === "0") totalSupply = numStr(fTok?.totalSupply);
  // Failed resolves render as a recognisable placeholder — never raw
  // address digits — and metaBad schedules a retry via the cache above.
  const asset: Asset = {
    address: token,
    name: name ?? "Unknown token",
    symbol: symbol ?? `TKN${token.slice(-4).toUpperCase()}`,
    decimals: Number(decimals) || 18,
    logoUrl, fromPad, totalSupply,
    meta: card ?? fTok?.meta,
    metaBad: name === null || symbol === null
  };
  // A transient RPC blip must not blank a previously-good card — reuse the
  // session-cached fields the fresh read missed. metaBad stays set so the
  // cache still schedules the retry instead of pinning the merge.
  const prev = assetSSRead()[token.toLowerCase()];
  if (prev && prev.name && prev.name !== "Unknown token") {
    asset.logoUrl ??= prev.logoUrl;
    asset.meta ??= prev.meta;
    if (!asset.fromPad) asset.fromPad = Boolean(prev.fromPad);
    if (asset.totalSupply === "0" && prev.totalSupply && prev.totalSupply !== "0") asset.totalSupply = prev.totalSupply;
    if (asset.metaBad) { asset.name = prev.name; asset.symbol = prev.symbol; asset.decimals = prev.decimals; }
  }
  return asset;
}
/** Batched metadata: one JSON-RPC batch resolves name/symbol/decimals/
 *  logoUrl/totalSupply/getLaunch for every uncached token — ~6 calls each
 *  become a fraction of one POST. Resolved assets seed the same caches as
 *  tokenAsset so nothing is ever read twice. */
async function tokenAssetsBatch(client: ViewClient, tokens: string[], bulk = false, lane?: { wallet?: boolean; bulk?: boolean }): Promise<Map<string, Asset>> {
  const out = new Map<string, Asset>();
  const missing: string[] = [];
  // Cache/session hits answer without any registry sync or RPC — a cold
  // factory sweep must not gate metadata the DB seeds already resolved.
  const uncached: string[] = [];
  await Promise.all(tokens.map(async (t) => {
    if (t === NATIVE) { out.set(t, ASE_ASSET); return; }
    const k = t.toLowerCase();
    if (assetCache.has(k) || assetSSRead()[k]) {
      const cached = await tokenAsset(client, t, bulk);
      // A SPARSE cached asset (no logo AND no card — early pool-leg or D1
      // seeds carry name/symbol only) must not short-circuit: it shadowed
      // every later logoUrl/metadata/getLaunch read, which is why held
      // tokens kept blank logos while richer rows painted. The write-back
      // below upgrades the shared cache for every surface.
      if (cached.logoUrl || cached.meta) { out.set(t, cached); return; }
    }
    uncached.push(t);
  }));
  // Factory genesis config already carries name/symbol/decimals/logo/supply —
  // immutable, so it IS the metadata and needs no contract read. Sync the
  // registry when it's empty (one batched delta) before seeding — but only
  // when something the caches couldn't answer still needs it.
  // Never AWAIT the registry here: on a fresh browser it's a full sync of
  // every factory token, and gating on it left held rows unpainted for
  // minutes. Kick it in the background; tokens it can't answer yet take the
  // direct contract reads below (a few calls each, one batched POST).
  if (uncached.length && !factoryTokensKnown().length) void factoryTokensRefresh((a, m, args, o) => client.view(a, m, args, o)).catch(() => factoryTokensKnown());
  const fIdx = new Map(factoryTokensKnown().map((f) => [f.token, f]));
  for (const t of uncached) {
    const k = t.toLowerCase();
    const f = fIdx.get(k);
    // Pad-launched tokens skip the seed — their card lives in the launch
    // record (getLaunch), which the batch below already reads. The factory
    // registers them under the "ASEPAD" archetype. A SPARSE factory record
    // (name/symbol but empty metadata) must not short-circuit the reads
    // either — the token's own logoUrl/totalSupply/getLaunch views fill
    // gaps the registry never captured (e.g. logo set only on-contract).
    if (f?.name && f.symbol && f.decimals != null && f.archetype !== "ASEPAD"
        && f.logoUrl && f.meta && f.totalSupply) {
      const asset: Asset = {
        address: t, name: f.name, symbol: f.symbol, decimals: f.decimals,
        logoUrl: f.logoUrl, fromPad: false,
        totalSupply: f.totalSupply ? numStr(f.totalSupply) : "0",
        meta: f.meta
      };
      assetCache.set(k, Promise.resolve(asset));
      assetSSWrite(k, asset);
      out.set(t, asset);
      continue;
    }
    missing.push(t);
  }
  if (!missing.length) return out;
  // DB resolve pass — the shards already know name/symbol/decimals/logo/
  // card for indexed tokens (factory registry, pad launches, replicas). A
  // rich row leaves `missing` entirely; a sparse one stays so the batch
  // below pays chain reads only for fields the index genuinely lacks.
  const stillMissing: string[] = [];
  const now = Date.now();
  // One batched call for the whole missing set — the per-token /resolve loop
  // used to fire ~90 requests on a Markets paint. Tokens the batch can't
  // answer (non-hex edge cases) fall through to chain reads as before.
  const queryable = missing.filter((t) => (resolveMissAt.get(t.toLowerCase()) ?? 0) <= now);
  const batch = queryable.length ? await apiResolveBatch(queryable).catch(() => null) : null;
  for (const t of missing) {
    const k = t.toLowerCase();
    // Recently-missed tokens skip the lane walk — every shard 404s them and
    // the chain batch below is the only real source until an indexer tick
    // (~1 min) picks them up.
    const miss = (resolveMissAt.get(k) ?? 0) > now;
    if (miss) { stillMissing.push(t); continue; }
    const r = batch?.resolves?.[k] ?? (queryable.includes(t) ? null : await apiResolve(t).catch(() => null));
    const tr = (r?.token ?? null) as Record<string, unknown> | null;
    const lm = (r?.launch ?? null) as Record<string, unknown> | null;
    const name = metaStr(tr?.name), symbol = metaStr(tr?.symbol);
    if (!r?.found || !tr || (!name && !symbol)) {
      if (!r?.found) resolveMissAt.set(k, now + RESOLVE_MISS_TTL);
      stillMissing.push(t);
      continue;
    }
    const lmCard = dbCardMeta(lm?.meta_json), tkCard = dbCardMeta(tr.card_json);
    const asset: Asset = {
      address: t,
      name: name ?? "Unknown token",
      symbol: symbol ?? `TKN${t.slice(-4).toUpperCase()}`,
      decimals: Number(tr.decimals) || 18,
      logoUrl: lmCard.logoUrl ?? tkCard.logoUrl ?? metaStr(tr.logo_url) ?? undefined,
      fromPad: r.type === "launch" || Boolean(lm?.token),
      totalSupply: numStr(tr.total_supply) !== "0" ? numStr(tr.total_supply)
        : [lm?.curve_supply, lm?.supply].map(numStr).find((s) => s !== "0") ?? "0",
      meta: mergeTokenMeta(lmCard.card, tkCard.card),
      metaBad: false
    };
    asset.metaBad = !asset.logoUrl && !asset.meta;
    const prev = assetSSRead()[k];
    if (prev && prev.name && prev.name !== "Unknown token") {
      asset.logoUrl ??= prev.logoUrl;
      asset.meta ??= prev.meta;
      if (!asset.fromPad) asset.fromPad = Boolean(prev.fromPad);
      if (asset.totalSupply === "0" && prev.totalSupply && prev.totalSupply !== "0") asset.totalSupply = prev.totalSupply;
    }
    assetCache.set(k, Promise.resolve(asset));
    // Sparse seed — paints now, self-evicts, and the chain batch still runs
    // for it (logo/supply gaps live on-contract, not in the index row).
    if (asset.metaBad) { setTimeout(() => assetCache.delete(k), 12_000); stillMissing.push(t); }
    else assetSSWrite(k, asset);
    out.set(t, asset);
  }
  missing.length = 0;
  missing.push(...stillMissing);
  if (!missing.length) return out;
  // Selective reads — the factory registry already answers name/symbol/
  // decimals/totalSupply for deployed tokens, so a registered token costs
  // ~3 calls (getLaunch + logoUrl + supply-if-missing) instead of 6. Only
  // unregistered tokens pay the full card read. The `k` map records each
  // call's result index since slot positions vary per token.
  const calls: { to: string; method: string; args?: unknown[] }[] = [];
  const plans = missing.map((t) => {
    const f = fIdx.get(t.toLowerCase());
    const k: Record<string, number> = {};
    const add = (key: string, to: string, method: string, args: unknown[] = []) => { k[key] = calls.length; calls.push({ to, method, args }); };
    if (!f?.name) add("name", t, "name");
    if (!f?.symbol) add("symbol", t, "symbol");
    if (f?.decimals == null) add("decimals", t, "decimals");
    if (PAD) add("launch", PAD, "getLaunch", [t]);
    if (!f?.logoUrl) add("logo", t, "logoUrl");
    if (!f?.totalSupply) add("supply", t, "totalSupply");
    // Token-level metadata() view — card home for tokens the factory
    // registry never catalogued (external/legacy deployments).
    if (!f?.meta) add("tmeta", t, "metadata");
    return { f, k };
  });
  // No chain reads — tokens the DB/factory/resolve lanes can't answer paint
  // sparse (symbol fallback) instead of firing a per-token view batch.
  const res: unknown[] = [];
  missing.forEach((t, i) => {
    const { f: fT, k: slots } = plans[i]!;
    const at = (key: string) => (slots[key] !== undefined ? res[slots[key]] : undefined);
    const [nameRaw, symbolRaw, decimals, launchRaw, tokenLogo, supplyRaw, tokenMetaRaw] = [
      at("name"), at("symbol"), at("decimals"), at("launch") ?? "null", at("logo"), at("supply"), at("tmeta")
    ];
    let logoUrl: string | undefined;
    let card: TokenCard | undefined;
    let fromPad = false;
    let launch: { token?: string; meta?: unknown; supply?: string; totalSupply?: string } | null = null;
    try {
      launch = JSON.parse(String(launchRaw || "null"));
      if (launch && launch.token) fromPad = true;
      const meta = typeof launch?.meta === "string" ? JSON.parse(launch.meta || "{}") : launch?.meta;
      logoUrl = typeof meta?.logoUrl === "string" ? meta.logoUrl : undefined;
      card = pickTokenMeta(meta);
    } catch { }
    try {
      const tm = JSON.parse(String(tokenMetaRaw || "null"));
      if (tm && typeof tm === "object") {
        card = mergeTokenMeta(card, pickTokenMeta(tm));
        if (!logoUrl) { const l = metaStr(tm.logoUrl); if (l && /^https:\/\//i.test(l)) logoUrl = l; }
      }
    } catch { }
    if (!logoUrl && typeof tokenLogo === "string" && /^https:\/\//i.test(tokenLogo)) logoUrl = tokenLogo;
    logoUrl ??= fT?.logoUrl;
    card = mergeTokenMeta(card, fT?.meta);
    const name = metaStr(nameRaw) ?? fT?.name ?? null;
    const symbol = metaStr(symbolRaw) ?? fT?.symbol ?? null;
    // Same supply fallback as fetchTokenAsset — launch record, then factory.
    const supply = numStr(supplyRaw);
    const totalSupply = supply !== "0" ? supply
      : [launch?.supply, launch?.totalSupply, fT?.totalSupply]
          .map(numStr).find((s) => s !== "0") ?? "0";
    const asset: Asset = {
      address: t,
      name: name ?? "Unknown token",
      symbol: symbol ?? `TKN${t.slice(-4).toUpperCase()}`,
      decimals: fT?.decimals ?? (Number(decimals) || 18),
      logoUrl, fromPad, totalSupply,
      meta: card,
      metaBad: name === null || symbol === null
    };
    const k = t.toLowerCase();
    // Same blip-merge as fetchTokenAsset — a 429'd sweep pass must not blank
    // a logo/card the session already resolved.
    const prev = assetSSRead()[k];
    if (prev && prev.name && prev.name !== "Unknown token") {
      asset.logoUrl ??= prev.logoUrl;
      asset.meta ??= prev.meta;
      if (!asset.fromPad) asset.fromPad = Boolean(prev.fromPad);
      if (asset.totalSupply === "0" && prev.totalSupply && prev.totalSupply !== "0") asset.totalSupply = prev.totalSupply;
      if (asset.metaBad) { asset.name = prev.name; asset.symbol = prev.symbol; asset.decimals = prev.decimals; }
    }
    // No chain reads behind `res` — this pass only merges session leftovers,
    // so the DB-resolved asset must win name/symbol instead of being replaced
    // by a bare placeholder.
    const best = mergeAsset(asset, out.get(t)) ?? asset;
    assetCache.set(k, Promise.resolve(best));
    if (best.metaBad) setTimeout(() => assetCache.delete(k), 12_000);
    else assetSSWrite(k, best);
    out.set(t, best);
  });
  return out;
}
type TaxInfo = { buy: bigint; sell: bigint; bad?: boolean };
// Tax rates are genesis-locked, but a failed read must NOT cache as 0/0 —
// a taxed token read during an RPC blip looks identical to a standard token
// (which genuinely has no tax views) until retried. Retry a bad read up to
// twice; after that accept it — standard tokens settle on 0/0, taxed ones
// heal once the node answers.
const taxCache = new Map<string, Promise<TaxInfo>>();
const taxAttempts = new Map<string, number>();
// Confirmed-read keys — sweeps skip these entirely (rates are genesis-locked).
const taxSettled = new Set<string>();
const seedTax = (k: string, buy: bigint, sell: bigint) => {
  taxCache.set(k, Promise.resolve({ buy, sell }));
  taxSettled.add(k);
  taxAttempts.delete(k);
};
// Registry shortcut — the factory already knows every token's archetype and
// TAX records carry the genesis-locked bps in config. STANDARD and pad
// launches are 0/0 by construction. Only tokens the registry can't classify
// need a contract probe at all.
function registryTax(addr: string): TaxInfo | null {
  const f = factoryTokensKnown().find((t) => t.token === addr.toLowerCase());
  if (!f) return null;
  if (f.archetype === "TAX" && f.buyBps != null) return { buy: safeBig(f.buyBps), sell: safeBig(f.sellBps ?? 0) };
  if (f.archetype === "STANDARD" || f.archetype === "ASEPAD") return { buy: 0n, sell: 0n };
  return null;
}
function tokenTaxOf(client: ViewClient, addr: string, allowChain = false): Promise<TaxInfo> {
  const k = addr.toLowerCase();
  // Signing path upgrades a display-cached "unknown" to a real chain read —
  // never sign with a maybe-wrong tax estimate.
  if (allowChain && !taxSettled.has(k)) {
    const fresh = fetchTax(client, addr, true);
    taxCache.set(k, fresh);
    return fresh;
  }
  let p = taxCache.get(k);
  if (!p) {
    p = fetchTax(client, addr, allowChain);
    taxCache.set(k, p);
    void p.then((t) => {
      if (!t.bad) { taxSettled.add(k); return; }
      const tries = (taxAttempts.get(k) ?? 0) + 1;
      taxAttempts.set(k, tries);
      if (tries < 3) setTimeout(() => { if (taxCache.get(k) === p) taxCache.delete(k); }, 12_000);
      else taxCache.set(k, Promise.resolve({ ...t, bad: false }));
    }).catch(() => { if (taxCache.get(k) === p) taxCache.delete(k); });
  }
  return p;
}
async function fetchTax(_client: ViewClient, addr: string, allowChain = false): Promise<TaxInfo> {
  const reg = registryTax(addr);
  if (reg) return reg;
  // Display path is AWS-only: unregistered tokens resolve ?/? until the
  // indexer classifies them. Only the user-driven signing path (allowChain)
  // may still probe the contract — wrong tax math there costs a revert.
  if (!allowChain) return { buy: 0n, sell: 0n, bad: true };
  const res = await viewContractBatch<unknown>([
    { to: addr, method: "buyTaxBps" }, { to: addr, method: "sellTaxBps" }, { to: addr, method: "symbol" }
  ]);
  const b = res[0] == null ? null : safeBig(String(res[0] || "0"));
  const s = res[1] == null ? null : safeBig(String(res[1] || "0"));
  const alive = res[2] != null;
  const standard = alive && b === null && s === null;
  return { buy: b ?? 0n, sell: s ?? 0n, bad: (b === null || s === null) && !standard };
}
// ── Wallet holding stores. ──
// LP shares keep per-owner snapshots in localStorage — a reload renders the
// last-known positions instantly while the query refreshes (sessionStorage
// died with the tab). Refetches are incremental: each tick re-probes only
// what can move, and a full sweep runs at most every FULL_SWEEP_MS.
// Token balances need none of that: the explorer indexer returns the whole
// portfolio in one call, so held tokens keep only an in-memory prev-list for
// paint continuity across refetches — nothing persists.
type ShareEntry = { key: string; shares: string; rewards: string };
type ShareStore = { fullAt: number; probed: string[]; entries: ShareEntry[] };
type HeldToken = Asset & { balance: string };
const FULL_SWEEP_MS = 180_000;
const shareStores = new Map<string, ShareStore>();
const heldStores = new Map<string, HeldToken[]>();
// Multibalance helper contract — batches up to ~50 balanceOf probes into ONE
// view call (chain-side E() loops). A cold wallet sweep over ~1300 candidates
// drops from ~1300 rate-limited reads to ~26. Deployed by the platform; pure
// view helper, no state, no admin.
// Wallet discovery probes ride JSON-RPC batching (viewContractBatch) — no
// helper contract; the node's /view context blocks cross-contract E() anyway.
// Wallets whose first balance sweep has fully completed this session — the
// render latches on this instead of isFetching (which flips on every 30s
// refetch and would keep "Loading…" up forever).
const heldSettledOwners = new Set<string>();
// Cold-tail throttle — the hot wave (held/traded/journaled candidates) still
// re-probes every refetch, but the multi-thousand-token registry tail only
// needs a re-sweep every few minutes. New tokens still appear via the live
// journal/seen sets, which rank hot.
const heldColdSweptAt = new Map<string, number>();
const HELD_COLD_SWEEP_MS = 4 * 60_000;
// Tail progress survives aborted sweeps: each probed cold candidate lands here
// so a navigation-killed run RESUMES at its cursor instead of restarting at the
// head of a multi-thousand-token queue (a whale wallet pinned at the indexer
// fast-lane cap of 60 forever while every restart re-marked the sweep done).
const heldTailDone = new Map<string, Set<string>>();
// Factory registry cache — records are immutable, so they persist forever and
// only the delta past the cached count ever needs a chain read.
type FactoryTok = { token: string; creator: string; archetype: string; name?: string; symbol?: string; decimals?: number; logoUrl?: string; totalSupply?: string; buyBps?: number; sellBps?: number; meta?: TokenCard };
let factoryTokensCache: { count: number; tokens: FactoryTok[] } | null = null;
let factoryTokensInflight: Promise<FactoryTok[]> | null = null;
function factoryTokensKnown(): FactoryTok[] {
  if (!factoryTokensCache) factoryTokensCache = lsRead("asedex:factory-tokens:v3") ?? { count: 0, tokens: [] };
  return factoryTokensCache.tokens;
}
function factoryTokensRefresh(view: (a: string, m: string, args?: unknown[], o?: { bulk?: boolean; wallet?: boolean; urgent?: boolean }) => Promise<unknown>): Promise<FactoryTok[]> {
  // Mount kick, fetchTokenAsset and tokenAssetsBatch can all arrive while the
  // registry is still cold — share one sync instead of fanning the delta out
  // per caller.
  factoryTokensInflight ??= factoryTokensSync(view).finally(() => { factoryTokensInflight = null; });
  return factoryTokensInflight;
}
async function factoryTokensSync(_view: (a: string, m: string, args?: unknown[], o?: { bulk?: boolean; wallet?: boolean; urgent?: boolean }) => Promise<unknown>): Promise<FactoryTok[]> {
  // AWS tokens table is the registry — no tokenCount/getToken chain reads.
  const cached = factoryTokensCache ?? lsRead<{ count: number; tokens: FactoryTok[] }>("asedex:factory-tokens:v3") ?? { count: 0, tokens: [] };
  const res = await apiTokens({ limit: 10000 }).catch(() => null);
  if (!res?.tokens) return cached.tokens;
  const byAddr = new Map(cached.tokens.map((t) => [t.token, t]));
  for (const t of res.tokens) {
    const addr = String(t.address || "").toLowerCase();
    if (!addr || byAddr.has(addr)) continue;
    let card: { buyTaxBps?: number; sellTaxBps?: number; metadata?: { logoUrl?: string; description?: string; website?: string; twitter?: string; telegram?: string } } = {};
    try { card = JSON.parse(String(t.card_json || "{}")); } catch { }
    byAddr.set(addr, {
      token: addr,
      creator: String(t.creator || "").toLowerCase(),
      archetype: String(t.kind || ""),
      name: t.name ?? undefined,
      symbol: t.symbol ?? undefined,
      decimals: t.decimals ?? undefined,
      logoUrl: t.logo_url ?? card.metadata?.logoUrl,
      meta: pickTokenMeta(card.metadata),
      totalSupply: t.total_supply ?? undefined,
      buyBps: card.buyTaxBps != null ? Number(card.buyTaxBps) : undefined,
      sellBps: card.sellTaxBps != null ? Number(card.sellTaxBps) : undefined
    });
  }
  const tokens = [...byAddr.values()];
  factoryTokensCache = { count: tokens.length, tokens };
  lsWrite("asedex:factory-tokens:v3", factoryTokensCache);
  return tokens;
}
function lsRead<T>(key: string): T | null {
  try { return JSON.parse(localStorage.getItem(key) || "null") as T | null; } catch { return null; }
}
function lsWrite(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { }
}
function shareStoreOf(owner: string): ShareStore | null {
  if (!owner) return null;
  let s = shareStores.get(owner);
  if (!s) {
    // localStorage is the durable store; fall back to a sessionStorage entry
    // written by older code so the first load after this ships still paints.
    s = lsRead<ShareStore>(`asedex:shares:${owner}`)
      ?? ssRead<ShareStore>(`asedex:shares:${owner}`) ?? undefined;
    if (s) shareStores.set(owner, s);
  }
  return s ?? null;
}
function ssRead<T>(key: string): T | null {
  try { return JSON.parse(sessionStorage.getItem(key) || "null") as T | null; } catch { return null; }
}
// Holder reads: holderAt(i) is immutable once written; one holderCount read
// gates each balance sweep (max ~1 sweep / 20s / token, only while the tab is open).
const dexHolderAddrCache = new Map<string, Promise<string>>();
const dexHolderSweep = new Map<string, { at: number; count: number; out: { rows: { address: string; balance: bigint; tag?: string }[]; supply: bigint; count: number; creator?: string } }>();
function tokenDexGate(client: ViewClient, token: string): Promise<DexGate> {
  const k = token.toLowerCase();
  const e = gateCache.get(k);
  if (e && Date.now() - e.t < e.ttl) return e.p;
  const p = fetchDexGate(client, token);
  const entry = { t: Date.now(), ttl: 60_000, p };
  // Locked/migrating is transitional — a launch flips to MIGRATED at any
  // moment, so it re-checks quickly instead of holding a stale lock for a
  // minute. Unlocked is effectively permanent and keeps the full TTL.
  p.then((g) => { if (g.locked || g.migrating) entry.ttl = 8_000; }).catch(() => { });
  gateCache.set(k, entry);
  return p;
}
async function fetchDexGate(client: ViewClient, token: string): Promise<DexGate> {
  if (token === NATIVE || !/^0x[0-9a-f]{40}$/i.test(token)) return { locked: false, migrating: false, status: "" };
  // DB fast path — one API read replaces the three-view batch. A definitive
  // pad row answers directly; unknown/not-pad falls through to the live reads
  // so nothing gates on a stale-missing index row.
  const g = await apiGate(token).catch(() => null);
  // The AWS launches index is complete (all-domain mode) — its verdict is
  // definitive both ways. A pad row answers the real lock state; a miss means
  // the token is simply not a pad launch, so nothing needs a chain read.
  if (g) return g.pad
    ? { locked: g.locked, migrating: g.migrating, status: g.migrated ? "MIGRATED" : g.migrating ? "MIGRATING" : "BONDING" }
    : { locked: false, migrating: false, status: "" };
  // API dark — no chain fallback. A missed pad token would surface unlocked
  // here, but the on-chain gate still reverts its approve/add-liquidity tx,
  // so the worst case is a reverted user action, never a wrong display.
  return { locked: false, migrating: false, status: "" };
}
// Pools stream in a few at a time so rows appear progressively (1, 2, 3…)
// instead of one burst — gentler on the RPC and shows what's loading. Slots
// are pre-seeded with the previously-known rows so a refresh updates in place
// and a failed getPool can never make a row vanish.
// Live-patch overlay: the chain listener writes the freshest row for each pool
// an event touched. An in-flight sweep emits from slots seeded at its start —
// without this it would overwrite a just-patched pool with its older row, and
// drop a just-created pool its id list never enumerated.
const livePoolRows = new Map<string, { row: PoolRow; at: number }>();
// Hydrated-pool truth: once a real getPool lands for an indexer-built row
// (lazy select/LP hydration, live event patch, LP tx patch), the real pool +
// resolved assets are authoritative for the session. Rebuilding a synthetic
// row from /api/pairs must never roll a hydrated row back to fake reserves —
// every emit also re-applies this overlay so an in-flight sweep can't clobber
// a just-patched pool mid-flight (the "…"-flicker).
const hydratedRows = new Map<string, { pool: Pool; asset0: Asset; asset1: Asset }>();
/** Re-apply hydrated pool truth over any emitted row list. */
const fixHydrated = (rows: PoolRow[]): PoolRow[] => {
  if (!hydratedRows.size) return rows;
  return rows.map((r) => {
    const h = hydratedRows.get(poolKey(r.pool.dex, r.pool.id));
    return h ? { ...r, pool: h.pool, asset0: h.asset0, asset1: h.asset1 } : r;
  });
};
/** Batched tax probe over a sweep's unprobed tokens — registry answers
 *  (pad launches 0/0, factory STANDARD 0/0, factory TAX locked bps) settle
 *  without a contract read; the rest need one buy/sellTaxBps batch. */
async function sweepTaxes(client: ViewClient, toks: string[], metas: Map<string, Asset>): Promise<void> {
  const unprobed = toks.filter((t) => t !== NATIVE && !taxSettled.has(t.toLowerCase()));
  const needProbe = unprobed.filter((t) => {
    const k = t.toLowerCase();
    const reg = metas.get(t)?.fromPad ? { buy: 0n, sell: 0n } : registryTax(t);
    if (reg) { seedTax(k, reg.buy, reg.sell); return false; }
    return true;
  });
  if (!needProbe.length) return;
  // No chain tax probes — tokenTaxOf resolves on demand inside the terminal
  // quote path instead of sweeping every pool token here.
}
const overlayRow = (dex: string, r: PoolRow | null, id: string, refreshedAt: number) => {
  const live = livePoolRows.get(poolKey(dex, id));
  return live && live.at > refreshedAt ? { ...live.row, seenAt: r?.seenAt ?? live.row.seenAt } : r;
};
/** Overlay rows for `dex` that the sweep's own id/uncovered set doesn't cover. */
const liveExtras = (dex: string, covered: Set<string>) =>
  [...livePoolRows.values()].map((v) => v.row).filter((r) => r.pool.dex === dex && !covered.has(r.pool.id));
/** Indexer pair → on-chain pool id: legacy ids are bare numbers, AseDex
 *  pairs arrive as "asedex-<id>" (chainPoolId carries the bare id when set). */
const pairIdOf = (p: AuraPair) => String(p.chainPoolId ?? String(p.poolId ?? "")).replace(/^asedex-/i, "");
/** Venue-agnostic row built straight from one /api/pairs record — the indexer
 *  already carries ids, token legs, fee, price and quote-denominated TVL.
 *  Reserves/totalShares aren't in the response, so viable rows get reserves
 *  synthesized from TVL+price (reserve-math display spots stay sane) and the
 *  real pool object hydrates lazily via getPool when something needs it —
 *  terminal select, LP modal, a user position, or a live event patch. */
function pairToLegacyRow(dex: string, p: AuraPair, prevByKey: Map<string, PoolRow>): PoolRow {
  const id = pairIdOf(p);
  const token0 = String(p.token0 || "").toLowerCase();
  const token1 = String(p.token1 || "").toLowerCase();
  const prev = prevByKey.get(poolKey(dex, id));
  const hyd = hydratedRows.get(poolKey(dex, id));
  // Hydrated truth wins outright; a previously hydrated real pool also beats
  // a fresh synthesis — only fully-unseen ids get reserves synthesized.
  let pool: Pool;
  if (hyd) {
    pool = hyd.pool;
  } else if (prev && prev.pool.tvlQuote == null) {
    pool = prev.pool;
  } else {
    const tvl = Number(p.tvlQuote) || 0;
    const price = Number(p.price) || 0;
    const n0 = token0 === NATIVE, n1 = token1 === NATIVE;
    let reserve0 = "0", reserve1 = "0";
    if (p.reserve0 != null && p.reserve1 != null && safeBig(p.reserve0) > 0n && safeBig(p.reserve1) > 0n) {
      // DB rows carry real indexed reserves — no synthesis needed. Zero
      // reserves mean "not hydrated yet" (a truly dead pool has tvlQuote=0
      // too and stays dead via the synth branch), so they fall through.
      reserve0 = String(p.reserve0); reserve1 = String(p.reserve1);
    } else if (tvl > 0) {
      const quoteWei = safeBig(Math.max(1, Math.round((tvl / 2) * 1e18)));
      const baseWei = price > 0 ? safeBig(Math.max(1, Math.round((tvl / 2) / price * 1e18))) : quoteWei;
      // The ASE leg is quote by convention; token↔token treats token1 as it.
      if (n0 && !n1) { reserve0 = String(quoteWei); reserve1 = String(baseWei); }
      else { reserve0 = String(baseWei); reserve1 = String(quoteWei); }
    }
    pool = {
      id, dex, token0, token1, reserve0, reserve1,
      totalShares: String(p.shares ?? "0"), feeBps: String(p.feeBps ?? 100),
      price0Cumulative: "0", price1Cumulative: "0",
      lastTs: p.lastTs ?? String(Date.parse(String(p.lastTradeAt || "")) || 0),
      tvlQuote: tvl
    };
  }
  // Indexer symbols give decent placeholders until the meta batch lands —
  // base maps to token0, quote to token1 (matches the on-chain leg order).
  // The DB seed/session cache is consulted FIRST though: pool rows carry
  // joined t0_*/t1_* metadata that seedDbAsset already wrote, so the instant
  // paint shows real logo/card/supply instead of initials while the meta
  // waves re-verify. A bare placeholder never merges over a real prev asset
  // — mergeAsset takes decimals from `next`, so "Unknown"/18 defaults would
  // regress a row that had already resolved.
  const ph = (addr: string, sym?: string): Asset =>
    addr === NATIVE ? ASE_ASSET
      : { address: addr, name: sym || "Unknown token", symbol: sym || "?", decimals: 18 };
  const leg = (addr: string, sym: string | undefined, prevA: Asset | undefined, hydA: Asset | undefined): Asset => {
    if (hydA) return hydA;
    const ss = addr === NATIVE ? ASE_ASSET : assetSSRead()[addr];
    if (ss) return mergeAsset(prevA, ss) ?? ss;
    return prevA ?? ph(addr, sym);
  };
  return {
    pool,
    asset0: leg(token0, p.base, prev?.asset0, hyd?.asset0),
    asset1: leg(token1, p.quote, prev?.asset1, hyd?.asset1),
    seenAt: prev?.seenAt ?? Date.now()
  };
}
// Page a venue's whole pool set — the universe grows, never cap by a number.
async function apiPoolsAll(dex?: string) {
  const pools: import("@/lib/ase-api").ApiPool[] = [];
  // Server clamps limit at 2000 — walk offset pages until `total` is covered.
  // viable=1 drops dead/un-hydrated index rows server-side (12.5k → ~3.2k).
  for (let offset = 0; ; offset += 2000) {
    const d = await apiPools(`?${dex ? `dex=${dex}&` : ""}state=all&viable=1&limit=2000&offset=${offset}`).catch(() => null);
    const page = d?.pools ?? [];
    pools.push(...page);
    if (page.length < 2000 || pools.length >= (d?.total ?? 0)) break;
  }
  return pools;
}
// Non-circulating supply (burned + AseLock escrow) — /api/holders rows for
// the burn/escrow addresses, zero RPC. Holders indexing is a Transfer crawl,
// so a just-burned amount lags an indexer tick like everything else.
const NONCIRC_ADDRS = new Set([ZERO, DEAD, LOCK, LOCK_V2].map((a) => a.toLowerCase()));
async function apiTokenNoncirc(token: string): Promise<bigint> {
  if (!UNIFIED_API) return 0n;
  const res = await fetch(`${UNIFIED_API}/api/holders/${token}?size=200`, { signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!res?.ok) return 0n;
  const j = await res.json().catch(() => null) as { rows?: { holder?: string; balance?: string }[] } | null;
  let sum = 0n;
  for (const r of j?.rows ?? []) {
    let h = String(r.holder || "");
    if (/^ase1/i.test(h)) { try { h = toHexAddress(h); } catch { continue; } }
    if (NONCIRC_ADDRS.has(h.toLowerCase())) sum += safeBig(r.balance);
  }
  return sum;
}
async function loadPools(client: ViewClient, prevByKey: Map<string, PoolRow>, emit: (rows: PoolRow[]) => void, signal?: AbortSignal): Promise<PoolRow[]> {
  const rows: PoolRow[] = [];
  // One API call + one feed call for the whole universe — the per-venue loop
  // buckets them in memory instead of re-fetching the same payload per dex.
  const [pairsRes, allDbPools] = await Promise.all([
    fetchAuraPairs().catch(() => null),
    apiPoolsAll().catch(() => null)
  ]);
  const allPairs = pairsRes?.pairs ?? null;
  for (const dex of [...VENUES, ...LEGACY_DEXES]) {
    if (signal?.aborted) break;
    const pairs = allPairs;
    const dexL = dex.toLowerCase();
    const dbPools = allDbPools?.filter((p) => String(p.dex || "").toLowerCase() === dexL) ?? null;
    if (!pairs && !dbPools?.length) continue;
    const covered = new Set<string>();
    // Indexer enumerates the whole venue in ONE HTTP call — pools it already
    // indexes become synthetic rows instantly (reserves/shares hydrate lazily
    // on demand); only ids the indexer hasn't reached yet (fresh pools, lag)
    // go through the on-chain getPool stream.
    if (pairs || dbPools?.length) {
      const apiById = new Map<string, AuraPair>();
      // Our DB pools seed first — they carry real reserves, real shares and
      // live fee/state, so a db-only row already paints accurately. The
      // external indexer then overlays its richer 24h stats (price/volume/
      // tvlQuote) per id without clobbering the db's real fields.
      for (const p of dbPools ?? []) {
        // Paint each leg's indexed metadata instantly — real ticker/logo on
        // first emit, zero per-token reads before the row exists.
        seedDbAsset(p.token0, { name: p.t0_name, symbol: p.t0_symbol, decimals: p.t0_decimals, logoUrl: p.t0_logo, totalSupply: p.t0_supply, card: p.t0_card, pad: p.t0_pad });
        seedDbAsset(p.token1, { name: p.t1_name, symbol: p.t1_symbol, decimals: p.t1_decimals, logoUrl: p.t1_logo, totalSupply: p.t1_supply, card: p.t1_card, pad: p.t1_pad });
        const pid = String(p.pool_id || "");
        if (!pid) continue;
        apiById.set(pid, {
          poolId: pid, amm: dex, price: 0, change24: 0,
          // pool_vol rollup is wei-float — the indexer-facing `volume24`
          // field carries ASE units, so scale down once here.
          volume24: Number(p.vol24_ase ?? p.volume_24h) / 1e18 || 0, trades24: 0, tvlQuote: undefined,
          token0: p.token0, token1: p.token1,
          feeBps: p.fee_bps ?? undefined,
          // Zero reserves = the DB hasn't hydrated this pool yet — not real
          // zeros. Leave them undefined so the indexer's tvlQuote drives
          // reserve synthesis instead of marking every pool depleted.
          reserve0: safeBig(p.reserve0) > 0n ? String(p.reserve0) : undefined,
          reserve1: safeBig(p.reserve1) > 0n ? String(p.reserve1) : undefined,
          shares: safeBig(p.lp_supply) > 0n ? String(p.lp_supply) : undefined,
          lastTs: p.updated_at ? String(p.updated_at) : undefined
        });
      }
      for (const p of pairs ?? []) {
        if (String(p.amm || "").toLowerCase() !== dex) continue;
        const pid = pairIdOf(p);
        if (!pid) continue;
        const prev = apiById.get(pid);
        if (!prev) { apiById.set(pid, p); continue; }
        const merged = { ...prev } as Record<string, unknown>;
        for (const [k, v] of Object.entries(p)) if (v !== undefined) merged[k] = v;
        apiById.set(pid, merged as AuraPair);
      }
      // AWS + pairs feed are the universe — no id enumeration against chain.
      const apiIds = [...apiById.keys()].sort((a, b) => { const d = safeBig(b) - safeBig(a); return d > 0n ? 1 : d < 0n ? -1 : 0; });
      let apiRows = apiIds.map((id) => pairToLegacyRow(dex, apiById.get(id)!, prevByKey));
      // Feeds can carry the same pool twice under different raw ids
      // (`240` vs `asedex-240`) — both normalize to one display id, so drop
      // the duplicates by rendered pool key (first/newest wins).
      const seenRows = new Set<string>();
      apiRows = apiRows.filter((r) => { const k = poolKey(r.pool.dex, r.pool.id); if (seenRows.has(k)) return false; seenRows.add(k); return true; });
      for (const r of apiRows) covered.add(r.pool.id);
      const emitPart = () => {
        if (!signal?.aborted) emit(fixHydrated(rows.concat(apiRows, liveExtras(dex, covered))));
      };
      emitPart(); // rows paint instantly — symbols from the indexer
      // Meta for viable pools' tokens (decimals/logo/name/supply — the
      // indexer only carries the symbol string). Chunked waves of ~40 tokens
      // highest-TVL first: each batch repaints, so the visible top rows get
      // MC/logos in ~2s instead of one long silent sweep.
      const toks = [...new Set([...apiRows]
        .filter((r) => poolViable(r.pool))
        .sort((a, b) => (Number(b.pool.tvlQuote) || 0) - (Number(a.pool.tvlQuote) || 0))
        .flatMap((r) => [r.pool.token0, r.pool.token1]))];
      for (let i = 0; i < toks.length; i += 40) {
        const part = toks.slice(i, i + 40);
        const metas = await tokenAssetsBatch(client, part, true).catch(() => new Map<string, Asset>());
        if (signal?.aborted) return rows;
        await sweepTaxes(client, part, metas);
        // Yield between waves — back-to-back meta batches are what kept
        // tripping the upstream limiter, and a paused gate means the next
        // wave would just queue into the cooldown anyway.
        if (i + 40 < toks.length) {
          await new Promise((r) => setTimeout(r, 350));
          while (rpcPaused() && !signal?.aborted) await new Promise((r) => setTimeout(r, 500));
        }
        apiRows = apiRows.map((r) => ({
          ...r,
          asset0: mergeAsset(r.asset0, metas.get(r.pool.token0)) ?? r.asset0,
          asset1: mergeAsset(r.asset1, metas.get(r.pool.token1)) ?? r.asset1
        }));
        emitPart();
      }
      rows.push(...apiRows, ...liveExtras(dex, covered));
      continue;
    }
    // API + pairs both dark — venue contributes nothing this tick (no chain
    // sweep, no stale padding).
    continue;
  }
  return rows;
}

// Rendered by asedex/layout.tsx (NOT the [[...slug]] page): a dynamic page is
// keyed by its params, so every view/pair URL change remounted the whole app.
// The parent layout survives URL changes, so state and caches stay put.
export default function AseDexApp() {
  // All reads go through the pooled RPC client in asentum-wallet — every page
  // round-robins across the configured nodes.
  const client = useMemo<ViewClient>(() => ({ view: (to, method, args, opts) => viewContract(to, method, args ?? [], opts) }), []);
  // Kick the factory registry delta at mount (bulk lane) so the first
  // metadata need finds it warm instead of triggering an ~85-chunk sync
  // mid-stream that every asset read then awaits.
  useEffect(() => { void factoryTokensRefresh((a, m, args, o) => client.view(a, m, args, o)).catch(() => factoryTokensKnown()); }, [client]);
  const wallet = useWalletStore();
  const walletAse = useAseBalance(wallet.address ?? undefined, 15000);
  // Sticky balance — a lagging read node can transiently report null or 0 on a
  // poll tick, which makes the balance visibly blip. Hold the last good value:
  // null reads are ignored outright, and a drop to 0 must repeat once before
  // it's trusted (a real drain to zero is rare — gas makes it near-impossible).
  const aseBalRef = useRef<string | null>(null);
  const aseZeroStrikes = useRef(0);
  const aseBalance = useMemo(() => {
    const v = walletAse.balance;
    if (v == null) return aseBalRef.current;
    let bi: bigint;
    try { bi = safeBig(String(v)); } catch { return aseBalRef.current; }
    if (bi === 0n && aseBalRef.current !== null && safeBig(aseBalRef.current) > 0n && aseZeroStrikes.current < 1) {
      aseZeroStrikes.current += 1;
      return aseBalRef.current;
    }
    aseZeroStrikes.current = 0;
    aseBalRef.current = String(v);
    return String(v);
  }, [walletAse.balance]);
  // A different wallet must not inherit the previous one's last-good balance.
  useEffect(() => { aseBalRef.current = null; aseZeroStrikes.current = 0; }, [wallet.address]);
  const queryClient = useQueryClient();
  // Note: navigation uses the History API (gotoView / replaceState) — no useRouter,
  // because router.push triggers an RSC round-trip that visibly re-renders the page.
  // The address bar is the source of truth. On static hosting every pair link
  // is served from the prebuilt /asedex/terminal shell, and usePathname
  // reports that shell path; it also lags our own pushState by a render.
  // usePathname stays subscribed so Next's URL syncs still re-render us.
  const routerPath = usePathname();
  const pathname = typeof window === "undefined" ? routerPath : window.location.pathname;
  const segs = useMemo(() => pathname.split("/").filter(Boolean).slice(0).map((s) => decodeURIComponent(s)), [pathname]);
  const [view, setView] = useState<ViewName>(() => {
    const sec = (segs[0] || "radar").toLowerCase();
    const v = sec === "wallets" ? "wallet" : sec;
    return (VIEWS.includes(v) ? v : "radar") as ViewName;
  });
  const detail = view === "terminal";
  const setDetail = (v: boolean) => gotoView(v ? "terminal" : "radar");
  const [buySize, setBuySize] = useState("1");
  const [quickBuyKey, setQuickBuyKey] = useState<string | null>(null);
  const [quickBuyDone, setQuickBuyDone] = useState<{ key: string; symbol: string } | null>(null);
  const [hotIdx, setHotIdx] = useState(0);
  const [createFee, setCreateFee] = useState("30"); // bps — pool fee tier
  const [createDex, setCreateDex] = useState(PRIMARY_DEX); // venue for new pools
  const [tab, setTab] = useState<"swap" | "limit" | "dca">("swap");
  const [poolTab, setPoolTab] = useState<"all" | "mine">("all");
  const [walletTab, setWalletTab] = useState<"holdings" | "created" | "orders" | "activity">("holdings");
  const [activityTab, setActivityTab] = useState<"all" | "buy" | "sell">("all");
  const [orderTab, setOrderTab] = useState<"all" | "open" | "filled">("all");
  const [orderSide, setOrderSide] = useState<"all" | "buy" | "sell">("all");
  // Liquidity modal — pools rows open this for add/remove on any pool.
  const [lpRow, setLpRow] = useState<PoolRow | null>(null);
  const [lpMode, setLpMode] = useState<"add" | "remove">("add");
  const [radarSearch, setRadarSearch] = useState("");
  const [radarVenue, setRadarVenue] = useState<"all" | "current" | "legacy">("all");
  const [marketSort, setMarketSort] = useState<"fav" | "all" | "vol" | "gainers" | "losers">("all");
  const [poolsSearch, setPoolsSearch] = useState("");
  // Pair-picker modal — favourites persist in localStorage so stars survive reloads.
  const [pairPickOpen, setPairPickOpen] = useState(false);
  const [pairPickQ, setPairPickQ] = useState("");
  const [pairPickTab, setPairPickTab] = useState<"fav" | "all" | "vol" | "gainers" | "losers">("all");
  const [favs, setFavs] = useState<Set<string>>(() => {
    try { return new Set(lsRead<string[]>("asedex:favs") ?? []); } catch { return new Set<string>(); }
  });
  // Persist on every change — survives refresh; writing in the setter updater
  // would double-fire under StrictMode.
  useEffect(() => { lsWrite("asedex:favs", [...favs]); }, [favs]);
  const toggleFav = useCallback((key: string) => {
    setFavs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);
  // The user's chosen pair survives refresh — restored until they pick another.
  const [selKey, setSelKey] = useState(() => {
    try { return sessionStorage.getItem("asedex:last-pair") || ""; } catch { return ""; }
  });
  // URL↔state sync bookkeeping (declared early — selection reads them).
  const viewAppliedFor = useRef("");
  const poolAppliedFor = useRef("");
  const legacyApplied = useRef(false);
  // Our own pushState/replaceState in flight: Next's usePathname still reports
  // `from` for a render or two after the address bar already shows `to`.
  // Renders seeing the stale `from` must not treat it as a deep link.
  // `at` bounds that window — once it lapses, paths in `from` are real user
  // navs again (a router Link back to a page visited earlier this session).
  const selfNav = useRef<{ from: Set<string>; to: string; at: number } | null>(null);
  // Back/Forward is a real user navigation — always honour it.
  useEffect(() => {
    const onPop = () => { selfNav.current = null; };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const selfNavFresh = () => Boolean(selfNav.current && Date.now() - selfNav.current.at < 1500);
  const [amount, setAmount] = useState("");
  const [tokenAddress, setTokenAddress] = useState("");
  const [tokenBAddress, setTokenBAddress] = useState("");
  // Create-pool deposit amounts — optional seed liquidity in the same flow.
  const [depAmtA, setDepAmtA] = useState("");
  const [depAmtB, setDepAmtB] = useState("");
  const [tokenIn, setTokenIn] = useState("");
  const [slippage, setSlippage] = useState("1");
  const [limitPrice, setLimitPrice] = useState("");
  const [limitUnit, setLimitUnit] = useState<"ASE" | "USD">("ASE");
  const [centerTab, setCenterTab] = useState<"trades" | "depth" | "orders" | "holders">("trades");
  // Mobile chart↔trade swap — Binance-style: Buy/Sell flips the center pane
  // from the chart into a book+form trade screen. Desktop always shows both.
  const [mobileView, setMobileView] = useState<"chart" | "trade">("chart");
  // Mobile app tab — Price (chart) vs Info (market/basic token facts).
  const [mobTab, setMobTab] = useState<"chart" | "info">("chart");
  const [ordersFilter, setOrdersFilter] = useState<"open" | "closed">("open");
  const [descOpen, setDescOpen] = useState(false);
  const [tradesMine, setTradesMine] = useState(false);
  const [marketSearch, setMarketSearch] = useState("");
  const [dcaSlices, setDcaSlices] = useState("4");
  const [dcaMinutes, setDcaMinutes] = useState("60");
  // LP inputs follow pool token order (token0/token1) so token-token pools work.
  const [liqAmt0, setLiqAmt0] = useState("");
  const [liqAmt1, setLiqAmt1] = useState("");
  const [liquidityPercent, setLiquidityPercent] = useState("100");
  const [busy, setBusy] = useState<string | null>(null);
  // Scoped notifications — every action flashes its result above the button
  // that triggered it instead of a banner pinned to the page top.
  const [note, setNote] = useState<{ scope: string; kind: "error" | "ok"; text: string } | null>(null);
  const noteScope = useRef("global");
  const setError = (m: string | null) => setNote(m ? { scope: noteScope.current, kind: "error", text: m } : null);
  const setNotice = (m: string | null) => setNote(m ? { scope: noteScope.current, kind: "ok", text: m } : null);
  const begin = (scope: string) => { noteScope.current = scope; setNote(null); };
  const Note = ({ scope }: { scope: string }) => {
    if (!note || note.scope !== scope) return null;
    const cls = note.kind === "error" ? "border-red-500/30 bg-red-500/10 text-red-200" : "border-emerald-500/20 bg-emerald-500/10 text-emerald-200";
    // Every note renders inline at the slot closest to the button that
    // started the action — no floating/centered overlays.
    return <div className={cn("rounded-lg border px-3 py-2 text-xs", cls)}>{note.text}</div>;
  };
  // 1s heartbeat — powers the CEX-style price flash (green/red for ~3s after
  // a trade, then back to neutral).
  // Success toasts auto-dismiss; errors stay until acted on or dismissed.
  useEffect(() => {
    if (note?.kind !== "ok") return;
    const t = setTimeout(() => setNote(null), 6000);
    return () => clearTimeout(t);
  }, [note]);

  // Busy watchdog — a wallet prompt that never settles (popup lost, extension
  // hung) used to pin `busy` forever and dead every action button until a
  // reload. The underlying promise still completes on its own; this just
  // frees the UI so the user can retry.
  useEffect(() => {
    if (!busy) return;
    const t = setTimeout(() => {
      setBusy(null);
      setNote({ scope: "global", kind: "error", text: "That wallet action took too long and may still complete — check the explorer before retrying." });
    }, 150_000);
    return () => clearTimeout(t);
  }, [busy]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const pools = useQuery({
    queryKey: ["asedex-pools"],
    enabled: VENUES.length > 0,
    staleTime: 30_000,
    // Safety sweep only — live events patch touched pools in place (listener).
    refetchInterval: 3_000,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => {
      const prev = queryClient.getQueryData<PoolRow[]>(["asedex-pools"]) ?? [];
      const prevByKey = new Map(prev.map((r) => [poolKey(r.pool.dex, r.pool.id), r]));
      // Progressive commits — rows stream into the cache as each pool resolves.
      return loadPools(client, prevByKey, (part) => queryClient.setQueryData(["asedex-pools"], part), signal);
    }
  });
  // ASE/USD rate — on-chain owner-set value, env fallback (same source as AsePad).
  const aseUsdCfg = useQuery({ queryKey: ["asepad-config"], queryFn: asepadGetConfig, staleTime: 60000 });
  // Belt-and-braces on the same band lib/asepad applies — a persisted query
  // entry written before the band existed can still carry a garbage rate.
  const aseUsdRaw = aseUsdCfg.data?.aseUsd ?? 0;
  const aseUsd = aseUsdRaw > 0.05 && aseUsdRaw < 500 ? aseUsdRaw : 0;
  // Display rate — mirrors the lib's fallback so prices never blank to ASE
  // just because the config view was unreachable on load.
  const aseUsdRate = aseUsd > 0 ? aseUsd : 3.418;
  const [priceUnit, setPriceUnit] = useState<"USD" | "ASE">("USD");
  // Prices here are always quote-denominated (ASE for ASE pairs, the quote
  // token for token↔token). USD conversion goes through the quote's USD
  // price (quoteAsePx × aseUsd) — ASE pairs get it directly, token↔token
  // pairs through the quote's ASE pool. Blind aseUsd multiplication is what
  // produced garbage like "$29,349" before.
  const fmtPx = (quotePrice: number) => priceUnit === "USD" && aseUsd > 0 && pairQuoteAsePx > 0
    ? fmtUsd(quotePrice * pairQuoteAsePx * aseUsd)
    : `${fmtTiny(quotePrice, 5)} ${trimSym(pairQuote?.symbol ?? "ASE")}`;
  // Depth-ladder prices: the book column is ~110px on mobile — long USD
  // strings like "$25,318.5185" overflow it, so big prices go compact
  // (K/M/B/T) while tiny ones keep full precision.
  const fmtBookPx = (quotePrice: number) => {
    if (priceUnit === "USD" && aseUsd > 0 && pairQuoteAsePx > 0) {
      const usd = quotePrice * pairQuoteAsePx * aseUsd;
      return usd >= 1000 ? `$${fmtCompact(usd)}` : fmtUsd(usd);
    }
    return `${fmtTiny(quotePrice, 5)} ${trimSym(pairQuote?.symbol ?? "ASE")}`;
  };
  const aseWeiUsd = (wei: string | bigint) => {
    const usd = (Number(safeBig(wei)) / 1e18) * aseUsd;
    return !Number.isFinite(usd) || usd <= 0 ? "-" : `$${fmtCompact(usd)}`;
  };
  // On-chain createdTs is milliseconds; everything below wants seconds.
  const toSec = (v: number) => (v > 1e12 ? v / 1000 : v);
  const feeInfo = useQuery({
    queryKey: ["asedex-fee"],
    enabled: Boolean(PRIMARY_DEX),
    // Admin-settable on-chain — never trust a stale read; refresh on mount
    // and poll while open.
    refetchOnMount: "always",
    refetchInterval: 30_000,
    queryFn: async () => {
      // AWS-only: pool fee_bps is indexed, and the venue-level feeBps is the
      // fee every new pool is created with — the modal value across indexed
      // pools is the venue setting. treasuryShareBps has no indexed field, so
      // the contract default stands (a changed split only skews the label, not
      // swap math — quotes use each pool's own feeBps).
      const pools = await apiPoolsAll(PRIMARY_DEX).catch(() => []);
      const counts = new Map<number, number>();
      for (const p of pools) {
        const f = Number(p.fee_bps ?? 30) || 30;
        counts.set(f, (counts.get(f) ?? 0) + 1);
      }
      const feeBps = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 30;
      return { feeBps: safeBig(String(feeBps)), shareBps: 6667n };
    }
  });
  // Order engine support per venue — v1 pools hide the Limit/DCA tabs.
  const feeBps = feeInfo.data?.feeBps ?? 30n;
  const treasuryBps = feeBps * (feeInfo.data?.shareBps ?? 6667n) / 10000n;
  const lpBps = feeBps - treasuryBps;
  const feePct = (bps: bigint) => (Number(bps) / 100).toFixed(2);
  const rows = pools.data ?? EMPTY_POOL_ROWS;
  // Legacy AuraDex pools — loaded strictly AFTER the AseDex set so the read
  // nodes see one venue at a time (parallel venue bursts were the 429 driver).
  // The old contract has no poolCount, so getPool ids come from the indexer.
  const legacyPools = useQuery({
    queryKey: ["asedex-legacy-pools", LEGACY_DEXES.join(",")],
    enabled: LEGACY_DEXES.length > 0 && pools.isSuccess,
    staleTime: 60_000,
    refetchInterval: 3_000,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const key = ["asedex-legacy-pools", LEGACY_DEXES.join(",")];
      const prev = queryClient.getQueryData<PoolRow[]>(key) ?? [];
      const prevByKey = new Map(prev.map((r) => [poolKey(r.pool.dex, r.pool.id), r]));
      const out: PoolRow[] = [];
      for (const dex of LEGACY_DEXES) {
        // The indexer enumerates the whole venue in ONE HTTP call — no 191-call
        // getPool sweep. Reserves/shares hydrate lazily per pool on demand.
        const pairs = (await fetchAuraPairs())?.pairs ?? [];
        const mine = pairs.filter((p) => String(p.amm || "").toLowerCase() === dex);
        const covered = new Set(mine.map((p) => String(p.chainPoolId ?? String(p.poolId).replace(/^asedex-/, ""))));
        const emitPart = (part: PoolRow[]) => {
          if (!signal?.aborted) queryClient.setQueryData(key, fixHydrated(out.concat(part, liveExtras(dex, covered))));
        };
        if (!mine.length) { out.push(...liveExtras(dex, covered)); continue; } // pairs feed silent — nothing to paint this tick
        const built = mine.map((p) => pairToLegacyRow(dex, p, prevByKey));
        emitPart(built); // rows paint instantly — symbols from the indexer
        // Meta for viable pools' tokens (decimals/logo/name/supply — the
        // indexer only carries the symbol string). Chunked waves, highest-TVL
        // first, so top rows fill in ~2s instead of one long silent sweep.
        const toks = [...new Set([...built]
          .filter((r) => poolViable(r.pool))
          .sort((a, b) => (Number(b.pool.tvlQuote) || 0) - (Number(a.pool.tvlQuote) || 0))
          .flatMap((r) => [r.pool.token0, r.pool.token1]))];
        let builtAcc = built;
        for (let i = 0; i < toks.length; i += 40) {
          const part = toks.slice(i, i + 40);
          const metas = await tokenAssetsBatch(client, part, true).catch(() => new Map<string, Asset>());
          if (signal?.aborted) return out;
          await sweepTaxes(client, part, metas);
          builtAcc = builtAcc.map((r) => ({
            ...r,
            asset0: mergeAsset(r.asset0, metas.get(r.pool.token0)) ?? r.asset0,
            asset1: mergeAsset(r.asset1, metas.get(r.pool.token1)) ?? r.asset1
          }));
          emitPart(builtAcc);
        }
        out.push(...builtAcc, ...liveExtras(dex, covered));
      }
      return out;
    }
  });
  const legacyRows = legacyPools.data ?? EMPTY_POOL_ROWS;
  // AuraDex pools sit in the same lists as AseDex pools — a venue tag marks them.
  // Dedupe by pool key — a live-patched row that also landed in the pairs feed
  // must never render twice (React same-key warnings + phantom duplicate rows).
  const allRows = useMemo(() => {
    const seen = new Set<string>();
    return rows.concat(legacyRows).filter((r) => {
      const k = poolKey(r.pool.dex, r.pool.id);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [rows, legacyRows]);
  // Auras indexer — per-pair market data for AuraDex pools (the legacy contract
  // doesn't store swap logs, so its candles/trades/stats come from auras.finance).
  const auraPairs = useQuery({
    queryKey: ["auras-api-pairs", LEGACY_DEXES.join(",")],
    enabled: LEGACY_DEXES.length > 0,
    refetchInterval: 30_000,
    staleTime: 20_000,
    queryFn: async () => {
      const d = await fetchAuraPairs();
      const map: Record<string, AuraPair> = {};
      // Both venues now — key by chain pool id ("asedex-N" → "N").
      for (const p of d?.pairs ?? []) {
        const id = String(p.chainPoolId ?? String(p.poolId).replace(/^asedex-/, ""));
        if (id) map[poolKey(String(p.amm).toLowerCase(), id)] = p;
      }
      return map;
    }
  });
  // Our DB's rolling-24h ASE volume per pool — uniform units across venues,
  // no quote-leg conversion guesswork. Drives the Trending sort/vol column;
  // pools the indexer hasn't reached keep their indexer/chain stat below.
  const dbTrend = useQuery({
    queryKey: ["db-trending"],
    queryFn: () => apiTrending(),
    staleTime: 45_000,
    refetchInterval: 3_000
  });
  const dbVolByKey = useMemo(() => {
    const m = new Map<string, { v: number; n: number }>();
    for (const r of dbTrend.data?.pools ?? []) {
      if (r.dex && r.pool_id) m.set(poolKey(String(r.dex).toLowerCase(), String(r.pool_id)), { v: Number(r.v) || 0, n: Number(r.n) || 0 });
    }
    return m;
  }, [dbTrend.data]);
  // UTC-day volume per pool — the HOT tag ranking base. Resets 00:00 UTC so
  // "today's hottest" is a same-day race, not a rolling window. Pools the DB
  // hasn't indexed yet fall back to their rolling-24h stat below.
  const dbDayVolByKey = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of dbTrend.data?.pools_day ?? []) {
      if (r.dex && r.pool_id) m.set(poolKey(String(r.dex).toLowerCase(), String(r.pool_id)), Number(r.v) || 0);
    }
    return m;
  }, [dbTrend.data]);
  // When the URL names a pool that hasn't resolved yet, hold the fallback —
  // otherwise the terminal flashes pool #1's data before selKey catches up.
  const wantsPoolFromUrl = (segs[0] ?? "").toLowerCase() === "terminal" && Boolean(segs[1])
    && poolAppliedFor.current !== pathname && !(selfNavFresh() && selfNav.current?.from.has(pathname));
  // The pool a pair URL points at, parsed up-front. A transient getPool
  // failure inside the pool-list stream drops that pool's row — without a
  // dedicated read the consume flag burns and a deep link snaps to a
  // fallback pair, rewriting the URL on top of it.
  const urlPoolTarget = useMemo(() => {
    if (!wantsPoolFromUrl || !segs[1]) return null;
    // Token short link: /terminal/<ase1|0x token> → best ASE pair for the token.
    const tokenHex = (() => { try { return normAddr(segs[1]!); } catch { return ""; } })();
    if (/^0x[0-9a-f]{40}$/.test(tokenHex)) {
      return tokenHex === NATIVE ? null : { token: tokenHex };
    }
    let poolId = segs[1], dex: string | undefined, tokA = segs[2], tokB = segs[3];
    if (poolId.includes(":")) {
      const [d, i] = poolId.split(":");
      if (!i) return null;
      dex = (slugDex(d) ?? d).toLowerCase(); poolId = i;
    } else if (!/^\d+$/.test(poolId)) {
      dex = slugDex(poolId);
      if (!dex) return null;
      poolId = segs[2] ?? ""; tokA = segs[3]; tokB = segs[4];
    }
    if (!/^\d+$/.test(poolId)) return null;
    return { dex, poolId, tokA, tokB };
  }, [wantsPoolFromUrl, segs]);
  const urlPoolQ = useQuery({
    queryKey: ["asedex-url-pool", urlPoolTarget && "token" in urlPoolTarget ? `tok:${urlPoolTarget.token}` : `${urlPoolTarget?.dex ?? "*"}:${urlPoolTarget && "poolId" in urlPoolTarget ? urlPoolTarget.poolId : ""}`],
    enabled: Boolean(urlPoolTarget) && !poolFromSegs(segs, allRows),
    staleTime: 30_000,
    retry: 4,
    queryFn: async (): Promise<PoolRow | null> => {
      const t = urlPoolTarget!;
      const build = async (dex: string, poolId: string): Promise<PoolRow | null> => {
        try {
          // AWS pools table — same row the list paints, zero chain reads.
          const res = await apiPools(`?dex=${dex}&state=all&limit=2000`).catch(() => null);
          const p = res?.pools?.find((x) => String(x.pool_id) === poolId);
          if (!p) return null;
          const pool = sanPool({
            id: poolId, dex, token0: String(p.token0 || ""), token1: String(p.token1 || ""),
            reserve0: String(p.reserve0 || "0"), reserve1: String(p.reserve1 || "0"),
            totalShares: String(p.lp_supply || "0"), feeBps: String(p.fee_bps ?? "30"),
            lastTs: String(p.updated_at ?? "0"),
          } as Pool);
          const [asset0, asset1] = await Promise.all([tokenAsset(client, pool.token0), tokenAsset(client, pool.token1)]);
          hydratedRows.set(poolKey(dex, pool.id), { pool, asset0, asset1 });
          return { pool, asset0, asset1 };
        } catch { }
        return null;
      };
      // Token short link — resolve via the indexer's pair list: token+ASE
      // legs only, deepest TVL wins (venue preference on ties).
      if ("token" in t) {
        const res = await fetchAuraPairs().catch(() => null);
        if (!res?.pairs) throw new Error("pairs index unavailable"); // retry
        const cands = res.pairs.filter((p) => {
          const t0 = String(p.token0 || "").toLowerCase(), t1 = String(p.token1 || "").toLowerCase();
          return (t0 === t.token && t1 === NATIVE) || (t1 === t.token && t0 === NATIVE);
        }).sort((a, b) => {
          const d = Number(isLegacyDex(String(a.amm).toLowerCase())) - Number(isLegacyDex(String(b.amm).toLowerCase()));
          return d || Number(b.tvlQuote || 0) - Number(a.tvlQuote || 0);
        });
        for (const p of cands) {
          const row = await build(String(p.amm || "").toLowerCase(), pairIdOf(p));
          if (row) return row;
        }
        return null;
      }
      const dexes = t.dex ? [t.dex] : [...VENUES, ...LEGACY_DEXES];
      let conclusiveMiss = false;
      for (const dex of dexes) {
        const row = await build(dex, t.poolId);
        if (row) return row;
        conclusiveMiss = true;
      }
      if (!conclusiveMiss) throw new Error("URL pool read failed"); // retry
      return null;
    }
  });
  const directUrlHit = urlPoolQ.data && (urlPoolTarget && "token" in urlPoolTarget
    ? matchesPair(urlPoolQ.data, urlPoolTarget.token)
    : matchesPair(urlPoolQ.data, urlPoolTarget?.tokA, urlPoolTarget?.tokB)) ? urlPoolQ.data : undefined;
  // Market's top-3 pairs by 24h volume — the indexer pairs feed covers both
  // venues. Only pools with real reserves qualify.
  const trendingTop3 = useMemo(() => {
    const pairs = auraPairs.data;
    if (!pairs && !dbVolByKey.size) return [] as PoolRow[];
    // DB ASE-wei volume ranks first; the indexer pair stat (quote units → wei)
    // fills pools the backfill hasn't reached yet.
    const key = (r: PoolRow) => dbDayVolByKey.get(poolKey(r.pool.dex, r.pool.id))
      ?? dbVolByKey.get(poolKey(r.pool.dex, r.pool.id))?.v
      ?? (Number(pairs?.[poolKey(r.pool.dex, r.pool.id)]?.volume24) || 0) * 1e18;
    return allRows
      .filter((r) => poolViable(r.pool))
      .sort((a, b) => key(b) - key(a))
      .slice(0, 3);
  }, [allRows, auraPairs.data, dbVolByKey, dbDayVolByKey]);
  // Bare-terminal default: any of the top-3, latched per session so a live
  // re-sort can't flip the open pair under the user.
  const defaultKeyRef = useRef<string | null>(null);
  if (!defaultKeyRef.current && trendingTop3.length) {
    const pick = trendingTop3[Math.floor(Math.random() * trendingTop3.length)]!;
    defaultKeyRef.current = poolKey(pick.pool.dex, pick.pool.id);
  }
  const trendingDefault = defaultKeyRef.current
    ? allRows.find((r) => poolKey(r.pool.dex, r.pool.id) === defaultKeyRef.current) ?? undefined
    : undefined;
  // Fallback order for a bare /terminal visit: a top-volume pair → the first
  // live pool. Dead/zero-reserve pools never fall back in — a stored selKey
  // wins once its row resolves, and a pool named in the URL outranks the
  // stored one while it resolves.
  const firstLiquid = allRows.find((r) => poolViable(r.pool));
  // A pair named in the URL (deep link, Back/Forward) resolves right here in
  // render — waiting for the URL→state effect left one blank terminal frame.
  const urlHit = useMemo(() => (wantsPoolFromUrl ? poolFromSegs(segs, allRows) ?? directUrlHit : undefined), [wantsPoolFromUrl, segs, allRows, directUrlHit]);
  const storedHit = wantsPoolFromUrl ? urlHit : allRows.find((row) => poolKey(row.pool.dex, row.pool.id) === selKey);
  // The chosen pool the sweep lists haven't streamed yet (fresh create,
  // unswept tail, a transient sweep gap) — resolve it directly with getPool
  // instead of flashing a fallback pair until the lists catch up.
  const [selDexQ, selIdQ] = selKey.split(":");
  const selPoolQ = useQuery({
    queryKey: ["asedex-sel-pool", selKey],
    enabled: Boolean(view === "terminal" && !wantsPoolFromUrl && !storedHit && selDexQ && /^\d+$/.test(selIdQ || "")),
    staleTime: 15_000,
    retry: 4,
    retryDelay: 700,
    queryFn: async (): Promise<PoolRow | null> => {
      try {
        // AWS pools table — same data source as the list, zero chain reads.
        const res = await apiPools(`?dex=${selDexQ}&state=all&limit=2000`).catch(() => null);
        const p = res?.pools?.find((x) => String(x.pool_id) === selIdQ);
        if (!p) return null;
        const pool = sanPool({
          id: String(selIdQ), dex: selDexQ!, token0: String(p.token0 || ""), token1: String(p.token1 || ""),
          reserve0: String(p.reserve0 || "0"), reserve1: String(p.reserve1 || "0"),
          totalShares: String(p.lp_supply || "0"), feeBps: String(p.fee_bps ?? "30"),
          lastTs: String(p.updated_at ?? "0"),
        } as Pool);
        const [asset0, asset1] = await Promise.all([tokenAsset(client, pool.token0), tokenAsset(client, pool.token1)]);
        hydratedRows.set(poolKey(selDexQ!, pool.id), { pool, asset0, asset1 });
        return { pool, asset0, asset1 };
      } catch { return null; }
    }
  });
  const selHit = !wantsPoolFromUrl && selPoolQ.data
    && poolKey(selPoolQ.data.pool.dex, selPoolQ.data.pool.id) === selKey ? selPoolQ.data : undefined;
  // A background pool refresh can drop the chosen row for a moment — keep
  // showing it rather than falling back to another pool (which also got
  // written to the URL, flipping the terminal to a different pair).
  const lastSelRow = useRef<PoolRow | undefined>(undefined);
  const stickyRow = !wantsPoolFromUrl && selKey && lastSelRow.current
    && poolKey(lastSelRow.current.pool.dex, lastSelRow.current.pool.id) === selKey ? lastSelRow.current : undefined;
  // While the chosen pool is still resolving, hold the loading state — a
  // premature fallback flashes the wrong pair before the real one lands.
  const selResolving = Boolean(!wantsPoolFromUrl && selKey && !storedHit && !selHit && !stickyRow && selPoolQ.isFetching);
  const rawSelRow = storedHit ?? selHit ?? stickyRow ?? (wantsPoolFromUrl || selResolving ? undefined : (trendingDefault ?? firstLiquid ?? allRows[0]));
  // Hydrated truth always wins — even a sticky/cached row that still carries
  // synthesized reserves gets the real pool + assets overlaid.
  const selHyd = rawSelRow ? hydratedRows.get(poolKey(rawSelRow.pool.dex, rawSelRow.pool.id)) : undefined;
  const selectedRow = selHyd ? { ...rawSelRow!, pool: selHyd.pool, asset0: selHyd.asset0, asset1: selHyd.asset1 } : rawSelRow;
  if (storedHit ?? selHit) lastSelRow.current = storedHit ?? selHit;
  const selected = selectedRow?.pool;
  // Indexer-built rows carry synthesized reserves (tvlQuote marker) until the
  // lazy getPool hydration swaps in chain truth. Never render them as real —
  // reserve-derived cells show "…" for that beat instead of fake numbers.
  const synthPool = Boolean(selected?.tvlQuote != null);
  // Legacy AuraDex lacks the orders/DCA surface — swap-only pools.
  const selLegacy = isLegacyDex(selected?.dex);
  // AuraDex supports swaps + limit orders; DCA is AseDex-only.
  const ordersEnabled = Boolean(selected);
  const dcaEnabled = Boolean(selected) && !selLegacy;
  const effTab: "swap" | "limit" | "dca" = selLegacy && tab === "dca" ? "swap" : tab;
  const selectedAssets = selectedRow ? [selectedRow.asset0, selectedRow.asset1] : [];
  const selectedInput = selectedAssets.find((asset) => asset.address === tokenIn) ?? selectedAssets[0];
  const selectedOutput = selectedAssets.find((asset) => asset.address !== selectedInput?.address);
  // Both pool assets of the liquidity modal's pool — either or both can be ARC-20.
  const liq0 = lpRow?.asset0;
  const liq1 = lpRow?.asset1;
  // Buy/sell tax on the pair's ARC-20 side — standard + pad tokens have no tax
  // views, so those calls fail through to 0 and the badge shows 0/0%.
  const tokenTax = useQuery({
    queryKey: ["asedex-token-tax", selectedAssets.map((a) => a.address).join(",")],
    // The tax badge/quote math is Terminal-only — don't poll it elsewhere.
    enabled: view === "terminal" && selectedAssets.length > 0,
    // Never persist: a mid-retry "bad" entry would restore as ?/? on reload and
    // sit there a whole retry cycle. The sweep's taxCache re-warms reads in
    // milliseconds anyway, so disk persistence only ever carries stale bad state.
    meta: { persist: false },
    // Rates are genesis-locked — good reads never go stale. Bad reads retry on
    // a short interval until the underlying taxCache entry resolves cleanly.
    staleTime: Infinity,
    // Persisted shape is a plain Record of string bps — Map/bigint don't
    // survive JSON serialization (Map restores as {}, bigint throws).
    refetchInterval: (q) => Object.values(q.state.data ?? {}).some((t) => t.bad) ? 12_000 : false,
    queryFn: async () => {
      const m: Record<string, { buy: string; sell: string; bad?: boolean }> = {};
      await Promise.all(selectedAssets.filter((a) => a.address !== NATIVE).map(async (a) => {
        const t = await tokenTaxOf(client, a.address);
        m[a.address.toLowerCase()] = { buy: t.buy.toString(), sell: t.sell.toString(), bad: t.bad || undefined };
      }));
      return m;
    },
    placeholderData: keepPreviousData
  });
  // pending = the read hasn't confirmed yet (loading or still retrying after a
  // bad read) — the badge shows ?/? instead of pretending it's 0/0.
  const taxOf = (addr?: string): TaxInfo & { pending: boolean } => {
    const a = String(addr || "").toLowerCase();
    const t = a && a !== NATIVE ? tokenTax.data?.[a] : undefined;
    return t && !t.bad ? { buy: safeBig(t.buy || "0"), sell: safeBig(t.sell || "0"), pending: false } : { buy: 0n, sell: 0n, pending: Boolean(a && a !== NATIVE) };
  };
  // LP deposits deliver the amount entered; the grossed-up sell tax rides on
  // top, so depositing D costs D*10000/(10000-sellBps) from the wallet.
  const liqCostOf = (a: Asset | undefined, parsed: bigint | null) => {
    const sell = a ? taxOf(a.address).sell : 0n;
    return parsed !== null && sell > 0n ? parsed + (parsed * sell) / (10000n - sell) : parsed;
  };
  const amountWei = selectedInput ? parseUnits(amount, selectedInput.decimals) : null;
  const inTax = taxOf(selectedInput?.address);
  const outTax = taxOf(selectedOutput?.address);
  // Selling a tax token: the typed amount is the TOTAL spend — the pool input
  // is net of the sell tax (sell 100 → pool trades 96, 4 goes to the tax
  // wallet at 4%). The token contract grosses the tax up on top of the pool
  // amount, so pool reserves stay exact. Buys need no conversion — the token
  // skims buy tax out of what the dex pays out.
  const poolInWei = amountWei && inTax.sell > 0n ? (amountWei * (10000n - inTax.sell)) / 10000n : amountWei;
  // Instant display quote — the contract's quote() is pure reserve math
  // (out = afterFee·rout / (rin·10000 + afterFee)), so we mirror it locally
  // off the row's reserves: updates per keystroke, zero RPC, and live Sync
  // patches keep it fresh. The contract read only runs when the row is still
  // synthetic (no trustworthy reserves yet) — and again fresh at send time.
  const localQuote = (() => {
    const p = selectedRow?.pool;
    if (!p || p.tvlQuote != null || !poolInWei || poolInWei <= 0n || !selectedInput) return null;
    const inIs0 = selectedInput.address === p.token0;
    if (!inIs0 && selectedInput.address !== p.token1) return null;
    const rin = safeBig(inIs0 ? p.reserve0 : p.reserve1);
    const rout = safeBig(inIs0 ? p.reserve1 : p.reserve0);
    if (rin <= 0n || rout <= 0n) return 0n;
    const afterFee = poolInWei * (10000n - safeBig(p.feeBps || "30"));
    return afterFee * rout / (rin * 10000n + afterFee);
  })();
  // Fallback for unhydrated rows: debounce so each keystroke doesn't mint a
  // new gated read.
  const [quoteInWei, setQuoteInWei] = useState<bigint | null>(poolInWei);
  useEffect(() => {
    const t = setTimeout(() => setQuoteInWei(poolInWei), 280);
    return () => clearTimeout(t);
  }, [poolInWei]);
  const quote = useQuery({
    queryKey: ["asedex-quote", selected?.dex, selected?.id, selectedInput?.address, quoteInWei?.toString()],
    enabled: Boolean(view === "terminal" && localQuote === null && selected && selectedInput && quoteInWei && quoteInWei > 0n),
    queryFn: async () => safeBig(String(await client.view(selected!.dex, "quote", [selected!.id, selectedInput!.address, quoteInWei!.toString()]) || "0")),
    placeholderData: keepPreviousData
  });
  const quoteOut = localQuote ?? quote.data;
  const ownerHex = wallet.address ? toHexAddress(wallet.address) : "";
  const ownerAse = (() => { try { return ownerHex ? String(toAseAddress(ownerHex)) : ""; } catch { return ownerHex; } })();
  const myPools = useQuery({
    // Static key — pool lists stream in progressively; a length-keyed query
    // would respawn on every emitted row. The interval covers new pools.
    queryKey: ["asedex-shares", ownerHex],
    // Focus-gated: LP positions only show on Pools (mine) and Wallet —
    // the sweep doesn't poll while the user is on Radar/Terminal.
    enabled: Boolean(ownerHex && allRows.length && (view === "pools" || view === "wallet")),
    refetchInterval: 3_000,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    // Reloads paint the last-known positions instantly, then merge fresh reads.
    initialData: () => shareStoreOf(ownerHex)?.entries,
    initialDataUpdatedAt: () => shareStoreOf(ownerHex)?.fullAt,
    queryFn: async ({ signal }) => {
      const now = Date.now();
      const store = shareStoreOf(ownerHex);
      // No more full-registry sweep — AWS positions table is authoritative for
      // held pools; live probes only verify pools the DB already knows about.
      const full = false;
      const prevByKey = new Map((store?.entries ?? []).map((e) => [e.key, e]));
      const probedSet = new Set(store?.probed ?? []);
      const zeroRewards = '{"amount0":"0","amount1":"0"}';
      // DB seed — the ops shard maintains positions from pool events, so held
      // pools paint instantly (and probe first) while sharesOf verifies live.
      // A failed probe still falls back to this row via prevByKey below.
      const dbPos = await apiWalletPositions(ownerHex).catch(() => null);
      for (const p of dbPos?.positions ?? []) {
        const dexL = p.dex.toLowerCase();
        const row = allRows.find((r) => r.pool.dex.toLowerCase() === dexL && String(r.pool.id) === String(p.pool_id));
        if (!row) continue;
        const k = poolKey(row.pool.dex, row.pool.id);
        const shares = String(p.shares ?? "0");
        if (safeBig(shares) > 0n && safeBig(prevByKey.get(k)?.shares ?? "0") === 0n) {
          prevByKey.set(k, { key: k, shares, rewards: prevByKey.get(k)?.rewards ?? zeroRewards });
        }
        probedSet.add(k); // D1-known pools always stay in the live probe set
      }
      // Incremental: re-probe pools that hold shares, plus any never probed.
      // A full sweep (every 3 min) catches LP gained off-app. Pools with
      // known positions probe FIRST so the user's LP paints ahead of the
      // zero-share tail — the bulk queue behind the pool sweep is long.
      // LP can only exist where the wallet holds the underlying token —
      // heldTokens narrows the probe set to those pools instead of sweeping
      // the whole registry. Priority order: DB-known → held-token pools →
      // chunked discovery of everything else.
      const heldToks = new Set((heldTokens.data ?? []).map((t) => t.address.toLowerCase()));
      const isCandidate = (row: (typeof allRows)[number]) =>
        heldToks.has(row.asset0.address.toLowerCase()) || heldToks.has(row.asset1.address.toLowerCase());
      // Registry discovery is off — AWS positions + held-token candidates
      // cover real LP. Chain probes only where shares could actually exist.
      const targets = allRows.filter((row) => {
        const k = poolKey(row.pool.dex, row.pool.id);
        if (probedSet.has(k) && safeBig(prevByKey.get(k)?.shares || "0") > 0n) return true; // held — always verify
        return isCandidate(row); // wallet holds the token — LP possible
      }).sort((a, b) => {
        const aH = safeBig(prevByKey.get(poolKey(a.pool.dex, a.pool.id))?.shares || "0") > 0n ? 0 : 1;
        const bH = safeBig(prevByKey.get(poolKey(b.pool.dex, b.pool.id))?.shares || "0") > 0n ? 0 : 1;
        return aH - bH;
      });
      const sharesKey = ["asedex-shares", ownerHex];
      const fresh = new Map<string, ShareEntry>();
      let emitTick = 0;
      // Positions paint per-pool as each probe lands (and persist through the
      // query cache within ~1.5s) instead of appearing in one shot after the
      // whole batch. Zero-share probes are invisible — throttle their emits.
      const emit = (force: boolean) => {
        if (signal?.aborted || (!force && ++emitTick % 6 !== 0)) return;
        queryClient.setQueryData<ShareEntry[]>(sharesKey, allRows.map((row) => {
          const k = poolKey(row.pool.dex, row.pool.id);
          return fresh.get(k) ?? prevByKey.get(k) ?? { key: k, shares: "0", rewards: zeroRewards };
        }));
      };
      // AWS-authoritative: positions already seeded held pools above — when
      // the API answered, sharesOf verification is off (the same storm class
      // as the holdings sweep: every held-token pool re-probed per tick).
      // Live verify only runs when the API had NO positions for this wallet.
      // dbPos answering at all (even an empty list) is authoritative — an
      // empty AWS positions list must not fall back to probing every pool
      // that touches a held token.
      // AWS positions is the ONLY LP source — chain verification is off
      // entirely. API dark = keep the painted rows, probe nothing.
      const targets2: typeof targets = [];
      const sharesRes = targets2.length ? await viewContractBatch<unknown>(
        targets2.map((r) => ({ to: r.pool.dex, method: "sharesOf", args: [r.pool.id, ownerHex] })),
        // A full ~1500-pool sweep is background discovery — it queues behind
        // interactive reads so a cold wallet load never waits on zero-share
        // probes. Incremental ticks (holders + unprobed only) stay wallet lane.
        full ? { bulk: true } : { wallet: true }
      ).catch(() => targets2.map(() => undefined)) : [];
      if (!signal?.aborted) {
        targets2.forEach((row, i) => {
          const key = poolKey(row.pool.dex, row.pool.id);
          const prev = prevByKey.get(key);
          const shares = sharesRes[i] !== undefined ? String(sharesRes[i] || "0") : (prev?.shares ?? "0");
          fresh.set(key, { key, shares, rewards: prev?.rewards ?? zeroRewards });
        });
        emit(true);
      }
      const rewardTargets = targets2.filter((_, i) => {
        try { return safeBig(String(sharesRes[i] ?? "0")) > 0n; } catch { return false; }
      });
      const rewardsRes = rewardTargets.length && !signal?.aborted
        ? await viewContractBatch<unknown>(
            rewardTargets.map((r) => ({ to: r.pool.dex, method: "lpPendingRewards", args: [r.pool.id, ownerHex] })),
            { wallet: true }
          ).catch(() => null)
        : null;
      if (rewardsRes && !signal?.aborted) {
        rewardTargets.forEach((row, i) => {
          if (rewardsRes[i] === undefined) return;
          const key = poolKey(row.pool.dex, row.pool.id);
          const cur = fresh.get(key) ?? prevByKey.get(key) ?? { key, shares: "0", rewards: zeroRewards };
          fresh.set(key, { ...cur, rewards: String(rewardsRes[i] || zeroRewards) });
        });
        emit(true);
      }
      const entries = allRows.map((row) => {
        const k = poolKey(row.pool.dex, row.pool.id);
        return fresh.get(k) ?? prevByKey.get(k) ?? { key: k, shares: "0", rewards: zeroRewards };
      });
      const next: ShareStore = {
        fullAt: full ? now : (store?.fullAt ?? now),
        probed: [...new Set([...probedSet, ...fresh.keys()])],
        entries
      };
      shareStores.set(ownerHex, next);
      lsWrite(`asedex:shares:${ownerHex}`, next);
      return entries;
    }
  });
  // "No positions" is only true once every pool is known AND every pool was
  // probed for this wallet. Cached initialData clears isPending immediately and
  // a probe over a half-streamed pool list finishes early, so neither alone is
  // proof. Latched per wallet so the 45s background refetch doesn't flip a
  // confirmed-empty view back to a skeleton.
  const lpSettled = Boolean(ownerHex) && pools.isFetched && !pools.isFetching
    && (!LEGACY_DEXES.length || (legacyPools.isFetched && !legacyPools.isFetching))
    && myPools.isFetched && !myPools.isFetching;
  const [lpSettledFor, setLpSettledFor] = useState("");
  useEffect(() => { if (lpSettled) setLpSettledFor(ownerHex); }, [lpSettled, ownerHex]);
  const lpConfirmed = Boolean(ownerHex) && lpSettledFor === ownerHex;
  // DB positions — independent of allRows so LP still counts when the pools
  // list is empty/filtered or the dex lane is down (indexer = cache, not gate).
  const walletActivity = useQuery({
    queryKey: ["asedex-wallet-activity", ownerHex],
    enabled: Boolean(ownerHex && view === "wallet"),
    queryFn: async () => {
      // AWS ops trades + the AuraDex feed — the ops shard indexes asedex +
      // pad-bonded buys, auras covers AuraDex v1/v2 pools. Both merge into
      // the same IndexerLeg pairs the feed groups by tx.
      const [d, au] = await Promise.all([
        apiTrades({ wallet: ownerHex, limit: 200 }).catch(() => null),
        aurasIdx<{ trades?: AuraTrade[] }>(`/api/trades?wallet=${ownerHex}&limit=200`).catch(() => null)
      ]);
      // Symbol + decimals for each leg — resolved from the registry/asset
      // caches the pools load already filled (no reads).
      const metaOf2 = (addr: string) => {
        const k = addr.toLowerCase();
        return [...rows, ...legacyRows].flatMap((r) => [r.asset0, r.asset1]).find((a) => a.address.toLowerCase() === k)
          ?? assetSSRead()[k]
          ?? (() => { const f = factoryTokensKnown().find((x) => x.token === k); return f ? { symbol: f.symbol, decimals: f.decimals } : undefined; })();
      };
      const legs: IndexerLeg[] = [];
      for (const t of d?.trades ?? []) {
        // Wallet-scoped feed — trader IS the connected wallet even when the
        // row omits the field. ts arrives in ms → seconds for the sorter.
        const me = String(t.trader || ownerHex);
        const ts = Number(t.ts || 0); // ms — the render divides by 1000
        const m = metaOf2(String(t.token || ""));
        legs.push({ tx_hash: t.tx, block_number: t.block, timestamp: ts, from_addr: "", to_addr: me, token: t.token, value: t.amount_out, symbol: m?.symbol, decimals: m?.decimals, side: t.side, kind: String(t.token || "").toLowerCase() === NATIVE || !t.token ? "native" : "token" });
        legs.push({ tx_hash: t.tx, block_number: t.block, timestamp: ts, from_addr: me, to_addr: "", token: "", value: t.amount_in, side: t.side, kind: "native" });
      }
      for (const t of au?.trades ?? []) {
        const tx = String(t.txHash ?? "");
        const ts = Date.parse(String(t.ts || "")) || 0; // ms — the render divides by 1000
        const me = String(t.trader || ownerHex);
        const outTok = String(t.tokenOut || "");
        const inTok = String(t.tokenIn || "");
        const mo = metaOf2(outTok), mi = metaOf2(inTok);
        legs.push({ tx_hash: tx, block_number: 0, timestamp: ts, from_addr: "", to_addr: me, token: outTok, value: String(t.amountOut ?? "0"), symbol: mo?.symbol, decimals: mo?.decimals, side: t.side, kind: outTok.toLowerCase() === NATIVE || !outTok ? "native" : "token" });
        legs.push({ tx_hash: tx, block_number: 0, timestamp: ts, from_addr: me, to_addr: "", token: inTok, value: String(t.amountIn ?? "0"), symbol: mi?.symbol, decimals: mi?.decimals, side: t.side, kind: inTok.toLowerCase() === NATIVE || !inTok ? "native" : "token" });
      }
      if (!d && !au) return null;
      return legs;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const createdTokens = useQuery({
    queryKey: ["asedex-wallet-created", ownerHex],
    enabled: Boolean(ownerHex),
    queryFn: async () => {
      const d = await apiTokens({ creator: ownerHex, limit: 200 }).catch(() => null);
      // logo_url is only set when the token row carried it — most cards keep
      // the logo in card_json.metadata instead. Resolve both, same as the
      // seedDbAsset card path everywhere else.
      for (const t of d?.tokens ?? []) {
        if (t.logo_url || !t.card_json) continue;
        try {
          const c = JSON.parse(t.card_json) as { metadata?: { logoUrl?: string }; logoUrl?: string };
          t.logo_url = c?.metadata?.logoUrl ?? c?.logoUrl ?? t.logo_url;
        } catch { }
      }
      return d;
    },
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const dbPositions = useQuery({
    queryKey: ["asedex-db-positions", ownerHex],
    enabled: Boolean(ownerHex && (view === "pools" || view === "wallet")),
    refetchInterval: 3_000,
    staleTime: 30_000,
    queryFn: () => apiWalletPositions(ownerHex).catch(() => null),
  });
  const dbLpCount = (dbPositions.data?.positions ?? []).filter((p) => safeBig(p.shares || "0") > 0n).length;
  const shareByPool = new Map((myPools.data ?? []).map((entry) => [entry.key, entry.shares]));
  const rewardsByPool = new Map((myPools.data ?? []).map((entry) => { try { return [entry.key, JSON.parse(entry.rewards) as { amount0: string; amount1: string }]; } catch { return [entry.key, { amount0: "0", amount1: "0" }]; } }));
  const selectedShares = safeBig(shareByPool.get(selected ? poolKey(selected.dex, selected.id) : "") || "0");

  // My orders across every venue.
  const myOrders = useQuery({
    queryKey: ["asedex-orders", ownerHex, VENUES.concat(LEGACY_DEXES).join(",")],
    enabled: Boolean(ownerHex && pools.isSuccess && (view === "wallet" || view === "terminal")),
    refetchInterval: 3_000,
    queryFn: async () => {
      // AWS orders table first — one call covers limit+DCA on both dexes
      // (open/closed/filled). Chain enumeration below stays as the dark-API
      // fallback only; the legacy openOrders+getOrder scan is far too heavy
      // to run on every 15s tick.
      const api = await apiOrders({ wallet: ownerHex }).catch(() => null);
      if (api) {
        return api.orders.map((r) => toOrder({
          id: String(r.order_id ?? ""),
          owner: String(r.owner ?? ownerHex),
          poolId: String(r.pool_id ?? ""),
          kind: String(r.kind ?? "limit").toUpperCase() === "DCA" ? "DCA" : "LIMIT",
          tokenIn: String(r.token_in ?? ""),
          totalIn: String(r.amount_in ?? "0"),
          amountLeft: "0",
          minOut: String(r.limit_px ?? "0"),
          slicesTotal: String(r.slices ?? "1"),
          slicesDone: String(r.slices_done ?? "0"),
          intervalSec: String(Math.round(Number(r.interval_ms ?? 0) / 1000)),
          status: String(r.status ?? "open"),
        }, String(r.dex ?? "")));
      }
      // No chain fallback — a dark ops shard keeps the last snapshot, it
      // never triggers an order enumeration sweep.
      return [];
    }
  });
  const openMyOrders = (myOrders.data ?? []).filter((o) => o.status === "open");

  // Open orders on the SELECTED pool — powers the order book + depth tab.
  // openOrdersForPool reads just this pool's pending list (a handful of ids);
  // the old global openOrders scan fetched every venue's every order and sat
  // behind bulk sweeps — the book starved whenever enumeration ran hot.
  const bookOrders = useQuery({
    queryKey: ["asedex-book", selected?.dex ?? "", selected?.id ?? ""],
    enabled: pools.isSuccess && view === "terminal" && Boolean(selected),
    refetchInterval: 3_000,
    queryFn: async () => {
      const dex = selected!.dex;
      // AWS orders table first — ops shard already watches all three dexes,
      // so the book paints in one HTTP call instead of 1+N view calls.
      const api = await apiOrders({ pool: `${dex}:${selected!.id}`, status: "open" }).catch(() => null);
      if (api) {
        return api.orders.map((r) => toOrder({
          id: String(r.order_id ?? ""), owner: String(r.owner ?? ""),
          poolId: String(r.pool_id ?? ""), kind: String(r.kind ?? "limit").toUpperCase() === "DCA" ? "DCA" : "LIMIT",
          tokenIn: String(r.token_in ?? ""), totalIn: String(r.amount_in ?? "0"), amountLeft: "0",
          minOut: String(r.limit_px ?? "0"), slicesTotal: String(r.slices ?? "1"), slicesDone: String(r.slices_done ?? "0"),
          intervalSec: String(Math.round(Number(r.interval_ms ?? 0) / 1000)), status: String(r.status ?? "open"),
        }, String(r.dex ?? dex) || dex));
      }
      // No chain fallback — a dark ops shard leaves the book stale, not a
      // 1+N view-call storm.
      return [];
    }
  });

  // Order book for the selected pair: LIMIT orders only, split by side.
  // price is always ASE per token — buys invert amountIn/minOut, sells use it directly.
  const book = useMemo(() => {
    const empty = { asks: [] as { price: number; amount: number; cum: number; mine: boolean }[], bids: [] as { price: number; amount: number; cum: number; mine: boolean }[] };
    if (!selected || !selectedRow) return empty;
    const token = selectedRow.asset0.address === NATIVE ? selectedRow.asset1 : selectedRow.asset0;
    const quoteA = selectedRow.asset0.address === token.address ? selectedRow.asset1 : selectedRow.asset0;
    const tDec = token.decimals, qDec = quoteA.decimals;
    const limits = (bookOrders.data ?? []).filter((o) => o.dex === selected.dex && o.poolId === selected.id && o.kind === "LIMIT" && o.status === "open");
    type Level = { price: number; amount: number; cum: number; mine: boolean };
    const asks: Level[] = [], bids: Level[] = [];
    for (const o of limits) {
      // amountLeft "0" is truthy — a plain || never reaches totalIn and zeroes
      // every level. Only a genuinely nonzero remainder wins, else full size.
      const amt = safeBig(o.amountLeft !== "0" && o.amountLeft !== "" ? o.amountLeft : o.totalIn);
      const min = safeBig(o.minOut || "0");
      if (amt <= 0n || min <= 0n) continue;
      const mine = Boolean(ownerHex) && o.owner.toLowerCase() === ownerHex.toLowerCase();
      if (o.tokenIn === quoteA.address) {
        // buy: quote in → token out. price = quote/token = amountIn / minOut
        const price = (Number(amt) * 10 ** tDec) / (Number(min) * 10 ** qDec);
        const tokens = Number(min) / 10 ** tDec;
        if (Number.isFinite(price) && price > 0) bids.push({ price, amount: tokens, cum: 0, mine });
      } else {
        // sell: token in → quote out. price = minOut / amountIn
        const price = (Number(min) * 10 ** tDec) / (Number(amt) * 10 ** qDec);
        const tokens = Number(amt) / 10 ** tDec;
        if (Number.isFinite(price) && price > 0) asks.push({ price, amount: tokens, cum: 0, mine });
      }
    }
    asks.sort((a, b) => a.price - b.price);
    bids.sort((a, b) => b.price - a.price);
    let cum = 0;
    for (const a of asks) { cum += a.amount; a.cum = cum; }
    cum = 0;
    for (const b of bids) { cum += b.amount; b.cum = cum; }
    return { asks: asks.slice(0, 12), bids: bids.slice(0, 12) };
  }, [bookOrders.data, selected, selectedRow, ownerHex]);

  // Your open limit orders on this pair → horizontal markers on the chart.
  const myChartOrders = useMemo(() => {
    if (!selected || !selectedRow || !ownerHex) return [] as { price: number; side: "buy" | "sell" }[];
    const baseA = selectedRow.asset0.address === NATIVE ? selectedRow.asset1 : selectedRow.asset0;
    const quoteA = selectedRow.asset0.address === baseA.address ? selectedRow.asset1 : selectedRow.asset0;
    const tDec = baseA.decimals, qDec = quoteA.decimals;
    const out: { price: number; side: "buy" | "sell" }[] = [];
    for (const o of openMyOrders) {
      if (o.dex !== selected.dex || o.poolId !== selected.id || o.kind !== "LIMIT") continue;
      const amt = safeBig(o.amountLeft || o.totalIn);
      const min = safeBig(o.minOut || "0");
      if (amt <= 0n || min <= 0n) continue;
      const buy = o.tokenIn === quoteA.address;
      const price = buy
        ? (Number(amt) * 10 ** tDec) / (Number(min) * 10 ** qDec)
        : (Number(min) * 10 ** tDec) / (Number(amt) * 10 ** qDec);
      if (Number.isFinite(price) && price > 0) out.push({ price, side: buy ? "buy" : "sell" });
    }
    return out;
  }, [openMyOrders, selected, selectedRow, ownerHex]);

  const pairAsset = selectedRow ? (selectedRow.asset0.address === NATIVE ? selectedRow.asset1 : selectedRow.asset0) : undefined;
  // Indexer/synthetic rows ship placeholder assets (no totalSupply, decimal
  // guesses) — the selected pair's real meta resolves on the fast lane via a
  // cached tokenAsset read instead of waiting for the sweep's bulk batch.
  const pairMeta = useQuery({
    queryKey: ["asedex-pair-meta", pairAsset?.address],
    enabled: Boolean(pairAsset && pairAsset.address !== NATIVE),
    queryFn: () => tokenAsset(client, pairAsset!.address)
  });
  // pairMeta.data wins for freshness, but a re-read that partially fails
  // must never regress logo/card the row already resolved.
  const pairAssetFull = pairMeta.data ? mergeAsset(pairAsset, pairMeta.data) : pairAsset;
  // Non-circulating supply of the pair's token — burned (zero + dead
  // addresses) plus everything escrowed in AseLock (token locks + unclaimed
  // vesting; claims flow back out and become circulating on their own).
  const pairBurned = useQuery({
    queryKey: ["asedex-token-noncirc", pairAsset?.address],
    enabled: Boolean(view === "terminal" && pairAsset && pairAsset.address !== NATIVE),
    staleTime: 60_000,
    refetchInterval: 120_000,
    queryFn: () => apiTokenNoncirc(pairAsset!.address)
  });
  // Pair price straight from reserves — token priced in its quote asset,
  // independent of the swap direction the user has picked (currentSpot flips
  // with it). For ASE pairs the quote is ASE → USD-able; token/token pairs
  // display in the other token's unit.
  const pairQuote = selectedAssets.find((a) => a.address !== pairAsset?.address);
  // The quote leg can be a placeholder too on token↔token indexer rows.
  const pairQuoteMeta = useQuery({
    queryKey: ["asedex-pair-meta", pairQuote?.address],
    enabled: Boolean(pairQuote && pairQuote.address !== NATIVE),
    queryFn: () => tokenAsset(client, pairQuote!.address)
  });
  const pairQuoteFull = pairQuote?.address === NATIVE ? pairQuote : (pairQuoteMeta.data ?? pairQuote);
  const pairPriceQuote = selected && pairAssetFull && pairQuoteFull && !synthPool
    ? humanPrice(
        pairAssetFull.address === selected.token0 ? selected.reserve0 : selected.reserve1, pairAssetFull.decimals,
        pairQuoteFull.address === selected.token0 ? selected.reserve0 : selected.reserve1, pairQuoteFull.decimals
      )
    : 0;
  // Every hop keeps the depth floor: the priced leg must hold ≥100 ASE worth
  // of depth or the ratio extrapolates dust into fake USD (a $37-ASE pool
  // once priced a pair at $865k). Below the floor the token gets no price.
  const PRICE_SOURCE_MIN_ASE_WEI = 100n * 10n ** 18n; // ≈ $340 at the config rate
  // Dust-pool sanity: a pool only qualifies as a PRICE SOURCE when the market
  // cap its ratio implies survives contact with reality. A 233-ASE pool seeded
  // against 0.0001 TKN passes the depth floor yet implies 2.3M ASE/token —
  // that price then poisons every surface (markets, radar, pools, wallet) and
  // every hop. Implied mcap = price × supply must stay under the ceiling, and
  // the pool must hold a non-trivial share of supply (dust legs can't).
  const MAX_IMPLIED_MCAP_ASE = 5e7;    // ~$170M — nothing on this testnet is worth more
  const MAX_PRICE_ASE_UNKNOWN_SUPPLY = 1e5; // ~$340k/unit emergency bound when supply is unknown
  const MIN_POOL_SUPPLY_SHARE = 1e-7;  // ≥0.00001% of total supply held by the pool
  const supplyHuman = (a: Asset) => {
    const raw = a.totalSupply ? safeBig(a.totalSupply) : 0n;
    if (raw <= 0n) return 0;
    const dec = a.decimals ?? 18;
    return raw >= 10n ** BigInt(dec) ? Number(raw) / 10 ** dec : Number(raw);
  };
  const impliedSane = (a: Asset, price: number, resHuman: number) => {
    const sup = supplyHuman(a);
    // Unknown supply: unit-price cap alone let 6.16M-ASE fakes through.
    // The pool's own reserve is a supply LOWER bound (a pool can't hold more
    // than exists) — price × res is a minimum implied mcap that must also fit.
    if (sup <= 0) return price <= MAX_PRICE_ASE_UNKNOWN_SUPPLY && price * resHuman <= MAX_IMPLIED_MCAP_ASE;
    return price * sup <= MAX_IMPLIED_MCAP_ASE && resHuman / sup >= MIN_POOL_SUPPLY_SHARE;
  };
  // Memoized on the query data — the 1s clock tick must not re-run this BFS.
  const asePriceByToken = useMemo(() => {
    const map = new Map<string, { price: number; nativeRes: bigint; tokRes: bigint }>();
    const priceRows = [...rows, ...legacyRows];
    // Hop 0: direct ASE pools — deepest reserve wins per token.
    for (const row of priceRows) {
      const nativeSide = row.pool.token0 === NATIVE ? 0 : row.pool.token1 === NATIVE ? 1 : -1;
      if (nativeSide < 0) continue;
      if (safeBig(nativeSide === 0 ? row.pool.reserve0 : row.pool.reserve1) < PRICE_SOURCE_MIN_ASE_WEI) continue;
      const token = nativeSide === 0 ? row.asset1 : row.asset0;
      const tokenRes = safeBig(nativeSide === 0 ? row.pool.reserve1 : row.pool.reserve0);
      const nativeRes = safeBig(nativeSide === 0 ? row.pool.reserve0 : row.pool.reserve1);
      const p = humanPrice(tokenRes.toString(), token.decimals, nativeRes.toString(), 18);
      const resHuman = Number(tokenRes) / 10 ** token.decimals;
      const prev = map.get(token.address);
      if (p > 0 && impliedSane(token, p, resHuman) && (!prev || nativeRes > prev.nativeRes)) map.set(token.address, { price: p, nativeRes, tokRes: tokenRes });
    }
    // Hops 1+: token↔token pools where exactly one leg is priced — propagate
    // through the reserve ratio. First assignment wins (nearest hop = most
    // direct price path). Fixpoint-bounded so chains price end-to-end.
    for (let pass = 0; pass < 4; pass++) {
      let grew = false;
      for (const row of priceRows) {
        if (row.pool.token0 === NATIVE || row.pool.token1 === NATIVE) continue;
        const a0 = row.asset0, a1 = row.asset1;
        const p0 = map.get(a0.address), p1 = map.get(a1.address);
        if (Boolean(p0) === Boolean(p1)) continue; // both priced or neither — nothing to propagate
        const priced = p0 ? { a: a0, p: p0.price, res: row.pool.reserve0 } : { a: a1, p: p1!.price, res: row.pool.reserve1 };
        const other = p0 ? { a: a1, res: row.pool.reserve1 } : { a: a0, res: row.pool.reserve0 };
        const pricedHuman = Number(safeBig(priced.res || "0")) / 10 ** priced.a.decimals;
        const otherHuman = Number(safeBig(other.res || "0")) / 10 ** other.a.decimals;
        if (otherHuman <= 0 || pricedHuman <= 0) continue;
        // Trust floor on the priced leg — its ASE-equivalent depth must clear
        // the same bar a direct ASE pool would.
        if (pricedHuman * priced.p * 1e18 < Number(PRICE_SOURCE_MIN_ASE_WEI)) continue;
        const price = priced.p * (pricedHuman / otherHuman);
        // The derived price must pass the same supply sanity a direct pool
        // would — hops propagate dust otherwise. An unknown-supply token can
        // never be sanity-checked through a hop (the mcap bound needs real
        // supply), so it only earns a price from a direct ASE pool.
        if (price > 0 && supplyHuman(other.a) > 0 && impliedSane(other.a, price, otherHuman)) { map.set(other.a.address, { price, nativeRes: 0n, tokRes: safeBig(other.res) }); grew = true; }
      }
      if (!grew) break;
    }
    return map;
  }, [rows, legacyRows]);
  // Token's ASE price from its deepest direct ASE pool. `minWei` is the
  // depth floor — 100 ASE for quote-side conversion (matches the global BFS
  // so dust pools can't fake USD), 10 ASE for the viewed token's own caps
  // (a thin but real own-pool beats a mispriced quote route).
  const asePxOf = (addr: string, minWei: bigint) => {
    if (addr === NATIVE) return 1;
    const q = addr.toLowerCase();
    let best = { price: 0, res: 0n };
    for (const r of allRows) {
      const nativeSide = r.pool.token0 === NATIVE ? 0 : r.pool.token1 === NATIVE ? 1 : -1;
      if (nativeSide < 0) continue;
      if (r.asset0?.address.toLowerCase() !== q && r.asset1?.address.toLowerCase() !== q) continue;
      const nativeRes = safeBig(nativeSide === 0 ? r.pool.reserve0 : r.pool.reserve1);
      if (nativeRes < minWei) continue;
      const token = nativeSide === 0 ? r.asset1 : r.asset0;
      const tokenRes = safeBig(nativeSide === 0 ? r.pool.reserve1 : r.pool.reserve0);
      const p = humanPrice(tokenRes.toString(), token.decimals, nativeRes.toString(), 18);
      const resHuman = Number(tokenRes) / 10 ** token.decimals;
      if (p > 0 && impliedSane(token, p, resHuman) && nativeRes > best.res) best = { price: p, res: nativeRes };
    }
    return best.price;
  };
  // The BFS map is the primary source — it covers direct ASE pools AND
  // hop-priced tokens (PRB priced through the BET/PRB pool's priced BET leg).
  // asePxOf stays as the fallback for thin-but-real pools under the floor.
  const pairQuoteAsePx = useMemo(() => (pairQuote
    ? (asePriceByToken.get(pairQuote.address)?.price
      ?? asePriceByToken.get(pairQuote.address.toLowerCase())?.price
      ?? asePxOf(pairQuote.address, 100n * 10n ** 18n))
    : 0), [allRows, asePriceByToken, pairQuote]);
  const pairBaseAsePx = useMemo(() => (pairAsset
    ? (asePriceByToken.get(pairAsset.address)?.price
      ?? asePriceByToken.get(pairAsset.address.toLowerCase())?.price
      ?? asePxOf(pairAsset.address, 10n * 10n ** 18n))
    : 0), [allRows, asePriceByToken, pairAsset]);
  const pairPriceAse = pairQuote?.address === NATIVE ? pairPriceQuote : pairPriceQuote * pairQuoteAsePx;

  // Price flash: track the live reserve price — a swap moves it, so a change
  // means a trade just landed (up=buy/green, down=sell/red). Chain timestamps
  // lag/round so comparing values is more reliable than a 3s clock window.
  const livePrice = pairPriceAse > 0 ? pairPriceAse : pairPriceQuote;
  const prevPriceRef = useRef(0);
  const [pxFlash, setPxFlash] = useState<{ up: boolean; at: number } | null>(null);
  useEffect(() => {
    const prev = prevPriceRef.current;
    if (livePrice > 0 && prev > 0 && livePrice !== prev) {
      setPxFlash({ up: livePrice > prev, at: Date.now() });
    }
    prevPriceRef.current = livePrice;
  }, [livePrice]);
  const pxFlashCls = pxFlash && now - pxFlash.at < 3000
    ? (pxFlash.up ? "text-emerald-300" : "text-red-300") : null;

  // Wallet's token balance for the position card + percent fills.
  const myTokenBalance = useQuery({
    queryKey: ["asedex-tokbal", ownerHex, pairAsset?.address],
    enabled: Boolean(ownerHex && view === "terminal" && pairAsset && pairAsset.address !== NATIVE),
    refetchInterval: 3_000,
    queryFn: async () => numStr(await client.view(pairAsset!.address, "balanceOf", [ownerHex]).catch(() => "0"))
  });
  // Direct balance read for the swap input — the "Insufficient" gate must not
  // wait on the whole wallet sweep (heldTokens is a ~1300-candidate probe; a
  // token+token swap on an unswept leg would sit disabled for minutes).
  const inputBalance = useQuery({
    queryKey: ["asedex-tokbal", ownerHex, selectedInput?.address],
    enabled: Boolean(ownerHex && view === "terminal" && selectedInput && selectedInput.address !== NATIVE),
    refetchInterval: 3_000,
    queryFn: async () => numStr(await client.view(selectedInput!.address, "balanceOf", [ownerHex]).catch(() => "0"))
  });
  // LP modal legs — same starvation fix as the swap input: the modal can open
  // from Pools/Create/Terminal while heldTokens isn't sweeping at all, and a
  // starved sweep would leave "Insufficient" on forever. One read per leg.
  const liqBal0Q = useQuery({
    queryKey: ["asedex-tokbal", ownerHex, liq0?.address],
    enabled: Boolean(ownerHex && lpRow && liq0 && liq0.address !== NATIVE),
    refetchInterval: 3_000,
    queryFn: async () => numStr(await client.view(liq0!.address, "balanceOf", [ownerHex]).catch(() => "0"))
  });
  const liqBal1Q = useQuery({
    queryKey: ["asedex-tokbal", ownerHex, liq1?.address],
    enabled: Boolean(ownerHex && lpRow && liq1 && liq1.address !== NATIVE),
    refetchInterval: 3_000,
    queryFn: async () => numStr(await client.view(liq1!.address, "balanceOf", [ownerHex]).catch(() => "0"))
  });
  // Wallet's LP shares + pending rewards for the open modal — sharesOf is one
  // call; myPools (45s sweep, pools/wallet-gated) may not even be running on
  // the view that opened the modal, which would pin Remove at "No LP shares".
  const lpShareQ = useQuery({
    queryKey: ["asedex-lp-share", lpRow?.pool.dex, lpRow?.pool.id, ownerHex],
    enabled: Boolean(ownerHex && lpRow),
    refetchInterval: 3_000,
    queryFn: async () => String(await client.view(lpRow!.pool.dex, "sharesOf", [lpRow!.pool.id, ownerHex]).catch(() => "0") || "0")
  });
  const lpRewardsQ = useQuery({
    queryKey: ["asedex-lp-rewards", lpRow?.pool.dex, lpRow?.pool.id, ownerHex],
    enabled: Boolean(ownerHex && lpRow),
    refetchInterval: 3_000,
    queryFn: async () => {
      const raw = await client.view(lpRow!.pool.dex, "lpPendingRewards", [lpRow!.pool.id, ownerHex]).catch(() => null);
      try { return JSON.parse(String(raw || "null")) as { amount0: string; amount1: string } | null; } catch { return null; }
    }
  });
  // Modal pool position — drives the Remove tab's receive estimates. The
  // dedicated read is authoritative; the sweep map paints first while it loads.
  const lpShares = lpShareQ.data !== undefined
    ? (() => { try { return safeBig(lpShareQ.data || "0"); } catch { return 0n; } })()
    : safeBig(shareByPool.get(lpRow ? poolKey(lpRow.pool.dex, lpRow.pool.id) : "") || "0");
  const lpRewards = lpRewardsQ.data
    ?? rewardsByPool.get(lpRow ? poolKey(lpRow.pool.dex, lpRow.pool.id) : "")
    ?? { amount0: "0", amount1: "0" };
  const lpRewardsPending = safeBig(lpRewards.amount0) > 0n || safeBig(lpRewards.amount1) > 0n;



  // Tokens the wallet actually holds (pooled assets + factory-registered tokens),
  // powers the "My tokens" pickers in the Create pool card.
  const heldTokens = useQuery({
    queryKey: ["asedex-held-tokens", ownerHex],
    // Wallet view + the create-pool token pickers — not probed on Radar/Terminal.
    enabled: Boolean(ownerHex && (view === "wallet" || view === "pools")),
    refetchInterval: 3_000,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    // In-session snapshot paints the pickers instantly on view switches; the
    // persisted cache covers reloads. Stale-on-arrival so the sweep still
    // runs and corrects it.
    initialData: () => heldStores.get(ownerHex),
    initialDataUpdatedAt: 0,
    queryFn: async ({ signal }) => {
      try { return await heldTokensSweep(signal); } catch (e) {
        console.warn("[held-tokens] sweep failed:", e);
        (window as unknown as { __heldErr?: string }).__heldErr = String(e);
        throw e;
      }
    }
  });

  async function heldTokensSweep(signal: AbortSignal | undefined) {
      // Previously-held = in-memory store PLUS the persisted query restore. The
      // memory store is empty on a reload, and seeding from it alone made the
      // first emit overwrite the restored rows with [] (blank wallet on reload).
      const prevByAddr = new Map([
        ...(queryClient.getQueryData<HeldToken[]>(["asedex-held-tokens", ownerHex]) ?? []),
        ...(heldStores.get(ownerHex) ?? [])
      ].map((t) => [t.address.toLowerCase(), t]));
      // Drop the persisted snapshot older builds wrote — nothing reads it now.
      try { localStorage.removeItem(`asedex:held:${ownerHex}`); sessionStorage.removeItem(`asedex:held:${ownerHex}`); } catch { }
      // Candidate universe — wallet-centric, no upfront pool enumeration:
      // the explorer indexer /tokens answers "what is held" in ONE call (the
      // fast path below short-circuits on it). The rest is the fallback net —
      // the factory registry is the spine (persisted immutable records — one
      // tokenCount + delta getToken reads), the indexer /api/pairs covers
      // every AseDex + AuraDex pool leg in one HTTP call, /api/trades?wallet=
      // covers tokens this wallet ever traded, the persisted AsePad dir
      // covers bonding-curve holds, and in-memory pool rows add whatever's
      // loaded. Only balanceOf probes hit RPC, through the bulk lane.
      const candSet = new Set<string>(asepadKnownTokens());
      // Every token the pad directory knows (any status incl. MIGRATED) —
      // tags the PAD badge on held rows even when meta came from a fast lane
      // that never ran the launch check.
      const knownPadTokens = new Set(asepadKnownTokens().map((t) => t.toLowerCase()));
      const tradedSet = new Set<string>();
      const mineSet = new Set<string>();
      const xferSet = new Set<string>();
      const posSet = new Set<string>();
      // Persisted journal — every token this wallet ever traded, received,
      // created or swept into a prior portfolio. Survives indexer outages and
      // covers pad bonding-curve buys the dex indexer can't see.
      const logSet = new Set<string>();
      for (const t of userLogTokens(ownerHex)) {
        try {
          const h = toHexAddress(String(t || "")).toLowerCase();
          if (/^0x[0-9a-f]{40}$/i.test(h) && h !== NATIVE) { candSet.add(h); logSet.add(h); }
        } catch { }
      }
      // Inbound-receive journal: the live-chain watcher notes any token
      // contract whose events touch this wallet. Zero-RPC discovery source —
      // same signal as the indexer trades feed but also catches plain
      // receives that never hit a DEX.
      const seenSet = walletSeenTokens(ownerHex);
      for (const t of seenSet) if (t !== NATIVE) candSet.add(t);
      const ownerAse = (() => { try { return String(toAseAddress(ownerHex)); } catch { return ownerHex; } })();
      // ── Shared paint state — hoisted ahead of the parallel fetch layer so
      // the indexer fast lane can push rows + emit before the rest resolves.
      const heldKey = ["asedex-held-tokens", ownerHex];
      const out: HeldToken[] = [];
      const outIdxByAddr = new Map<string, number>();
      const pushHeld = (t: HeldToken) => {
        const k = t.address.toLowerCase();
        if (!t.fromPad && knownPadTokens.has(k)) t = { ...t, fromPad: true };
        const i = outIdxByAddr.get(k);
        if (i === undefined) { outIdxByAddr.set(k, out.length); out.push(t); } else out[i] = t;
      };
      const dropHeld = (addr: string) => {
        const i = outIdxByAddr.get(addr);
        if (i === undefined) return;
        out.splice(i, 1);
        outIdxByAddr.clear();
        out.forEach((t, j) => outIdxByAddr.set(t.address.toLowerCase(), j));
      };
      const balByAddr = new Map<string, string>();
      const idxMeta = new Map<string, IndexerToken>();
      const positive = (bal: string | undefined) => { try { return !!bal && safeBig(bal) > 0n; } catch { return false; } };
      // Tokens paint one by one as balances+metadata resolve — the wallet tab
      // fills per-token instead of waiting for the whole candidate sweep. Emits
      // merge every prior token not yet resolved (or not probed this pass) so a
      // mid-sweep write can never drop a known token.
      const emit = () => {
        if (signal?.aborted) return;
        const covered = new Set(out.map((t) => t.address.toLowerCase()));
        const merged = [...out];
        for (const [addr, t] of prevByAddr) {
          if (covered.has(addr)) continue;
          const b = balByAddr.get(addr);
          if (b !== undefined && b !== "__err") { try { if (safeBig(b) <= 0n) continue; } catch { } }
          merged.push(t);
        }
        queryClient.setQueryData<HeldToken[]>(heldKey, merged);
      };
      const metaOf = (addr: string) =>
        prevByAddr.get(addr)
        ?? [...rows, ...legacyRows].flatMap((r) => [r.asset0, r.asset1]).find((a) => a.address.toLowerCase() === addr)
        ?? assetSSRead()[addr]
        ?? (() => {
          // Factory config carries name/symbol/decimals/logo — resolves most
          // tokens without a single token-contract read.
          const ft = factoryTokensKnown().find((f) => f.token === addr);
          return ft ? { address: addr, name: ft.name || "Unknown token", symbol: ft.symbol || "?", decimals: ft.decimals ?? 18, logoUrl: ft.logoUrl, totalSupply: ft.totalSupply, fromPad: ft.archetype === "ASEPAD" } : undefined;
        })()
        ?? (() => { const it = idxMeta.get(addr); return it ? { address: addr, name: it.name || "Unknown token", symbol: it.symbol || "?", decimals: it.decimals ?? 18 } : undefined; })();
      // Confirmed-holdings fast lane — the indexer /tokens snapshot already
      // carries balances, so the wallet pickers paint in ONE HTTP round trip
      // with zero RPC dependency. The on-chain verify below runs behind it and
      // replaces these optimistic rows with real balances + metadata (and
      // culls anything the chain reports as zero).
      // Explorer indexer lane removed — it 502'd on every sweep. AWS wallet
      // is the sole holdings source.
      const idxFast = Promise.resolve(null);
      // Our own DB wallet snapshot — same one-call paint as the explorer
      // indexer lane, but served from asepad's D1 (holders maintained by the
      // block tail + lazy re-hydrate on read). Independent failure domain:
      // when the explorer indexer 429s, this lane still paints.
      const apiFast = apiWallet(ownerHex).then((d) => {
        for (const t of d?.tokens ?? []) {
          const h = String(t.token || "").toLowerCase();
          if (!/^0x[0-9a-f]{40}$/i.test(h) || h === NATIVE) continue;
          candSet.add(h);
          balByAddr.set(h, String(t.balance ?? "0"));
          if (positive(String(t.balance ?? "0"))) {
            // Full card seed first — the row paints with real meta instantly.
            seedDbAsset(h, { name: t.name, symbol: t.symbol, decimals: t.decimals, logoUrl: t.logo_url, totalSupply: t.total_supply, card: t.card_json, pad: t.pad });
            const m0 = metaOf(h);
            // metaOf may answer a sparse prev/pool row — merge the D1 logo the
            // wallet lane carries rather than dropping it on the floor.
            const a = m0 ? { ...m0, logoUrl: (m0 as Asset).logoUrl ?? t.logo_url ?? undefined } : {
              address: h, name: t.name || "Unknown token",
              symbol: t.symbol || "?", decimals: t.decimals ?? 18, logoUrl: t.logo_url ?? undefined
            };
            pushHeld({ ...a, address: h, balance: numStr(String(t.balance)) });
          }
        }
        emit();
        return d;
      }).catch(() => null);
      // Trades + transfer log go through shared query keys — mySwaps (Wallet
      // history) reads the SAME two endpoints, so one fetch feeds both.
      const [allPairs, traded, idxPortfolio, apiPortfolio, idxXfers, idxPos] = await Promise.all([
        fetchAuraPairs().catch(() => null),
        queryClient.fetchQuery({ queryKey: ["asedex-wallet-trades", ownerHex], queryFn: () => aurasIdx<{ trades?: AuraTrade[] }>(`/api/trades?wallet=${ownerHex}&limit=200`), staleTime: 15_000 }).catch(() => null),
        idxFast,
        apiFast,
        Promise.resolve(null), // indexer transfers lane removed — AWS is the only feed
        // Auras /api/positions — same key+shape as the Wallet view's cost-basis
        // query so one HTTP call feeds both. Covers buys on BOTH venues; it is
        // the direct replacement for the CORS-less explorer indexer /tokens.
        queryClient.fetchQuery({
          queryKey: ["asedex-idx-positions", ownerHex], staleTime: 15_000,
          queryFn: async () => {
            const d = await aurasIdx<{ positions?: { token?: string; avgPriceASE?: number; tokensBought?: number; aseSpent?: number; buys?: number }[] }>(`/api/positions?wallet=${ownerHex}`);
            const m = new Map<string, { ase: number; qty: number }>();
            for (const p of d?.positions ?? []) {
              const a = String(p.token || "").toLowerCase();
              if (/^0x[0-9a-f]{40}$/.test(a) && Number(p.tokensBought) > 0) m.set(a, { ase: Number(p.aseSpent) || 0, qty: Number(p.tokensBought) });
            }
            return m;
          }
        }).catch(() => null),
      ]);
      for (const p of allPairs?.pairs ?? []) {
        for (const t of [p.token0, p.token1]) {
          try { const h = toHexAddress(String(t || "")).toLowerCase(); if (/^0x[0-9a-f]{40}$/i.test(h) && h !== NATIVE) candSet.add(h); } catch { }
        }
      }
      for (const t of traded?.trades ?? []) {
        for (const a of [t.tokenIn, t.tokenOut]) {
          try { const h = toHexAddress(String(a || "")).toLowerCase(); if (/^0x[0-9a-f]{40}$/i.test(h) && h !== NATIVE) { candSet.add(h); tradedSet.add(h); } } catch { }
        }
      }
      // AWS trades already seed candSet — the indexer transfers lane is gone.
      for (const t of traded?.trades ?? []) {
        try {
          for (const leg of [t.tokenIn, (t as { tokenOut?: string }).tokenOut]) {
            const h = toHexAddress(String(leg || "")).toLowerCase();
            if (/^0x[0-9a-f]{40}$/i.test(h) && h !== NATIVE) { candSet.add(h); xferSet.add(h); }
          }
        } catch { }
      }
      // Auras positions — tokens this wallet bought on either venue. Ranks hot
      // so a balance check paints them in the first wave even when the wallet
      // never touched a DEX pair visible to the trades feed.
      for (const a of idxPos?.keys() ?? []) {
        if (a !== NATIVE) { candSet.add(a); posSet.add(a); }
      }
      for (const row of [...rows, ...legacyRows]) {
        for (const a of [row.asset0, row.asset1]) if (a.address !== NATIVE) candSet.add(a.address.toLowerCase());
      }
      // Factory registry: the source of truth for platform-deployed tokens.
      // Cached forever (immutable records) — a cold first pass needs ~640
      // getToken reads, so it runs in the BACKGROUND and its delta is probed
      // after the high-signal candidates. Awaiting it up front would park the
      // whole balance sweep behind a registry sync.
      const factoryRefresh = !factoryTokensCache
        ? factoryTokensRefresh((a, m, args, o) => client.view(a, m, args, o)).catch(() => factoryTokensKnown())
        : Promise.resolve(factoryTokensKnown());
      for (const ft of factoryTokensKnown()) {
        try { const h = toHexAddress(ft.token).toLowerCase(); if (/^0x[0-9a-f]{40}$/i.test(h)) { candSet.add(h); if (ft.creator === ownerHex.toLowerCase()) mineSet.add(h); } } catch { }
      }
      // Pad-curve holds: no indexer sees an un-migrated bonding buy, and the
      // userLog journal only covers buys made on THIS device. Rank the pad
      // dir's live curves (BONDING/BONDED) just under the hot set, newest
      // first — a cross-device pad buy paints in the first tail waves
      // instead of behind the whole token universe. Migrated launches are
      // already covered by /api/pairs pool legs.
      const padSet = new Set<string>();
      const padTs = new Map<string, number>();
      for (const t of asepadKnownTokens()) {
        const h = t.toLowerCase();
        const l = asepadPeekLaunchRecord(h);
        if (l && (l.status === "BONDING" || l.status === "BONDED")) padSet.add(h);
        padTs.set(h, Number(l?.createdTs) || 0);
      }
      // Order matters — bulk probes are rate-limited, so the tokens most
      // likely held (previously held, traded, or self-created) paint first
      // and the long tail sweeps behind them.
      const rank = (a: string) => prevByAddr.has(a) ? 0 : (tradedSet.has(a) || seenSet.has(a) || xferSet.has(a) || posSet.has(a) || logSet.has(a)) ? 1 : mineSet.has(a) ? 2 : 3;
      // padSet is deliberately rank-3: ~3k live curves balanceOf-probed in
      // 150-slices every 30s tick was the last 429 driver. Pad buys surface
      // via idxXfers/apiTrades anyway — the cold sweep still catches the
      // rare un-indexed curve on its own slow cadence.
      // AWS wallet tokens are authoritative for what's held — when the API
      // answers, only chain-probe tokens it didn't list but we still suspect
      // (pad-curve buys, self-created, traded elsewhere). Kills the 640-token
      // balanceOf storm the registry-candidate net used to fire every 30s.
      const apiListed = new Set((apiPortfolio?.tokens ?? []).map((t) => String(t.token || "").toLowerCase()));
      // AWS is the ONLY holdings source — no chain fallback at all. When the
      // API fails the painted rows (indexer fast lane + previous snapshot)
      // stay on screen and the whole probe net below never runs.
      const apiCovered = true;
      // AWS-authoritative: when /api/wallet answers with the wallet's holdings,
      // the entire chain probe net is off — no balanceOf waves, no cold tail.
      // The API already did the touched-token discovery server-side.
      if (apiCovered) {
        heldStores.set(ownerHex, out);
        heldSettledOwners.add(ownerHex);
        userLogSetPortfolio(ownerHex, out.map((t) => t.address));
        return out;
      }
      const targets = [...candSet]
        .filter((a) => !apiCovered || !apiListed.has(a))
        .sort((a, b) => rank(a) - rank(b) || (padTs.get(b) ?? 0) - (padTs.get(a) ?? 0));
      // Fake-airdrop defense (vault): a scam token fabricates a nonzero
      // balance for EVERY address, so a sentinel that never received anything
      // still "holds" it. Drop any token that claims a balance for it. The
      // sentinel probes ride the same JSON-RPC batch — one POST covers all
      // positive candidates.
      const BALANCE_PROBE = "0x5a17b30ac0f3a2a1e6e9a3c5b2d1f4e6a8c0b2d4";
      const finishHeld = async (heldAddrs: string[], sentinelByAddr: Map<string, string | undefined>, metaOpts?: { wallet?: boolean; bulk?: boolean }) => {
        const real = heldAddrs.filter((a) => !positive(sentinelByAddr.get(a))); // drop scam phantom-balance tokens
        // Uncached metadata for all held tokens resolves in one batch (~6 calls each → 1 POST).
        // A sparse factory-seeded asset (no logo AND no card) doesn't count as
        // resolved — the batch fills gaps the registry never captured.
        const needMeta = real.filter((a) => { const m = metaOf(a) as Asset | undefined; return !m || (!m.logoUrl && !m.meta); });
        const metas = needMeta.length ? await tokenAssetsBatch(client, needMeta, true, metaOpts) : new Map<string, Asset>();
        for (const addr of real) {
          // The freshly-resolved batch asset wins over a sparse metaOf row —
          // a prev/pool/factory row without logo+meta is exactly what queued
          // this token for resolution; preferring it kept logos blank forever.
          const asset = metas.get(addr) ?? metaOf(addr) ?? null;
          if (asset) { pushHeld({ ...asset, address: addr, balance: numStr(balByAddr.get(addr)) }); emit(); }
        }
      };
      // JSON-RPC batch probes — ~150 balanceOf calls per POST. Per-call errors
      // self-isolate (a dead token errors only its own entry), so no helper
      // contract or bisection needed. `opts` picks the gate lane — the visible
      // verify wave rides the ui lane (the user is staring at these pickers),
      // background waves stay on wallet/bulk.
      const probe = async (addrs: string[], opts?: { wallet?: boolean; bulk?: boolean }): Promise<string[]> => {
        if (!addrs.length || signal?.aborted) return [];
        const res = await viewContractBatch<string>(addrs.map((a) => ({ to: a, method: "balanceOf", args: [ownerHex] })), opts);
        const heldNow: string[] = [];
        addrs.forEach((a, i) => {
          const b = res[i];
          if (b === undefined) {
            balByAddr.set(a, "__err");
            // Errored probes keep any previously-known row — a flaky read
            // must not vanish a held token.
            const prev = prevByAddr.get(a);
            if (prev) { pushHeld(prev); emit(); }
            return;
          }
          const bal = String(b);
          balByAddr.set(a, bal);
          if (positive(bal)) heldNow.push(a);
        });
        return heldNow;
      };
      // On-chain verify of the indexer fast lane — runs on the ui lane (user
      // focus), confirms/culls the optimistic rows, and upgrades them with
      // real balances + metadata. Returning here would hide every token the
      // indexer hasn't crawled yet — fresh receives, brand-new pad buys,
      // tokens with no pool — so the waves below keep sweeping behind it.
      if (idxPortfolio) {
        const idxHeld = await probe([...new Set([...idxMeta.keys(), ...prevByAddr.keys()])]);
        // Cull optimistic rows the chain reports as zero — __err reads keep
        // the indexer row (flaky node ≠ empty balance).
        for (const a of idxMeta.keys()) {
          const b = balByAddr.get(a);
          if (b !== undefined && b !== "__err" && !positive(b)) dropHeld(a);
        }
        const sent = await viewContractBatch<string>(idxHeld.map((a) => ({ to: a, method: "balanceOf", args: [BALANCE_PROBE] })), { wallet: true });
        await finishHeld(idxHeld, new Map(idxHeld.map((a, i) => [a, sent[i] === undefined ? undefined : String(sent[i])])));
      }
      // Two waves: high-signal candidates (previously held / traded / journaled
      // / self-created / live-chain-observed) probe and PAINT first — usually
      // <~300 calls → 2 POSTs — then the factory-registry tail sweeps behind
      // them. Candidates the indexer wave already verified skip re-probing
      // via balByAddr.
      const hot = targets.filter((a) => rank(a) <= 2 && !balByAddr.has(a));
      const cold = targets.filter((a) => rank(a) > 2 && !balByAddr.has(a));
      // Progressive hot wave: `targets` is rank-ordered, so the first slice is
      // the likeliest holdings (prev held / traded / auras positions /
      // journal) and paints after ~1 POST. The pad-curve set (~3k live curves
      // with the launch snapshot) streams behind it slice by slice — probing
      // the whole wave before the first paint left the wallet blank 40s+.
      // Strong signals (rank ≤1: prev held / traded / auras positions /
      // transfers / journal) ride their own tiny first POST — a 150-call
      // slice padded with pad curves 429'd on a congested node and stalled
      // the very rows most likely to be held.
      const strongN = hot.findIndex((a) => rank(a) > 1);
      const slices: string[][] = [];
      if (strongN !== 0) slices.push(hot.slice(0, strongN < 0 ? hot.length : strongN));
      for (let i = strongN < 0 ? hot.length : strongN; i < hot.length; i += 150) slices.push(hot.slice(i, i + 150));
      for (const slice of slices) {
        if (signal?.aborted) break;
        const heldSlice = await probe(slice, { wallet: true });
        if (!heldSlice.length) continue;
        const sent = await viewContractBatch<string>(heldSlice.map((a) => ({ to: a, method: "balanceOf", args: [BALANCE_PROBE] })), { wallet: true });
        await finishHeld(heldSlice, new Map(heldSlice.map((a, j) => [a, sent[j] === undefined ? undefined : String(sent[j])])), { wallet: true });
      }
      // Cold tail — only re-sweeps every HELD_COLD_SWEEP_MS per owner. The
      // 30s refetches re-probe just the hot wave; prev rows merge back below.
      const coldDue = (heldColdSweptAt.get(ownerHex) ?? 0) < Date.now() - HELD_COLD_SWEEP_MS;
      if (coldDue) {
        const tailDone = heldTailDone.get(ownerHex) ?? new Set<string>();
        heldTailDone.set(ownerHex, tailDone);
        // Background factory sync finishes here — probe only the delta (records
        // added since the first pass; most overlap with pairs/trades already).
        const factoryDelta: string[] = [];
        for (const ft of await factoryRefresh) {
          try {
            const h = toHexAddress(ft.token).toLowerCase();
            if (!/^0x[0-9a-f]{40}$/i.test(h)) continue;
            candSet.add(h);
            if (ft.creator === ownerHex.toLowerCase()) mineSet.add(h);
            if (!balByAddr.has(h) && !tailDone.has(h)) factoryDelta.push(h);
          } catch { }
        }
        // Progressive paint: probe the tail in per-POST chunks (256 = one
        // batch each) and push+sentinel+emit after every slice — a whale's
        // 100s of tokens stream in as they land instead of arriving in one
        // shot after ~25 POSTs. Wallet lane, not bulk: this IS the view the
        // user is staring at (background enumeration still yields to it).
        // Slices mark themselves done AFTER their probe lands — an abort keeps
        // the cursor, so the next sweep resumes here instead of redoing the
        // head. Errored reads stay out of tailDone so they get retried.
        const tail = [...cold, ...factoryDelta].filter((a) => !tailDone.has(a));
        let finished = true;
        for (let i = 0; i < tail.length; i += 256) {
          if (signal?.aborted) { finished = false; break; }
          const slice = tail.slice(i, i + 256);
          const heldSlice = await probe(slice, { wallet: true });
          for (const a of slice) if (balByAddr.get(a) !== "__err") tailDone.add(a);
          if (heldSlice.length) {
            const sentSlice = await viewContractBatch<string>(heldSlice.map((a) => ({ to: a, method: "balanceOf", args: [BALANCE_PROBE] })), { wallet: true });
            await finishHeld(heldSlice, new Map(heldSlice.map((a, j) => [a, sentSlice[j] === undefined ? undefined : String(sentSlice[j])])), { wallet: true });
          }
          if (signal?.aborted) { finished = false; break; }
        }
        // Sweep-complete marker only once the whole tail landed — an aborted
        // run stays "due" and resumes at its cursor on the next pass.
        if (finished && !signal?.aborted) {
          heldColdSweptAt.set(ownerHex, Date.now());
          heldTailDone.delete(ownerHex);
        }
      }
      for (const [addr, t] of prevByAddr) if (!balByAddr.has(addr)) pushHeld(t);
      heldStores.set(ownerHex, out);
      heldSettledOwners.add(ownerHex);
      // Record the confirmed portfolio into the user log so the trade
      // journal stays warm for next session's history view.
      userLogSetPortfolio(ownerHex, out.map((t) => t.address));
      return out;
  }

  // ── Create pool: resolve the entered contracts, wallet balances, deposit math ──
  // tokenB blank pairs against ASE; filled creates an ARC-20/ARC-20 pool.
  const createTokenAAddr = normAddr(tokenAddress);
  const createTokenBAddr = tokenBAddress.trim() ? normAddr(tokenBAddress) : NATIVE;
  const createAValid = /^0x[0-9a-f]{40}$/.test(createTokenAAddr) && createTokenAAddr !== NATIVE;
  const createBValid = /^0x[0-9a-f]{40}$/.test(createTokenBAddr);
  // Held-token shortcut — a token picked from the wallet dropdown already has
  // resolved metadata + balance in heldTokens, so paint the card instantly
  // and let the queries verify/refresh behind it. Without this, every pick
  // waited on fresh meta reads (~6 calls) + a balance read.
  const heldOf = (addr: string) => heldTokens.data?.find((t) => t.address.toLowerCase() === addr);
  const createAssetAQ = useQuery({
    queryKey: ["asedex-create-asset", createTokenAAddr],
    enabled: view === "pools" && createAValid,
    queryFn: () => tokenAsset(client, createTokenAAddr),
    placeholderData: (prev: Asset | undefined) => heldOf(createTokenAAddr) ?? prev
  });
  const createAssetBQ = useQuery({
    queryKey: ["asedex-create-asset", createTokenBAddr],
    enabled: view === "pools" && createBValid && createTokenBAddr !== NATIVE,
    queryFn: () => tokenAsset(client, createTokenBAddr),
    placeholderData: (prev: Asset | undefined) => heldOf(createTokenBAddr) ?? prev
  });
  const createAssetA = createAValid ? createAssetAQ.data : undefined;
  const createAssetB: Asset | undefined = createTokenBAddr === NATIVE ? ASE_ASSET : (createBValid ? createAssetBQ.data : undefined);
  const createBalAQ = useQuery({
    queryKey: ["asedex-tokbal", ownerHex, createTokenAAddr],
    enabled: Boolean(ownerHex && view === "pools" && createAValid),
    refetchInterval: 15000,
    placeholderData: () => heldOf(createTokenAAddr)?.balance,
    queryFn: async () => numStr(await client.view(createTokenAAddr, "balanceOf", [ownerHex]).catch(() => "0"))
  });
  const createBalBQ = useQuery({
    queryKey: ["asedex-tokbal", ownerHex, createTokenBAddr],
    enabled: Boolean(ownerHex && view === "pools" && createBValid && createTokenBAddr !== NATIVE),
    refetchInterval: 15000,
    placeholderData: () => heldOf(createTokenBAddr)?.balance,
    queryFn: async () => numStr(await client.view(createTokenBAddr, "balanceOf", [ownerHex]).catch(() => "0"))
  });
  const createBalA = safeBig(createBalAQ.data || "0");
  const createBalB = createTokenBAddr === NATIVE ? safeBig(aseBalance || "0") : safeBig(createBalBQ.data || "0");
  const depAWei = createAssetA ? parseUnits(depAmtA, createAssetA.decimals) : null;
  const depBWei = createAssetB ? parseUnits(depAmtB, createAssetB.decimals) : null;
  const depActive = Boolean(depAWei && depAWei > 0n && depBWei && depBWei > 0n);
  const depOneSided = Boolean(depAWei && depAWei > 0n) !== Boolean(depBWei && depBWei > 0n);
  const depCostA = liqCostOf(createAssetA, depAWei);
  const depCostB = liqCostOf(createAssetB, depBWei);
  const depOverA = depCostA !== null && depCostA > createBalA;
  const depOverB = depCostB !== null && depCostB > createBalB;
  // Price the first deposit sets — 1 token A quoted in B.
  const initPrice = depActive && createAssetA && createAssetB
    ? (Number(depBWei) / 10 ** createAssetB.decimals) / (Number(depAWei) / 10 ** createAssetA.decimals)
    : 0;
  // AsePad tokens gate DEX liquidity until their migration unlocks.
  const createGate = useQuery({
    queryKey: ["asedex-gate", createTokenAAddr, createTokenBAddr],
    enabled: view === "pools" && (createAValid || (createBValid && createTokenBAddr !== NATIVE)),
    queryFn: async () => {
      const gates = await Promise.all([createTokenAAddr, createTokenBAddr]
        .filter((a) => /^0x[0-9a-f]{40}$/.test(a) && a !== NATIVE)
        .map((a) => tokenDexGate(client, a)));
      return { locked: gates.some((g) => g.locked), migrating: gates.some((g) => g.migrating) };
    }
  });
  const createLocked = createGate.data?.locked === true;

  // If this pair already has a pool on the chosen venue, the card switches to
  // "add liquidity at pool price" — one pool per pair is enforced on-chain.
  const existingPoolQ = useQuery({
    queryKey: ["asedex-pair-pool", createDex, createTokenAAddr, createTokenBAddr],
    enabled: view === "pools" && createAValid && createBValid && createTokenAAddr !== createTokenBAddr,
    queryFn: async () => {
      // AWS pair lookup — one indexed read instead of poolForPair+getPool RPC
      // round-trips (and it can never hang on a dark RPC lane).
      const res = await apiPools(`?dex=${createDex}&token=${createTokenAAddr}&state=all&limit=50`).catch(() => null);
      const want = new Set([createTokenAAddr, createTokenBAddr]);
      for (const p of res?.pools ?? []) {
        const legs = new Set([String(p.token0).toLowerCase(), String(p.token1).toLowerCase()]);
        if (legs.size === 2 && [...want].every((a) => legs.has(a)))
          return sanPool({ id: String(p.pool_id), dex: p.dex, token0: p.token0, token1: p.token1,
            reserve0: p.reserve0, reserve1: p.reserve1, feeBps: String(p.fee_bps ?? 30), totalShares: String(p.lp_supply ?? "0") } as Pool);
      }
      return null;
    }
  });
  const existingPool = existingPoolQ.data ?? null;
  const epRes0 = existingPool ? safeBig(existingPool.reserve0 || "0") : 0n;
  const epRes1 = existingPool ? safeBig(existingPool.reserve1 || "0") : 0n;
  const epPriced = epRes0 > 0n && epRes1 > 0n;
  // Map the form's A/B order onto the pool's token0/token1 order.
  const epAIsToken0 = !existingPool || String(existingPool.token0).toLowerCase() === createTokenAAddr;
  const epResA = epAIsToken0 ? epRes0 : epRes1;
  const epResB = epAIsToken0 ? epRes1 : epRes0;
  const epPrice = epPriced && createAssetA && createAssetB
    ? (Number(epResB) / 10 ** createAssetB.decimals) / (Number(epResA) / 10 ** createAssetA.decimals)
    : 0;

  // Transaction-count hints — one batched trustedSpender+allowance probe per
  // active surface answers "approve needed?" for every token leg, so each
  // button can tell the user how many wallet signatures the action takes.
  const txCheckEntries = (() => {
    const seen = new Set<string>();
    const out: { token: string; dex: string }[] = [];
    const push = (token: string | undefined, dex: string | undefined) => {
      if (!token || !dex || token === NATIVE) return;
      const k = `${token.toLowerCase()}:${dex}`;
      if (!seen.has(k)) { seen.add(k); out.push({ token, dex }); }
    };
    if (view === "terminal" && selected && selectedInput) push(selectedInput.address, selected.dex);
    if (view === "pools") {
      if (createAValid) push(createTokenAAddr, createDex);
      if (createBValid) push(createTokenBAddr, createDex);
    }
    if (lpRow) { push(liq0?.address, lpRow.pool.dex); push(liq1?.address, lpRow.pool.dex); }
    return out;
  })();
  const txAllowQ = useQuery({
    queryKey: ["asedex-tx-allow", ownerHex, txCheckEntries.map((e) => `${e.token}:${e.dex}`).join("|")],
    enabled: Boolean(ownerHex && txCheckEntries.length),
    staleTime: 15_000,
    refetchInterval: 3_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res = await viewContractBatch<unknown>(txCheckEntries.flatMap((e) => [
        { to: e.token, method: "trustedSpender", args: [e.dex] },
        { to: e.token, method: "allowance", args: [ownerHex!, e.dex] }
      ]), { wallet: true }).catch(() => [] as unknown[]);
      const m = new Map<string, { trusted: boolean; allowance: bigint }>();
      txCheckEntries.forEach((e, i) => {
        const trusted = res[i * 2] === true || res[i * 2] === "true";
        let allowance = 0n;
        try { allowance = safeBig(String(res[i * 2 + 1] ?? "0") || "0"); } catch { }
        m.set(`${e.token}:${e.dex}`, { trusted, allowance });
      });
      return m;
    }
  });
  const approveNeeded = (token: string, dex: string, amount: bigint | null): boolean | null => {
    const e = txAllowQ.data?.get(`${token}:${dex}`);
    if (!e) return null; // still checking — hint shows "approve if needed"
    if (e.trusted) return false;
    if (amount !== null && amount > 0n) return e.allowance < amount;
    return e.allowance <= 0n;
  };
  const txHint = (steps: string[]) => `${steps.length} transaction${steps.length === 1 ? "" : "s"}: ${steps.join(" → ")}`;

  // Depositing into an existing pool: typing one side fills the other at the
  // pool's reserve ratio. Drained pools (0 reserves) take free inputs again.
  function onDepAChange(v: string) {
    setDepAmtA(v);
    if (!v) { setDepAmtB(""); return; }
    if (existingPool && epPriced && createAssetA && createAssetB) {
      const p = parseUnits(v, createAssetA.decimals);
      if (p && p > 0n) setDepAmtB(weiToDecimalStr(p * epResB / epResA, createAssetB.decimals));
    }
  }
  function onDepBChange(v: string) {
    setDepAmtB(v);
    if (!v) { setDepAmtA(""); return; }
    if (existingPool && epPriced && createAssetA && createAssetB) {
      const p = parseUnits(v, createAssetB.decimals);
      if (p && p > 0n) setDepAmtA(weiToDecimalStr(p * epResA / epResB, createAssetA.decimals));
    }
  }

  // CEX-style hotkeys: B buy / S sell / 1-4 size presets / Esc back to markets.
  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.key === "Escape") { setDetail(false); return; }
      if (e.key === "b" || e.key === "B") { setTab("swap"); setTokenIn(NATIVE); return; }
      if (e.key === "s" || e.key === "S") { setTab("swap"); if (pairAsset) setTokenIn(pairAsset.address); return; }
      if (selectedInput?.address === NATIVE) {
        const presets = ["0.5", "1", "2.5", "5"];
        const i = ["1", "2", "3", "4"].indexOf(e.key);
        if (i >= 0) setAmount(presets[i]!);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detail, selectedInput?.address, pairAsset?.address]);
  const parsedAse = parseUnits(liqAmt0, liq0?.decimals ?? 18);
  const inputGate = useQuery({
    queryKey: ["asedex-gate", selectedInput?.address],
    enabled: Boolean(view === "terminal" && selectedInput && selectedInput.address !== NATIVE),
    queryFn: () => tokenDexGate(client, selectedInput!.address)
  });
  // Gate every non-native side of the liquidity modal's pool.
  const liquidityGate = useQuery({
    queryKey: ["asedex-gate", liq0?.address, liq1?.address],
    enabled: Boolean((liq0 && liq0.address !== NATIVE) || (liq1 && liq1.address !== NATIVE)),
    queryFn: async () => {
      const gates = await Promise.all([liq0, liq1].filter((a): a is Asset => Boolean(a && a.address !== NATIVE)).map((a) => tokenDexGate(client, a.address)));
      return { locked: gates.some((g) => g.locked), migrating: gates.some((g) => g.migrating), status: gates.find((g) => g.migrating)?.status ?? "" };
    }
  });
  // Gate on the selected terminal pair — drives the migration banner.
  const selectedPairGate = useQuery({
    queryKey: ["asedex-gate", selectedRow?.asset0?.address, selectedRow?.asset1?.address],
    enabled: Boolean(view === "terminal" && selectedAssets.some((a) => a.address !== NATIVE)),
    queryFn: async () => {
      const gates = await Promise.all(selectedAssets.filter((a) => a.address !== NATIVE).map((a) => tokenDexGate(client, a.address)));
      return { locked: gates.some((g) => g.locked), migrating: gates.some((g) => g.migrating) };
    }
  });
  const sellLocked = inputGate.data?.locked === true;
  const liquidityLocked = liquidityGate.data?.locked === true;
  const migratingToken = (inputGate.data?.migrating ? selectedInput?.address : undefined)
    ?? (selectedPairGate.data?.migrating ? selectedAssets.find((a) => a.address !== NATIVE)?.address : undefined);
  const parsedAsset = liq1 ? parseUnits(liqAmt1, liq1.decimals) : null;
  // Wallet balances for the LP inputs — blocks reverts from over-spending.
  const liqBalOf = (a?: Asset): bigint => {
    if (!a) return 0n;
    if (a.address === NATIVE) { try { return safeBig(aseBalance || "0"); } catch { return 0n; } }
    try { return safeBig(heldTokens.data?.find((t) => t.address.toLowerCase() === a.address.toLowerCase())?.balance || "0"); } catch { return 0n; }
  };
  const liqBal0 = liqBal0Q.data !== undefined
    ? (() => { try { return safeBig(liqBal0Q.data); } catch { return 0n; } })()
    : liqBalOf(liq0);
  const liqBal1 = liqBal1Q.data !== undefined
    ? (() => { try { return safeBig(liqBal1Q.data); } catch { return 0n; } })()
    : liqBalOf(liq1);

  // The amount typed for a tax-token sell IS the total spend (pool input is
  // poolInWei, net of tax) — so a plain balance check covers tax already.
  const inTaxWei = poolInWei && inTax.sell > 0n ? (poolInWei * inTax.sell) / (10000n - inTax.sell) : 0n;
  // Swap input balance: the dedicated read answers in one view call; the
  // wallet sweep result is the fallback while that read is in flight.
  const inBalWei = (() => {
    if (!selectedInput) return 0n;
    if (selectedInput.address === NATIVE) { try { return safeBig(aseBalance || "0"); } catch { return 0n; } }
    if (inputBalance.data !== undefined) { try { return safeBig(inputBalance.data); } catch { return 0n; } }
    return liqBalOf(selectedInput);
  })();
  const maxInWei = inBalWei;
  const inInsufficient = amountWei !== null && amountWei > inBalWei;
  const quoteNetWei = quoteOut && outTax.buy > 0n ? quoteOut - (quoteOut * outTax.buy) / 10000n : quoteOut;

  const liqOver0 = liqCostOf(liq0, parsedAse) !== null && liqCostOf(liq0, parsedAse)! > liqBal0;
  const liqOver1 = liqCostOf(liq1, parsedAsset) !== null && liqCostOf(liq1, parsedAsset)! > liqBal1;
  const liqInsufficient = liqOver0 || liqOver1;
  const displayedQuote = quoteNetWei && selectedOutput ? formatUnits(quoteNetWei, selectedOutput.decimals) : "-";

  useEffect(() => {
    if (selected && !selKey) setSelKey(poolKey(selected.dex, selected.id));
  }, [selected, selKey]);
  useEffect(() => { try { if (selKey) sessionStorage.setItem("asedex:last-pair", selKey); } catch { } }, [selKey]);
  // Tab title follows the selected pair.
  useEffect(() => {
    const base = "AseDex | Swap, Pools & Liquidity";
    document.title = selectedRow ? `${selectedRow.asset0.symbol}/${selectedRow.asset1.symbol} · AseDex` : base;
    return () => { document.title = base; };
    // pathname: Next re-applies route metadata on URL sync — restore ours after it.
  }, [selectedRow, pathname]);
  // Capture the landing URL once — legacy ?pool=/?pair=/?token= links still
  // resolve even after the address bar rewrites to the canonical path form.
  const landingUrl = useRef<string | null>(null);
  useEffect(() => { if (landingUrl.current === null) landingUrl.current = window.location.href; }, []);
  // URL → state: /asedex/radar | /asedex/terminal | /asedex/terminal/<poolId>[/<token>][/<token>]
  // | /asedex/pools | /asedex/wallets. Pair segments resolve against live pools
  // (pool id + token contracts or tickers, either order). Legacy query links still work.
  useEffect(() => {
    // The address bar is truth at effect time: a transition render fires while
    // window.location still shows the page we came FROM (e.g. a Link click on
    // /asepad/token/…), leaving render-time `segs`/`pathname` stale for one
    // commit. Parse the live URL here or we'd consume/normalize the wrong path.
    const livePath = window.location.pathname;
    // Our own navigation is still syncing into usePathname — the pathname here
    // is the stale pre-click one. Re-parsing it would re-select the old pair.
    if (selfNav.current) {
      if (livePath === selfNav.current.to || !selfNavFresh()) selfNav.current = null;
      else if (selfNav.current.from.has(livePath)) return;
    }
    const liveSegs = livePath.split("/").filter(Boolean).slice(0).map((s) => decodeURIComponent(s));
    const [section] = liveSegs;
    const sec = (section || "radar").toLowerCase();
    const asView: ViewName = sec === "wallets" ? "wallet" : (sec as ViewName);
    if (livePath !== viewAppliedFor.current) {
      viewAppliedFor.current = livePath;
      if (VIEWS.includes(asView)) setView(asView);
    }
    if (!allRows.length) return;
    let hit: PoolRow | undefined;
    if (asView === "terminal" && liveSegs[1] && poolAppliedFor.current !== livePath) {
      hit = poolFromSegs(liveSegs, allRows) ?? urlHit;
      // Only burn the consume flag once the segment resolves — or once every
      // venue list AND the dedicated URL-pool read have settled (a genuinely
      // missing pool). Consuming while AuraDex is still streaming made the
      // fallback steal the pair.
      // Don't burn the consume flag while the render is still the pre-nav one —
      // urlPoolTarget was built from stale segs, so urlPoolDone would pass
      // vacuously and the real URL-pool read could never land the pair.
      const urlPoolDone = !urlPoolTarget || urlPoolQ.isFetched;
      if (hit || (pathname === livePath && pools.isFetched && legacyPools.isFetched && urlPoolDone)) poolAppliedFor.current = livePath;
    }
    // Legacy ?pool=/?pair=/?token= params apply once — at the landing they
    // arrived with. Re-parsing them on every navigation re-selected the old
    // pair and flickered the terminal back to it.
    if (!hit && !legacyApplied.current) {
      legacyApplied.current = true;
      if (landingUrl.current?.includes("?")) {
        const params = new URL(landingUrl.current).searchParams;
        const q = params.get("pool");
        if (q) hit = q.includes(":") ? allRows.find((r) => poolKey(r.pool.dex, r.pool.id).toLowerCase() === q.toLowerCase()) : allRows.find((r) => r.pool.id === q);
        const pair = params.get("pair");
        if (!hit && pair) {
          const [a, b] = pair.split(/[\/\-_]/).map((s) => s.trim().toLowerCase());
          if (a) hit = allRows.find((r) => matchesPair(r, a, b));
        }
        const tok = params.get("token")?.toLowerCase();
        if (!hit && tok) {
          const tokHits = allRows.filter((r) => matchSide(r, tok, 0) || matchSide(r, tok, 1));
          hit = tokHits.find((r) => r.asset0.address === NATIVE || r.asset1.address === NATIVE) ?? tokHits[0];
        }
      }
    }
    if (hit) { setView("terminal"); setSelKey(poolKey(hit.pool.dex, hit.pool.id)); }
  }, [segs, pathname, allRows, urlHit, urlPoolQ.isFetched, urlPoolTarget, pools.isFetched, legacyPools.isFetched]);
  // State → URL: the current view/selection owns the address bar.
  // Canonical pair link: /asedex/terminal/<dexSlug>/<poolId> — venue+id
  // pins the pool for every pair type (token-address links still resolve).
  const pathFor = (v: ViewName, row?: PoolRow) => {
    if (v === "terminal" && row) return `/terminal/${dexSlug(row.pool.dex)}/${row.pool.id}`;
    return `/${v}`; // wallet is singular now; /wallets still resolves and canonicalizes
  };
  const canonicalPath = useMemo(() => pathFor(view, selectedRow), [view, selectedRow]);
  // A URL this page writes already matches its state — mark it consumed BEFORE
  // writing, so the URL→state effect doesn't re-resolve our own navigation.
  // Without this, Next's pathname sync (one render after pushState) looked
  // like an unresolved deep link: the selected pair was hidden for a render
  // (terminal blip), the canonical path fell back to /asedex/terminal and was
  // written (URL blip), then rewritten back to the pair link.
  function writeUrl(path: string, mode: "push" | "replace") {
    viewAppliedFor.current = path;
    poolAppliedFor.current = path;
    if (window.location.pathname === path && !window.location.search) return;
    // `from` = the paths usePathname may still report while our writes sync
    // (the current one, plus earlier targets of rapid back-to-back clicks).
    // Bounded to the last few — an unbounded set would poison later ROUTER
    // navs: the URL→state effect ignores any path in `from`, so a Link click
    // back to a page visited earlier this session got treated as a stale
    // self-nav and the canonicalizer rewrote the URL over the user's click.
    if (pathname !== path) {
      const from = new Set(selfNav.current ? [...selfNav.current.from, selfNav.current.to].slice(-8) : []);
      from.add(pathname);
      from.delete(path);
      selfNav.current = { from, to: path, at: Date.now() };
    }
    if (mode === "push") window.history.pushState(null, "", path);
    else window.history.replaceState(null, "", path);
  }
  // Click-driven navigation: switch the view AND the URL in one step via the
  // History API — no router.push, no RSC round-trip, no "page refreshes twice".
  function gotoView(v: ViewName, row?: PoolRow) {
    setView(v);
    try { writeUrl(pathFor(v, row ?? (v === "terminal" ? selectedRow : undefined)), "push"); } catch { }
  }
  // Rail / mobile-nav AseDex links hand their view over here instead of doing
  // a router nav (see lib/asedex-nav.ts) — same one-step switch the old pill
  // used. gotoView reads fresh state through a ref so the listener stays put.
  const gotoViewRef = useRef(gotoView);
  gotoViewRef.current = gotoView;
  useEffect(() => {
    const onGoto = (e: Event) => {
      const v = String((e as CustomEvent<string>).detail || "");
      if (VIEWS.includes(v)) gotoViewRef.current(v as ViewName);
    };
    window.addEventListener(ASEDEX_GOTO_EVENT, onGoto);
    return () => window.removeEventListener(ASEDEX_GOTO_EVENT, onGoto);
  }, []);
  const navSettled = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.pathname === canonicalPath && !url.search) { navSettled.current = true; return; }
    // A transition render fires while the address bar still shows the page we
    // came FROM (Link click on another route): render-time `segs`/`pathname`
    // are stale for that commit. Parse the live URL — otherwise an "asepad"
    // seg looks invalid and we'd replaceState /asedex/radar over a valid
    // terminal deep link before the pool could resolve.
    const liveSegs = url.pathname.split("/").filter(Boolean).slice(0).map((s) => decodeURIComponent(s));
    if (selfNavFresh() && selfNav.current?.from.has(url.pathname)) return;
    const sec = (liveSegs[0] || "").toLowerCase();
    const validSeg = liveSegs.length > 0 && ["markets", "radar", "terminal", "pools", "wallets", "wallet"].includes(sec);
    const normalize = !validSeg || Boolean(url.search);
    if (normalize) { navSettled.current = true; writeUrl(canonicalPath, "replace"); return; }
    // Mid-navigation commit: the URL already shows the target view but `view`
    // is still the pre-click one — `canonicalPath` is stale for this render.
    // Writing it now would replaceState the OLD view's path over the fresh
    // URL (the "Markets click lands on Radar" bounce). Wait one commit for
    // the URL→state effect to setView, then this effect re-canonicalizes.
    const urlView = sec === "wallets" || sec === "wallet" ? "wallet" : (sec as ViewName);
    if (urlView !== view) return;
    // Valid-looking deep link — wait until the URL→state effect has consumed it
    // (pool resolution needs the pools query) before rewriting anything.
    const needsPool = sec === "terminal" && Boolean(liveSegs[1]);
    const consumed = viewAppliedFor.current === url.pathname && (!needsPool || (poolAppliedFor.current === url.pathname && Boolean(selKey)));
    if (!navSettled.current && !consumed) return;
    // While a pair link is still resolving, never collapse it to bare
    // /asedex/terminal — that's the URL blip. Wait for the pair to land.
    if (needsPool && view === "terminal" && !selectedRow) return;
    navSettled.current = true;
    writeUrl(canonicalPath, "replace");
  }, [canonicalPath, pathname, segs, rows.length, selKey]);
  useEffect(() => {
    // Default to the quote asset as input — that's the BUY direction (spend
    // quote → receive base). Landing on the base token would default to sell.
    if (selectedAssets.length && !selectedAssets.some((asset) => asset.address === tokenIn)) setTokenIn(pairQuote?.address ?? selectedAssets[0]!.address);
  }, [selected?.id, selectedAssets, tokenIn, pairQuote?.address]);

  // Persistent on-chain swap history — powers the chart, trades feed and 24h stats.
  type SwapRec = { trader: string; tokenIn: string; amountIn: string; amountOut: string; price: number; ts: number; volumeAseWei: string };
  const swapHistory = useQuery({
    queryKey: ["asedex-swaps", selected?.dex, selected?.id],
    // Chart, trades feed and 24h stats are Terminal-only reads.
    enabled: Boolean(view === "terminal" && selected),
    refetchInterval: 3_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      // The Auras indexer covers BOTH venues — one HTTP call instead of a
      // chain read. AseDex pools index as "asedex-<id>"; legacy are bare ids.
      // Indexer price is quote-per-base: pools whose token0 is native ASE
      // need it inverted to stay in quote-per-pairAsset terms.
      // AWS trades/positions key pools "<dex>:<id>" for every venue — AseDex
      // v2, AuraDex v1 and v2 all take the same dex-qualified form.
      const idxPool = `${selected!.dex}:${selected!.id}`;
      const inv = selected!.token0 === NATIVE;
      // AWS trades table first (ops shard watches all three dexes). tokenIn is
      // derived from side + the pool's native leg — no chain read. Price often
      // lands null — downstream re-derives px from the real legs, so keep rows.
      // Page backwards until the pool's first trade — full candle history,
      // not the last-256 window. Cursor = oldest block in the page.
      const pages: NonNullable<Awaited<ReturnType<typeof apiTrades>>>["trades"] = [];
      {
        let before = 0;
        for (;;) {
          const page = await apiTrades({ pool: idxPool, limit: 1000, ...(before ? { before } : {}) }).catch(() => null);
          const rowsIn = page?.trades ?? [];
          pages.push(...rowsIn);
          if (rowsIn.length < 1000) break;
          const oldest = Math.min(...rowsIn.map((r) => Number(r.block || 0)).filter((b) => b > 0));
          if (!Number.isFinite(oldest) || oldest <= 0) break;
          before = oldest;
        }
      }
      const d2 = pages.length ? { trades: pages } : null;
      if (d2 || isLegacyDex(selected!.dex)) {
        const t0 = selected!.token0.toLowerCase(), t1 = selected!.token1.toLowerCase();
        const awsSwaps = (d2?.trades ?? []).map((t): SwapRec => {
          const sell = String(t.side || "").toLowerCase() === "sell";
          const tokLeg = String(t.token || "").toLowerCase() !== NATIVE && String(t.token || "").length > 2
            ? String(t.token).toLowerCase() : (t0 === NATIVE ? t1 : t0);
          const other = tokLeg === t0 ? t1 : t0;
          return {
            trader: String(t.trader || ""),
            tokenIn: sell ? tokLeg : other,
            amountIn: String(t.amount_in || "0"),
            amountOut: String(t.amount_out || "0"),
            price: (() => { const p = Number(t.price || 0); return inv && p > 0 ? 1 / p : p; })(),
            ts: toSec(Number(t.ts || 0)),
            volumeAseWei: String(t.ase_wei || "0")
          };
        }).reverse();
        // Legacy pools' swap history lives on the auras indexer — merge its
        // trades under the AWS ones (dedupe by tx) so v1/v2 terminals keep
        // a full tape while our ops shard backfills. LEGACY DEXES ONLY: bare
        // pool ids collide across venues (v1 pool 47 ≠ asedex pool 47), so a
        // main-dex merge would splice a different pool's tape — wrong prices,
        // wrong times, wrong traders — into this terminal.
        const aurId = String(selected!.dex).toLowerCase() === AURADEX_V2 ? `auras2-${selected!.id}` : selected!.id;
        const ext = isLegacyDex(selected!.dex)
          ? await fetch(`https://auras.asentum.com/api/trades?pool=${aurId}&limit=256`, { cache: "no-store", signal: AbortSignal.timeout(8000) })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null) as { trades?: (AuraTrade & { txHash?: string; block?: number })[] } | null
          : null;
        if (ext?.trades?.length) {
          const seen = new Set(awsSwaps.map((s) => `${s.trader}:${s.ts}:${s.amountIn}`));
          for (const t of ext.trades) {
            const rec: SwapRec = {
              trader: String(t.trader || ""),
              tokenIn: String(t.tokenIn || ""),
              amountIn: String(t.amountIn || "0"),
              amountOut: String(t.amountOut || "0"),
              price: (() => { const p = Number(t.price || 0); return inv && p > 0 ? 1 / p : p; })(),
              ts: toSec(Date.parse(String(t.ts || "")) || 0),
              volumeAseWei: safeBig(Math.round(Number(t.sizeQuote || 0) * 1e18)).toString()
            };
            if (rec.price <= 0 || seen.has(`${rec.trader}:${rec.ts}:${rec.amountIn}`)) continue;
            seen.add(`${rec.trader}:${rec.ts}:${rec.amountIn}`);
            awsSwaps.push(rec);
          }
          awsSwaps.sort((a, b) => b.ts - a.ts);
        }
        return awsSwaps;
      }
      // Auras-indexer-shaped feed — same endpoint, different row keys. Only
      // reachable when apiTrades itself errored; kept as the shape fallback.
      const d = await auraApi<{ trades?: AuraTrade[] }>(`/api/trades?pool=${idxPool}&limit=256`);
      if (d) {
        return (d.trades ?? []).map((t): SwapRec => ({
          trader: String(t.trader || ""),
          tokenIn: String(t.tokenIn || ""),
          amountIn: String(t.amountIn || "0"),
          amountOut: String(t.amountOut || "0"),
          price: (() => { const p = Number(t.price || 0); return inv && p > 0 ? 1 / p : p; })(),
          ts: toSec(Date.parse(String(t.ts || "")) || 0),
          volumeAseWei: safeBig(Math.round(Number(t.sizeQuote || 0) * 1e18)).toString()
        })).filter((s) => s.price > 0).reverse();
      }
      // No chain fallback — a dark feed keeps the last snapshot, it never
      // triggers a recentSwaps read.
      throw new Error("trades index unavailable");
    }
  });
  const swaps = useMemo(() => {
    // Re-derive every swap's price from its actual legs — the indexer's price
    // field is quote-per-base only on its own convention, and inverts on some
    // leg orders (the "$29,349" bug). quoteAmt/baseAmt is convention-proof and
    // feeds the trades table AND swap-bucketed candles uniformly.
    const base = (pairAssetFull ?? pairAsset)?.address.toLowerCase();
    const quote = (pairQuoteFull ?? pairQuote)?.address.toLowerCase();
    const bDec = pairAssetFull?.decimals ?? 18, qDec = pairQuoteFull?.decimals ?? 18;
    return (swapHistory.data ?? []).map((s) => {
      if (!base || !quote) return s;
      const buy = s.tokenIn.toLowerCase() === quote;
      const baseWei = safeBig(buy ? s.amountOut : s.amountIn);
      const quoteWei = safeBig(buy ? s.amountIn : s.amountOut);
      const bu = Number(baseWei) / 10 ** bDec, qu = Number(quoteWei) / 10 ** qDec;
      let px = bu > 0 ? qu / bu : s.price;
      // Spot guard: a real fill tracks the pool ratio — mis-scaled sources
      // (stale indexer price, wrong leg order, decimal drift) deviate by
      // orders of magnitude and poison every USD cell they touch.
      if (pairPriceQuote > 0 && px > 0 && (px / pairPriceQuote > 8 || px / pairPriceQuote < 0.125)) px = pairPriceQuote;
      return px === s.price ? s : { ...s, price: px };
    });
  }, [swapHistory.data, pairAsset, pairAssetFull, pairQuote, pairQuoteFull, pairPriceQuote]);

  // Holder count for the tab badge — one wallet-lane call, visible before the
  // tab ever opens. The full sweep still gates on this same read when opened.
  const holderCount = useQuery({
    queryKey: ["asedex-holder-count", pairAsset?.address],
    enabled: Boolean(view === "terminal" && pairAsset && pairAsset.address !== NATIVE),
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async () => Number(safeBig(String(await client.view(pairAsset!.address, "holderCount", [], { wallet: true }).catch(() => "0") || "0")))
  });
  // Token holders — pad tokens enumerate holders on-chain (holderCount/holderAt);
  // other tokens fall back to balance-checking addresses seen trading this pair.
  // Lazy: zero calls until the Holders tab is opened, holderAt indexes are
  // immutable (cached forever), and one holderCount read gates each sweep.
  // Lane: a cold open (user clicked the tab) rides the ui lane — the sweep is
  // exactly what the user is waiting on. Cached refreshes stay bulk so a
  // background re-sweep can't steal interactive slots.
  const holders = useQuery({
    queryKey: ["asedex-holders", pairAsset?.address],
    enabled: Boolean(view === "terminal" && pairAsset && centerTab === "holders"),
    refetchInterval: 60000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const token = pairAsset!.address;
      const k = token.toLowerCase();
      // Warm fast-path — the pad token page sweeps into a shared lib cache;
      // reusing it here makes a back-and-forth visit instant (zero RPC).
      const warm = asepadPeekHolders(token);
      if (warm && warm.holders.length) {
        // lib rows already carry dev/bonding-curve/asedex tags — keep them.
        const out: { rows: { address: string; balance: bigint; tag?: string }[]; supply: bigint; count: number; creator?: string } = { rows: warm.holders.map((x) => ({ address: x.address, balance: safeBig(x.balance), tag: x.tag })), supply: safeBig(warm.supply), count: warm.count };
        dexHolderSweep.set(k, { at: Date.now(), count: warm.count, out });
        return out;
      }
      const sweep = dexHolderSweep.get(k);
      const lane = sweep ? { bulk: true } : undefined;
      // Explorer indexer path — it tracks every Transfer and serves the
      // real holder list in one HTTP read. Zero RPC, instant; the chain
      // enumeration below stays as fallback for tokens the explorer misses.
      try {
        const apiBase = UNIFIED_API || "";
        if (apiBase) {
          const res = await fetch(`${apiBase}/api/holders/${token}`, { signal: AbortSignal.timeout(8000) });
          if (res.ok) {
            const j = await res.json() as { token?: { decimals?: number }; rows?: { holder: string; balance: string; pct?: string }[] };
            const apiRows = (j.rows ?? []).map((r) => {
              const a = /^ase1/.test(r.holder) ? toHexAddress(r.holder) : r.holder.toLowerCase();
              return { address: a, balance: safeBig(r.balance), tag: undefined as string | undefined };
            }).filter((h) => /^0x[0-9a-f]{40}$/.test(h.address) && h.balance > 0n);
            if (apiRows.length) {
              // Supply derives from the API's own pct — a queued RPC read
              // behind a slow node must not stall the whole tab again.
              let supply = 0n;
              for (let i = 0; i < (j.rows ?? []).length; i++) {
                const p = Number(j.rows![i].pct);
                if (p > 0) { supply = (apiRows[i].balance * 10000n) / BigInt(Math.round(p * 100)); break; }
              }
              const out = { rows: apiRows, supply, count: apiRows.length, creator: "" };
              dexHolderSweep.set(k, { at: Date.now(), count: apiRows.length, out });
              return out;
            }
          }
        }
      } catch { /* fall through to chain sweep */ }
      // API answered but carried no rows — holder indexing is still catching
      // up for this token (or it genuinely has <10 holders). Display shows
      // what the indexer has; no chain enumeration on a browsing page.
      const out: { rows: { address: string; balance: bigint; tag?: string }[]; supply: bigint; count: number; creator?: string } =
        { rows: [], supply: pairAsset?.totalSupply ? safeBig(pairAsset.totalSupply) : 0n, count: 0 };
      dexHolderSweep.set(k, { at: Date.now(), count: 0, out });
      return out;
    }
  });
  const holderRows = holders.data?.rows ?? [];
  // @name service — one batch resolve for every address visible on the
  // terminal (holders, traders, order owners); shared cache via useNames.
  const addrNames = useNames([
    ...holderRows.map((h) => h.address),
    ...swaps.map((s) => s.trader),
    ...(myOrders.data ?? []).map((o) => o.owner),
    ownerHex,
  ]);
  const holderNames = addrNames;

  // Burned LP shares — served by AWS /api/burns (positions parked at the
  // zero/dead address). The old sharesOf(ZERO) probe is gone: browsing pages
  // never issue chain reads.
  const [burnOpen, setBurnOpen] = useState(false);
  const [burnModal, setBurnModal] = useState<{ pct: number; shares?: string; tx?: string; x: number; y: number } | null>(null);
  burnModalSetter = setBurnModal;
  // Burn tx link — pad pools burn all LP in the migration tx (LPShareBurned
  // fires there at migratedTs). Non-pad pools keep the badge unlinked.
  const lpBurnTx = useQuery({
    queryKey: ["asedex-lp-burn-tx", selected?.dex, selected?.id, pairAsset?.address],
    // Seed from BOTH burn-tx caches — the token page resolves the same
    // LPShareBurned event under ["asepad-burn-tx", token]; reuse its link
    // instead of re-scanning blocks. padBurnTxCache is the asedex-side mirror.
    enabled: Boolean(view === "terminal" && selected && pairAsset?.address
      && !padBurnTxCache.get(pairAsset!.address)
      && !queryClient.getQueryData<string>(["asepad-burn-tx", pairAsset!.address])),
    initialData: () => padBurnTxCache.get(pairAsset?.address || "")
      || queryClient.getQueryData<string>(["asepad-burn-tx", pairAsset?.address || ""])
      || undefined,
    // finite — an early "" (launch record missing migratedTs) must retry or the
    // flame stays stuck on the pad-page fallback forever.
    staleTime: 120_000,
    queryFn: async () => {
      // AWS event index first — one HTTP call covers BOTH burn shapes:
      // manual SharesTransferred→zero/dead (poolId match) and pad migration
      // LPShareBurned (token match). Chain scans below are the fallback.
      // AWS event index — covers manual SharesTransferred→zero/dead, pad
      // LPShareBurned events, AND launches.migration_pool rows for migrations
      // that predate event indexing. A "" answer is terminal; the flame falls
      // back to the token's pad page, no chain scan.
      const burn = await fetch(`${UNIFIED_API}/api/burn/${selected!.dex}/${selected!.id}?token=${pairAsset!.address}`)
        .then((r) => r.json()).then((d) => String(d?.tx || "")).catch(() => "");
      if (burn) { padBurnTxCache.set(pairAsset!.address, burn); queryClient.setQueryData(["asepad-burn-tx", pairAsset!.address], burn); }
      return burn;
    }
  });
  // Burn proof link — the migration tx when findable, else the token's pad
  // page (its migration panel shows the burned-LP record). Mirrors LpBurnTag.
  const lpBurnHref = lpBurnTx.data ? explorerTxUrl(lpBurnTx.data) : undefined;
  // Burned share % for every pool — drives the flame tag in Radar/Markets/Pools.
  const lpBurns = useQuery({
    // Static key — embedding the pool-id list minted a new query (and a new
    // persisted copy) on every streamed row, ~100 stale variants in storage.
    // Refreshes ride the dex-event invalidation + the slow interval instead.
    queryKey: ["asedex-lp-burns"],
    // Flame tags live on Radar/Pools rows only.
    enabled: allRows.length > 0 && view !== "wallet",
    staleTime: 60_000,
    refetchInterval: 300_000,
    queryFn: async () => {
      const out: Record<string, string> = { ...(queryClient.getQueryData<Record<string, string>>(["asedex-lp-burns"]) ?? {}) };
      // AWS-authoritative — /api/burns serves every pool's zero/dead-address
      // share total from the positions table (SharesTransferred deltas).
      const d = await fetch(`${UNIFIED_API}/api/burns`).then((r) => r.json()).catch(() => null);
      for (const [k, v] of Object.entries(d?.burns ?? {}))
        out[k] = JSON.stringify({ s: String(v), t: String(d?.supply?.[k] ?? "0") });
      for (const [k, v] of Object.entries(d?.tx ?? {})) if (v) burnTxByPool.set(k, String(v));
      for (const k of Object.keys(d?.pad ?? {})) burnPadPools.add(k);
      return out;
    }
  });
  // Burned-share wei per pool ("" when none measured). Pad migration burns
  // skip the zero address — fall back to the pool's whole share supply.
  const burnParsed = (row: PoolRow) => {
    const raw = lpBurns.data?.[poolKey(row.pool.dex, row.pool.id)];
    if (!raw) return { s: 0n, t: 0n };
    try { const j = JSON.parse(raw) as { s: string; t: string }; return { s: safeBig(j.s), t: safeBig(j.t) }; }
    catch { return { s: safeBig(raw), t: 0n }; }
  };
  // Pad burn only counts on the launch's OWN migration pool — a migrated
  // token's AuraDex/community pools keep their own (unburned) LP.
  const isPadBurnPool = (row: PoolRow) => {
    const padLeg = [row.asset0, row.asset1].find((a) => a.fromPad);
    if (!padLeg || !(row.pool.token0 === NATIVE || row.pool.token1 === NATIVE)) return false;
    const l = asepadPeekLaunchRecord(padLeg.address);
    return Boolean(l?.lpBurned && row.pool.dex === PRIMARY_DEX
      && String(l.aseDexPoolId || "") === String(row.pool.id));
  };
  const burnSharesOf = (row: PoolRow) => {
    const { s } = burnParsed(row);
    if (s > 0n) return s.toString();
    return isPadBurnPool(row) ? (row.pool.totalShares || "") : "";
  };
  const burnPctOf = (row: PoolRow) => {
    const { s, t } = burnParsed(row);
    const total = t > 0n ? t : safeBig(row.pool.totalShares || "0");
    if (s > 0n && total > 0n) return Number(s * 10000n / total) / 100;
    // Pad migrations burn the pool's LP shares — the launch record already
    // knows it, so the flame lights instantly instead of waiting for the
    // shares sweep (and covers burns the zero-address read can't see).
    return isPadBurnPool(row) ? 100 : 0;
  };
  // Burn-proof txs for row flames — pad migrations emit LPShareBurned at
  // migratedTs, so each migrated pad token resolves once (binary search),
  // then every pool row carrying that token links to the burn tx. Rows stream
  // in progressively, so the key carries the token set and resolved hashes
  // accumulate in padBurnTxCache across key changes.
  const padBurnTargets = useMemo(() => {
    // token → pool coords for every row with a measured burn. Pad legs key on
    // the token (one token = one burn tx); manual dex burns key on the pool
    // itself ("dex:id") — SharesTransferred→zero matches by poolId.
    const m = new Map<string, { dex: string; id: string; token?: string }>();
    for (const row of allRows) {
      if (isPadBurnPool(row)) {
        const padLeg = [row.asset0, row.asset1].find((a) => a.fromPad)!;
        if (!m.has(padLeg.address.toLowerCase())) m.set(padLeg.address.toLowerCase(), { dex: row.pool.dex, id: row.pool.id, token: padLeg.address.toLowerCase() });
        continue;
      }
      if (burnParsed(row).s > 0n)
        m.set(poolKey(row.pool.dex, row.pool.id), { dex: row.pool.dex, id: row.pool.id });
    }
    return m;
  }, [allRows, lpBurns.data]);
  const padBurnTokens = useMemo(() => [...padBurnTargets.keys()].sort(), [padBurnTargets]);
  const burnTxs = useQuery({
    queryKey: ["asedex-burn-txs", padBurnTokens.join(",")],
    enabled: padBurnTokens.length > 0 && view !== "wallet" && Boolean(PAD),
    staleTime: 120_000,
    queryFn: async () => {
      const out: Record<string, string> = Object.fromEntries(padBurnTxCache);
      // Resolved hashes cache forever; a "" answer retries after a cooldown —
      // the indexer can outrun the event, but rows streaming in used to
      // refetch every unresolved pool on EVERY key change (a burn-endpoint
      // request storm: 27 calls for the same pool in one pageview).
      // Bulk seed first — /api/burns already carried every known burn tx,
      // keyed by pool. Pad targets key on token, manual targets on poolKey;
      // both resolve through the target's own dex:id.
      for (const tk of padBurnTokens) {
        if (padBurnTxCache.get(tk)) continue;
        const tgt = padBurnTargets.get(tk);
        const seeded = tgt ? burnTxByPool.get(`${tgt.dex.toLowerCase()}:${tgt.id}`) : undefined;
        if (seeded) { padBurnTxCache.set(tk, seeded); out[tk] = seeded; }
        // AWS says this is a pad pool with no recorded tx → terminal miss;
        // the pad-page fallback link is the proof, no per-pool probing.
        else if (tgt && burnPadPools.has(`${tgt.dex.toLowerCase()}:${tgt.id}`)) { padBurnTxCache.set(tk, ""); padBurnTxTried.set(tk, Infinity); }
      }
      const now = Date.now();
      await Promise.all(padBurnTokens.filter((tk) => !padBurnTxCache.get(tk) && (padBurnTxTried.get(tk) ?? 0) < now).map(async (tk) => {
        // AWS event index — one bound query per token. The endpoint resolves
        // pad burns from LPShareBurned events AND the launches.migration_pool
        // row (covers migrations that predate event indexing), so a miss here
        // means genuinely unknown — the row falls back to the token's pad
        // page link instead of a chain scan.
        const tgt = padBurnTargets.get(tk);
        const tx = tgt
          ? await fetch(`${UNIFIED_API}/api/burn/${tgt.dex}/${tgt.id}${tgt.token ? `?token=${tgt.token}` : ""}`)
              .then((r) => r.json()).then((d) => String(d?.tx || "")).catch(() => "")
          : "";
        padBurnTxTried.set(tk, Date.now() + 60_000);
        padBurnTxCache.set(tk, tx);
        if (tx) out[tk] = tx;
      }));
      return out;
    }
  });
  const burnTxOf = (row: PoolRow) => {
    if (isPadBurnPool(row)) {
      const padLeg = [row.asset0, row.asset1].find((a) => a.fromPad)!;
      return burnTxs.data?.[padLeg.address.toLowerCase()];
    }
    return burnTxs.data?.[poolKey(row.pool.dex, row.pool.id)];
  };
  // When the burn tx is pruned from node history, the launch page is the
  // fallback proof — its migration panel shows the burned LP + pool id.
  const padBurnUrlOf = (row: PoolRow) => {
    const padLeg = [row.asset0, row.asset1].find((a) => a.fromPad);
    return padLeg && (row.pool.token0 === NATIVE || row.pool.token1 === NATIVE)
      ? `/asepad/token/${toAseAddress(padLeg.address)}` : undefined;
  };

  // Pad launch record says the burn happened even when the index hasn't seen
  // the share moves — same fallback the row flames use, so the terminal badge
  // lights + links identically to the token page.
  const padBurned = Boolean(
    pairAssetFull?.fromPad && pairQuote?.address === NATIVE
    && asepadPeekLaunchRecord(pairAssetFull.address)?.lpBurned
  );
  // Terminal burn figures — AWS burns map (zero/dead positions); pad
  // migrations burn every LP share, so supply is the fallback total.
  const awsBurnWei = (() => {
    const raw = selected ? lpBurns.data?.[poolKey(selected.dex, selected.id)] : undefined;
    if (!raw) return "";
    try { const j = JSON.parse(raw) as { s: string }; return safeBig(j.s) > 0n ? j.s : ""; }
    catch { return safeBig(raw) > 0n ? raw : ""; }
  })();
  const lpBurnShares = awsBurnWei || (padBurned ? selected?.totalShares || "" : "");
  const lpBurnPct = useMemo(() => {
    const total = safeBig(selected?.totalShares || "0");
    const burned = safeBig(lpBurnShares || "0");
    return total > 0n && burned > 0n ? Number(burned * 10000n / total) / 100 : 0;
  }, [lpBurnShares, selected]);
  const lpBurnPctFinal = lpBurnPct > 0 ? lpBurnPct : padBurned ? 100 : 0;

  // Chart: token price in ASE — candles bucketed by the selected timeframe.
  const [chartRange, setChartRange] = useState<"15m" | "1h" | "4h" | "1d" | "1w">("15m");
  // OHLC legend row above the candles — LwCandles mutates its [data-o]…[data-d]
  // spans on crosshair moves (no React re-render, same trick as AsePadFutures).
  const chartLegendRef = useRef<HTMLDivElement | null>(null);
  const RANGE_SEC: Record<string, number> = { "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400, "1w": 604800 };
  // Indexer OHLC candles — the Auras indexer covers AuraDex AND AseDex now
  // ("asedex-<id>" pool ids), giving real history instead of the thin
  // recent-trades window. AseDex keeps the swap-bucketing path as fallback.
  const auraCandles = useQuery({
    queryKey: ["auras-candles", selected?.dex, selected?.id, chartRange],
    // AWS /api/candles buckets the trades table server-side — real OHLC for
    // every venue; swap-derived candles stay as the empty-set fallback.
    enabled: Boolean(view === "terminal" && selected),
    refetchInterval: 3_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      // AWS trades/positions key pools "<dex>:<id>" for every venue — AseDex
      // v2, AuraDex v1 and v2 all take the same dex-qualified form.
      const idxPool = `${selected!.dex}:${selected!.id}`;
      // Auras indexer pool-id forms: legacy v1 bare, auras v2 "auras2-<id>",
      // asedex "asedex-<id>". Its candles merge in — AWS wins each bucket.
      const aurId = isLegacyDex(selected!.dex)
        ? (String(selected!.dex).toLowerCase() === AURADEX_V2 ? `auras2-${selected!.id}` : selected!.id)
        : `asedex-${selected!.id}`;
      const [dAws, dAur] = await Promise.all([
        auraApi<{ candles?: { time: number; open: number; high: number; low: number; close: number; volume: number }[] }>(
          `/api/candles?pool=${idxPool}&interval=${RANGE_SEC[chartRange]}`),
        fetch(`https://auras.asentum.com/api/candles?pool=${aurId}&interval=${RANGE_SEC[chartRange]}`, { cache: "no-store" })
          .then((r) => r.ok ? r.json() : null).catch(() => null)
      ]);
      let d = dAws;
      if (dAur?.candles?.length) {
        const seen = new Set((d?.candles ?? []).map((c) => Number(c.time)));
        const extra = (dAur.candles as { time: number; open: number; high: number; low: number; close: number; volume: number }[]).filter((c) => !seen.has(Number(c.time)));
        if (extra.length) d = { candles: [...(d?.candles ?? []), ...extra].sort((a, b) => Number(a.time) - Number(b.time)) };
      }
      if (!d) throw new Error("candles index unavailable");
      // Feed is quote-per-base already — no blind inversion. The candles
      // useMemo sanity-checks the close against the last real swap price and
      // flips OHLC only when the feed genuinely arrives inverted; pre-flipping
      // here painted BET-per-ASE (~8.7k × USD scale ≈ $30k axis on pool 47)
      // until the swap tape loaded.
      return (d.candles ?? []).slice(-240).map((c) => ({ t: Number(c.time), o: c.open, h: c.high, l: c.low, c: c.close, v: Number(c.volume || 0) }));
    }
  });
  const candles = useMemo(() => {
    const bucket = RANGE_SEC[chartRange];
    const asTicks = (d: { t: number; o: number; h: number; l: number; c: number; v: number }[]) =>
      normalizeCandles(d.map((c) => ({ time: c.t, open: c.o, high: c.h, low: c.l, close: c.c, volume: c.v })), bucket, { fill: false })
        .map((c) => ({ t: c.time, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume ?? 0 }));
    if (auraCandles.data?.length) {
      const d = auraCandles.data;
      // Sanity-check the indexer's leg convention against the last leg-derived
      // swap price: if the candle close is closer to 1/ref than to ref, the
      // feed came inverted — flip OHLC (high/low swap under inversion).
      // swaps arrive newest-first — [0] is the latest fill, the right ref.
      const ref = swaps[0]?.price ?? 0;
      const last = d.at(-1)!.c;
      if (ref > 0 && last > 0) {
        const keepErr = Math.abs(last / ref - 1);
        const flipErr = Math.abs(last * ref - 1);
        if (flipErr < 0.5 && keepErr > 2) {
          return asTicks(d.map((c) => ({ t: c.t, o: 1 / c.o, h: 1 / c.l, l: 1 / c.h, c: 1 / c.c, v: c.v })));
        }
      }
      return asTicks(d);
    }
    if (selLegacy) return [];
    // Don't paint partial swap-bucketed candles while the server candle
    // feed is still in flight — page-1 trades would flash a bogus chart
    // that the real OHLC then replaces. Hold the loading state instead.
    if (!auraCandles.isFetched && !auraCandles.isError) return [];
    if (!swaps.length) return [];
    // Fallback: bucket real swap ticks — every swap's bucket gets a candle,
    // normalizeCandles chains opens + fills the gaps between them.
    const sparse = new Map<number, { t: number; o: number; h: number; l: number; c: number; v: number }>();
    for (const s of swaps) {
      if (!(s.price > 0)) continue;
      const t = Math.floor(s.ts / bucket) * bucket;
      const v = Number(safeBig(s.volumeAseWei || "0")) / 1e18;
      const c = sparse.get(t);
      if (!c) sparse.set(t, { t, o: s.price, h: s.price, l: s.price, c: s.price, v });
      else { c.h = Math.max(c.h, s.price); c.l = Math.min(c.l, s.price); c.c = s.price; c.v += v; }
    }
    return asTicks([...sparse.values()]);
  }, [swaps, chartRange, selLegacy, auraCandles.data]);
  // Daily stats — UTC day window (resets 00:00 UTC). Change is measured
  // against the last price before the day opened (or today's first print).
  const dayStats = useMemo(() => {
    // Indexer keeps true rolling-24h stats for both venues — the trades window
    // (256 records) undercounts busy pairs, so prefer it whenever the pair is
    // indexed. Quote-leg volume rides volQuoteWei for token↔token pools.
    const p = selected ? auraPairs.data?.[poolKey(selected.dex, selected.id)] : undefined;
    if (p) {
      const isAseLeg = selected!.token0 === NATIVE || selected!.token1 === NATIVE;
      const vol24 = Number(p.volume24) || 0;
      return {
        volWei: isAseLeg ? safeBig(Math.round(vol24 * 1e18)).toString() : "0",
        volQuoteWei: isAseLeg ? "0" : safeBig(Math.round(vol24 * 10 ** (pairQuote?.decimals ?? 18))).toString(),
        change: (Number(p.change24) || 0) * 100,
        tradeCount: Number(p.trades24) || 0
      };
    }
    const dayStart = Math.floor(Date.now() / 86400000) * 86400;
    const today = swaps.filter((s) => s.ts >= dayStart);
    const vol = today.reduce((sum, s) => sum + safeBig(s.volumeAseWei || "0"), 0n);
    // Token↔token pools record volumeAseWei=0 on-chain — their real volume is
    // the quote-token leg. Sum it so the stat shows quote-denominated volume
    // instead of pretending the day was flat.
    const quoteAddr = pairQuote && pairQuote.address !== NATIVE ? pairQuote.address.toLowerCase() : "";
    const volQ = quoteAddr
      ? today.reduce((sum, s) => sum + safeBig(s.tokenIn.toLowerCase() === quoteAddr ? s.amountIn : s.amountOut), 0n)
      : 0n;
    const base = swaps.filter((s) => s.ts < dayStart).at(-1)?.price ?? today[0]?.price ?? 0;
    const last = swaps.at(-1)?.price ?? 0;
    const change = base > 0 && last > 0 ? ((last - base) / base) * 100 : 0;
    return { volWei: vol.toString(), volQuoteWei: volQ.toString(), change, tradeCount: today.length };
  }, [swaps, selected, auraPairs.data, pairQuote?.address]);
  // Direction of the most recent swap on the selected pair — buys pay the
  // quote asset in (native ASE for ASE pools, the quote token otherwise).
  const lastSwapBuy = swaps.length && pairQuote ? swaps.at(-1)!.tokenIn.toLowerCase() === pairQuote.address.toLowerCase() : null;
  const lastSwapTs = swaps.at(-1)?.ts ?? 0;


  // ── paired liquidity inputs: typing one side fills the other at pool ratio ──
  // Driven by the liquidity modal's pool (Pools view), not the terminal pair.
  const reserve0 = lpRow ? safeBig(lpRow.pool.reserve0) : 0n;
  const reserve1 = lpRow ? safeBig(lpRow.pool.reserve1) : 0n;
  // Only REAL reserves may drive the paired fill — indexer rows carry
  // TVL-split placeholders built without token decimals, which would fill a
  // wildly wrong counter-amount. Synthetic rows hydrate via the effect below
  // and refill once real reserves land.
  const poolPriced = reserve0 > 0n && reserve1 > 0n && lpRow?.pool.tvlQuote == null;
  function onLiq0Change(value: string) {
    setLiqAmt0(value);
    if (!value) { setLiqAmt1(""); return; }
    const parsed = parseUnits(value, liq0?.decimals ?? 18);
    if (poolPriced && parsed && parsed > 0n) {
      setLiqAmt1(weiToDecimalStr(parsed * reserve1 / reserve0, liq1?.decimals ?? 18));
    }
  }
  function onLiq1Change(value: string) {
    setLiqAmt1(value);
    if (!value) { setLiqAmt0(""); return; }
    const parsed = parseUnits(value, liq1?.decimals ?? 18);
    if (poolPriced && parsed && parsed > 0n) {
      setLiqAmt0(weiToDecimalStr(parsed * reserve0 / reserve1, liq0?.decimals ?? 18));
    }
  }
  // A synthetic LP row hydrates asynchronously — when real reserves arrive,
  // refill the counter-amount from what the user already typed so the pairing
  // appears without a retype.
  const lpHydratedKey = useRef("");
  useEffect(() => {
    if (!lpRow) { lpHydratedKey.current = ""; return; }
    if (lpRow.pool.tvlQuote != null) return;
    const k = poolKey(lpRow.pool.dex, lpRow.pool.id);
    if (lpHydratedKey.current === k) return;
    lpHydratedKey.current = k;
    if (liqAmt0) onLiq0Change(liqAmt0);
    else if (liqAmt1) onLiq1Change(liqAmt1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lpRow]);

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["asedex-pools"] }),
      queryClient.invalidateQueries({ queryKey: ["asedex-shares"] }),
      queryClient.invalidateQueries({ queryKey: ["asedex-swaps"] }),
      queryClient.invalidateQueries({ queryKey: ["asedex-tx-allow"] }),
      queryClient.invalidateQueries({ queryKey: ["auras-candles"] }),
      walletAse.refresh()
    ]);
  }

  async function finalizeMigration(token: string) {
    begin("global");
    if (!PAD) { setError("AsePad contract is not configured"); return; }
    if (wallet.status !== "connected") { wallet.openConnect?.(); return; }
    try {
      setBusy("Finalizing migration…");
      const hash = await sendWalletCall({ to: PAD, method: "advanceMigration", args: [token] });
      await requireWalletTxMined(hash, "advance migration", 180000);
      setNotice("Migration step confirmed. If it is still migrating, click Finalize again, each stage needs its own confirmation.");
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["asedex-gate"] }),
        refresh()
      ]);
    } catch (e) { setError(e instanceof Error ? e.message : "Migration advance failed"); }
    finally { setBusy(null); }
  }

  // Approve only when needed; AsePad tokens that trust this DEX skip it (1 signature).
  // Returns the approve tx hash when a signature went out — callers that fire
  // two approvals (LP deposits) can wait on both receipts in parallel.
  // trustedSpender + allowance for every non-native leg in ONE JSON-RPC
  // batch — these run inside the signing path where each sequential round
  // trip is user-visible latency on a slow node.
  async function allowanceShortfalls(entries: { token: string; dex: string; amount: bigint }[]): Promise<Set<string>> {
    const nonNative = entries.filter((e) => e.token !== NATIVE);
    if (!nonNative.length || !ownerHex) return new Set();
    const res = await viewContractBatch<unknown>(nonNative.flatMap((e) => ([
      { to: e.token, method: "trustedSpender", args: [e.dex] },
      { to: e.token, method: "allowance", args: [ownerHex, e.dex] }
    ])), { wallet: true, urgent: true }).catch(() => [] as unknown[]);
    const short = new Set<string>();
    nonNative.forEach((e, i) => {
      const trusted = res[i * 2];
      if (trusted === true || trusted === "true") return;
      if (res[i * 2 + 1] !== undefined && safeBig(String(res[i * 2 + 1] || "0")) >= e.amount) return;
      short.add(e.token.toLowerCase());
    });
    return short;
  }
  async function approveDexAllowance(tokenAddr: string, dex: string, amount: bigint, label: string): Promise<string | null> {
    if (tokenAddr === NATIVE) return null;
    if (!(await allowanceShortfalls([{ token: tokenAddr, dex, amount }])).size) return null;
    setBusy("Confirm the approval in your wallet…");
    const hash = await sendWalletCall({ to: tokenAddr, method: "approve", args: [dex, amount.toString()] });
    setBusy(label);
    return hash;
  }
  async function ensureDexAllowance(tokenAddr: string, dex: string, amount: bigint, label: string) {
    const hash = await approveDexAllowance(tokenAddr, dex, amount, label);
    if (!hash) return;
    // Race the receipt against the allowance itself — the receipts endpoint
    // lags/502s under load, but a covering allowance read proves the approve
    // mined and unblocks the flow sooner.
    let stop = false;
    const allowanceWon = (async () => {
      const deadline = Date.now() + 90_000;
      while (!stop && Date.now() < deadline) {
        const al = ownerHex ? await client.view(tokenAddr, "allowance", [ownerHex, dex], { wallet: true }).catch(() => "0") : "0";
        if (safeBig(String(al || "0")) >= amount) return true;
        await new Promise((r) => setTimeout(r, 1200));
      }
      return false;
    })();
    try {
      await Promise.race([
        requireWalletTxMined(hash, "token approval", 180000),
        allowanceWon.then((ok) => (ok ? true : new Promise<never>(() => { })))
      ]);
    } finally { stop = true; }
  }

  async function swap() {
    begin("trade");
    if (wallet.status !== "connected" || !wallet.address) { wallet.openConnect?.(); return; }
    if (!selected || !selectedInput || !selectedOutput || !amountWei || amountWei <= 0n) { setError("Choose a pool and enter a valid amount"); return; }
    if (sellLocked) { setError("This token's AseDex trading is locked while its AsePad migration finishes. Finalize the migration below, then sell here, or sell on the bonding curve meanwhile."); return; }
    if (amountWei > inBalWei) { setError(`Insufficient ${selectedInput.symbol}`); return; }
    try {
      setBusy("Preparing swap…");
      const tolerance = slipBps(slippage);
      // Fresh quote + allowance check in ONE JSON-RPC POST — the display
      // quote is debounced (could be a keystroke behind → stale minOut →
      // revert) and the approval check needs trustedSpender+allowance; all
      // three are independent reads, so batching saves a full round trip.
      // urgent: the click skips a background-limiter cooldown on first try.
      const inputNative = selectedInput.address === NATIVE;
      const pre = await viewContractBatch<unknown>([
        { to: selected.dex, method: "quote", args: [selected.id, selectedInput.address, poolInWei!.toString()] },
        ...(!inputNative && ownerHex ? [
          { to: selectedInput.address, method: "trustedSpender", args: [selected.dex] },
          { to: selectedInput.address, method: "allowance", args: [ownerHex, selected.dex] }
        ] : [])
      ], { wallet: true, urgent: true }).catch(() => [] as unknown[]);
      const quoteOut = safeBig(String(pre[0] ?? "0") || "0");
      if (quoteOut <= 0n) { setError("No swap quote available"); return; }
      const minOut = quoteOut * (10000n - tolerance) / 10000n;
      const trusted = pre[1] === true || pre[1] === "true";
      const covered = pre[2] !== undefined && safeBig(String(pre[2] || "0")) >= poolInWei!;
      if (!inputNative && ownerHex && !trusted && !covered) {
        setBusy("Confirm the approval in your wallet…");
        const ah = await sendWalletCall({ to: selectedInput.address, method: "approve", args: [selected.dex, poolInWei!.toString()] });
        setBusy("Approving…");
        await requireWalletTxMined(ah, "token approval", 180000);
      }
      setBusy("Swapping…");
      const hash = await sendWalletCall({ to: selected.dex, method: "swapExactIn", args: [selected.id, selectedInput.address, poolInWei!.toString(), minOut.toString()], ...(selectedInput.address === NATIVE ? { valueWei: amountWei.toString() } : {}) });
      await requireWalletTxMined(hash, "AseDex swap", 180000);
      // Journal into the per-user log — the trade becomes instant wallet
      // history and both legs join the token-discovery hints.
      if (ownerHex) {
        userLogNoteTrade(ownerHex, { poolId: poolKey(selected.dex, selected.id), side: selectedInput.address === pairAsset?.address ? "sell" : "buy", tokenIn: selectedInput.address.toLowerCase(), tokenOut: selectedOutput.address.toLowerCase(), amountIn: amountWei.toString(), amountOut: quoteOut.toString(), txHash: hash, ts: Date.now() });
      }
      setNotice(`Swap confirmed · ${hash.slice(0, 12)}…`);
      setAmount("");
      // Fire-and-forget — invalidateQueries resolves after the full pool
      // resweep, which would pin the busy state for tens of seconds.
      void refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Swap failed"); }
    finally { setBusy(null); }
  }

  // Radar instant buy — spends `buySize` ASE straight into the pair, no
  // terminal detour. Mirrors swap(): on-chain quote → slippage minOut →
  // swapExactIn with native value → journal + refresh. token↔token pools
  // have no ASE leg to spend, so those keep the prefill-the-terminal path.
  async function quickBuy(row: PoolRow) {
    const pk = poolKey(row.pool.dex, row.pool.id);
    const base = row.asset0.address === NATIVE ? row.asset1 : row.asset0;
    const quoteA = row.asset0.address === base.address ? row.asset1 : row.asset0;
    // token↔token rows never reach here — the button renders disabled —
    // guard anyway since there's no ASE leg and no hop-swap yet.
    if (quoteA.address !== NATIVE) return;
    if (wallet.status !== "connected" || !wallet.address) { wallet.openConnect?.(); return; }
    // The note renders directly under the row's buy button — per-row scope.
    noteScope.current = `radar:${pk}`;
    const amtWei = parseUnits(buySize, 18);
    if (!amtWei || amtWei <= 0n) { setError("Pick a buy size"); return; }
    setQuickBuyKey(pk);
    setError(null);
    try {
      // Gate + quote in parallel — sequencing the two pre-sign reads doubled
      // the wait before the wallet prompt.
      const [gate, quoteRaw] = await Promise.all([
        tokenDexGate(client, base.address),
        client.view(row.pool.dex, "quote", [row.pool.id, NATIVE, amtWei.toString()], { wallet: true, urgent: true }).catch(() => "0")
      ]);
      if (gate.locked) throw new Error(`${base.symbol} trading is locked while its AsePad migration finishes`);
      const quoteOut = safeBig(String(quoteRaw || "0"));
      if (quoteOut <= 0n) throw new Error("No swap quote for this pool");
      const minOut = (quoteOut * (10000n - slipBps(slippage))) / 10000n;
      const hash = await sendWalletCall({ to: row.pool.dex, method: "swapExactIn", args: [row.pool.id, NATIVE, amtWei.toString(), minOut.toString()], valueWei: amtWei.toString() });
      await requireWalletTxMined(hash, "AseDex swap", 180000);
      if (ownerHex) {
        userLogNoteTrade(ownerHex, { poolId: pk, side: "buy", tokenIn: NATIVE.toLowerCase(), tokenOut: base.address.toLowerCase(), amountIn: amtWei.toString(), amountOut: quoteOut.toString(), txHash: hash, ts: Date.now() });
      }
      setNotice(`Bought ${base.symbol} with ${buySize} ASE · ${hash.slice(0, 12)}…`);
      setQuickBuyDone({ key: pk, symbol: base.symbol });
      setTimeout(() => setQuickBuyDone((d) => (d?.key === pk ? null : d)), 5000);
      void refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Buy failed"); }
    finally { setQuickBuyKey(null); }
  }

  // Shared deposit path for create-pool seeding, add-to-existing, and the LP
  // modal: approves both sides, computes optimal amounts at the pool ratio,
  // and sends addLiquidity with any native value attached.
  async function depositToPool(dex: string, pool: Pool, asset0: Asset, max0: bigint, asset1: Asset, max1: bigint) {
    // Always re-read the pool right before signing — a stale or synthetic row
    // (indexer rows carry totalShares "0") mints a garbage minShares and the
    // add reverts on 'minimum LP shares not met'. If the read fails, refuse to
    // send rather than burn the user's gas on a guaranteed revert. The getPool
    // and both tokens' trustedSpender+allowance reads batch into one JSON-RPC
    // POST instead of five sequential gated round trips.
    const calls: { to: string; method: string; args: string[] }[] = [];
    const poolId = String(pool.id).replace(/^asedex-/, "");
    calls.push({ to: dex, method: "getPool", args: [poolId] });
    const legs = [asset0, asset1].filter((a) => a.address !== NATIVE);
    for (const a of legs) {
      calls.push({ to: a.address, method: "trustedSpender", args: [dex] });
      if (ownerHex) {
        calls.push({ to: a.address, method: "allowance", args: [ownerHex, dex] });
        calls.push({ to: a.address, method: "balanceOf", args: [ownerHex] });
      }
    }
    // Tax rates resolve in parallel — the pool receives `used` but a tax token
    // debits used + used*sell/(10000-sell) from the wallet ('insufficient
    // balance for amount+tax' revert). Registry-first, so usually instant.
    const taxP = Promise.all(legs.map((a) => tokenTaxOf(client, a.address, true).catch(() => ({ buy: 0n, sell: 0n, bad: true } as TaxInfo))));
    // Migration lock re-check at the signing layer — the token's own
    // aseDexLocked flag blocks approvals to EVERY dex (AseDex and AURAS
    // alike), so a path that skips the button gate fails clean here instead
    // of sending an approve that reverts 'token LP locked until migration'.
    const gateP = Promise.all(legs.map((a) => tokenDexGate(client, a.address).then((g) => ({ a, g }))));
    const res = await viewContractBatch<unknown>(calls, { wallet: true, urgent: true }).catch(() => [] as unknown[]);
    const taxes = await taxP;
    for (const { a, g } of await gateP) {
      if (g.locked) throw new Error(`${a.symbol} is locked to the DEX until its AsePad migration finishes — pool liquidity unlocks once migration completes.`);
    }
    let cursor = 0;
    let real: Pool | null = null;
    try {
      const parsed = JSON.parse(String(res[cursor] ?? "null")) as Pool | null;
      if (parsed?.id && parsed.token0 && parsed.token1) real = sanPool(parsed);
    } catch { /* handled below */ }
    cursor++;
    if (!real) throw new Error("Pool data unavailable — the node is catching up. Retry in a few seconds.");
    pool = { ...real, dex };
    // Callers pass legs in form order — normalize to the pool's token0/token1
    // here (the fresh read is the only trustworthy order). Saves every caller
    // a getPool round trip they only needed for leg ordering.
    if (String(pool.token0 || "").toLowerCase() !== asset0.address.toLowerCase()) {
      const tA = asset0; asset0 = asset1; asset1 = tA;
      const tM = max0; max0 = max1; max1 = tM;
    }
    // A tax token debits the pull's grossed-up sell tax on top of the amount —
    // max-balance deposits revert ('insufficient balance for amount+tax').
    // Same rule as swap sells: treat the balance as the total spend and cap
    // the leg at the spendable amount instead of reverting on-chain.
    let dep0 = max0, dep1 = max1;
    const depOf = (a: Asset) => (a.address === asset0.address ? dep0 : dep1);
    const setDep = (a: Asset, v: bigint) => { if (a.address === asset0.address) dep0 = v; else dep1 = v; };
    if (ownerHex) legs.forEach((a, i) => {
      const bal = safeBig(String(res[1 + i * 3 + 2] ?? "0") || "0");
      const sell = taxes[i] && !taxes[i]!.bad ? taxes[i]!.sell : 0n;
      const max = depOf(a);
      const spendable = sell > 0n ? (bal * (10000n - sell)) / 10000n : bal;
      if (max <= spendable) return;
      if (sell > 0n && spendable > 0n) setDep(a, spendable);
      else throw new Error(`Insufficient ${a.symbol} balance`);
    });
    const r0 = safeBig(pool.reserve0 || "0"), r1 = safeBig(pool.reserve1 || "0"), total = safeBig(pool.totalShares || "0");
    let used0 = dep0, used1 = dep1, minShares = 0n;
    if (total > 0n && r0 > 0n && r1 > 0n) {
      const optimal1 = dep0 * r1 / r0;
      if (optimal1 <= dep1) used1 = optimal1;
      else used0 = dep1 * r0 / r1;
      const by0 = used0 * total / r0, by1 = used1 * total / r1;
      minShares = (by0 < by1 ? by0 : by1) * (10000n - slipBps(slippage)) / 10000n;
    } else {
      minShares = sqrt(dep0 * dep1) * (10000n - slipBps(slippage)) / 10000n;
    }
    const short = new Set<string>();
    legs.forEach((a, i) => {
      // Consume every slot each iteration — a trusted first leg must not
      // shift the second leg's reads onto the wrong results.
      const trusted = res[cursor++];
      const allowance = ownerHex ? res[cursor++] : undefined;
      if (ownerHex) cursor++; // balanceOf slot — consumed in the guard above
      if (trusted === true || trusted === "true") return;
      if (allowance !== undefined && safeBig(String(allowance || "0")) >= depOf(a)) return;
      short.add(a.address.toLowerCase());
    });
    // Sequential signatures (the wallet handles one at a time), but the two
    // receipts wait in parallel — a token+token deposit skips a full
    // mined-wait round trip.
    const sendApprove = async (a: Asset, amount: bigint, label: string) => {
      setBusy("Confirm the approval in your wallet…");
      const hash = await sendWalletCall({ to: a.address, method: "approve", args: [dex, amount.toString()] });
      setBusy(label);
      return hash;
    };
    // Approval confirmation must not depend on the receipts endpoint alone —
    // it lags (and 502s) far more often than eth_call, which left approved
    // users staring at "Approving…" until the timeout ("approve went to the
    // wallet then gone"). An allowance read that already covers the amount IS
    // the approval having landed, so race the receipt against that poll.
    const waitApproval = async (a: Asset, amount: bigint, hash: string) => {
      if (!ownerHex) { await requireWalletTxMined(hash, "token approval", 180000); return; }
      let stop = false;
      const allowanceWon = (async () => {
        const deadline = Date.now() + 90_000;
        while (!stop && Date.now() < deadline) {
          const al = await client.view(a.address, "allowance", [ownerHex, dex], { wallet: true }).catch(() => "0");
          if (safeBig(String(al || "0")) >= amount) return true;
          await new Promise((r) => setTimeout(r, 700));
        }
        return false;
      })();
      try {
        await Promise.race([
          requireWalletTxMined(hash, "token approval", 180000),
          allowanceWon.then((ok) => (ok ? true : new Promise<never>(() => { })))
        ]);
      } finally { stop = true; }
    };
    const approve0 = asset0.address !== NATIVE && short.has(asset0.address.toLowerCase()) ? await sendApprove(asset0, dep0, `Approving ${asset0.symbol}…`) : null;
    const approve1 = asset1.address !== NATIVE && short.has(asset1.address.toLowerCase()) ? await sendApprove(asset1, dep1, `Approving ${asset1.symbol}…`) : null;
    await Promise.all([
      approve0 ? waitApproval(asset0, dep0, approve0) : null,
      approve1 ? waitApproval(asset1, dep1, approve1) : null
    ]);
    // Send the user's MAX native leg, not our predicted `used` — the contract
    // computes its own optimal on fresh reserves and _takeValue refunds the
    // surplus. Sending the prediction reverts with 'insufficient native value
    // sent' whenever reserves drift between our read and the mined block.
    const nativeValue = asset0.address === NATIVE ? dep0 : asset1.address === NATIVE ? dep1 : 0n;
    // AuraDex's addLiquidity predates minShares — it takes (poolId, a0, a1).
    const addArgs = isLegacyDex(dex) ? [poolId, dep0.toString(), dep1.toString()] : [poolId, dep0.toString(), dep1.toString(), minShares.toString()];
    setBusy("Confirm the deposit in your wallet…");
    const hash = await sendWalletCall({ to: dex, method: "addLiquidity", args: addArgs, valueWei: nativeValue.toString() });
    setBusy("Depositing liquidity…");
    await requireWalletTxMined(hash, "add liquidity", 180000);
  }

  // After an LP tx mines, patch THIS pool + the wallet's shares instantly from
  // the chain — one batched POST, no waiting on the 45s positions sweep or the
  // indexer. Without this, "My pools" and the modal's share count lag behind a
  // confirmed add/remove.
  async function patchLpPosition(dex: string, rawPoolId: string, expectedShares?: string) {
    const poolId = String(rawPoolId).replace(/^asedex-/i, "");
    const k = poolKey(dex, poolId);
    const calls: { to: string; method: string; args: string[] }[] = [{ to: dex, method: "getPool", args: [poolId] }];
    if (ownerHex) {
      calls.push({ to: dex, method: "sharesOf", args: [poolId, ownerHex] });
      calls.push({ to: dex, method: "lpPendingRewards", args: [poolId, ownerHex] });
    }
    const res = await viewContractBatch<unknown>(calls, { wallet: true }).catch(() => [] as unknown[]);
    try {
      const real = JSON.parse(String(res[0] ?? "null")) as Pool | null;
      if (real) sanPool(real);
      if (real?.id) {
        const pool = { ...real, dex } as Pool;
        const apply = (rows?: PoolRow[]) => rows?.map((r) => poolKey(r.pool.dex, r.pool.id) === k ? { ...r, pool } : r);
        const row = allRows.find((r) => poolKey(r.pool.dex, r.pool.id) === k);
        if (row) livePoolRows.set(k, { row: { ...row, pool }, at: Date.now() });
        if (row) hydratedRows.set(k, { pool, asset0: row.asset0, asset1: row.asset1 });
        queryClient.setQueryData<PoolRow[]>(isLegacyDex(dex) ? ["asedex-legacy-pools", LEGACY_DEXES.join(",")] : ["asedex-pools"], apply);
        setLpRow((cur) => cur && poolKey(cur.pool.dex, cur.pool.id) === k ? { ...cur, pool } : cur);
      }
    } catch { /* patch is best-effort — the sweep catches up */ }
    if (ownerHex) {
      // A caller that just mined a share-changing tx knows the post-state —
      // the read node can lag the block and return the pre-tx count.
      const shares = expectedShares ?? String(res[1] ?? "0");
      const rewards = res[2] !== undefined ? String(res[2]) : undefined;
      queryClient.setQueryData<ShareEntry[]>(["asedex-shares", ownerHex], (entries) =>
        entries?.map((e) => e.key === k ? { ...e, shares, ...(rewards !== undefined ? { rewards } : {}) } : e));
      queryClient.setQueryData(["asedex-lp-share", dex, poolId, ownerHex], shares);
      if (rewards !== undefined) {
        try { queryClient.setQueryData(["asedex-lp-rewards", dex, poolId, ownerHex], JSON.parse(rewards)); } catch { /* keep */ }
      }
    }
  }

  async function createPool() {
    begin("create");
    if (wallet.status !== "connected") { wallet.openConnect?.(); return; }
    const token = createTokenAAddr;
    const tokenB = createTokenBAddr;
    if (!/^0x[0-9a-f]{40}$/.test(token) || token === NATIVE) { setError("Enter a valid ARC-20 address (ase1… or 0x…) for token A"); return; }
    if (!/^0x[0-9a-f]{40}$/.test(tokenB)) { setError("Token B must be a valid ARC-20 address or left empty for ASE"); return; }
    if (token === tokenB) { setError("Token A and token B must differ"); return; }
    if (createLocked) { setError("This token is locked to AsePad. Its pool opens through the official migration."); return; }
    if (depOneSided) { setError("Enter both deposit amounts: liquidity needs both sides"); return; }
    const wantsDeposit = depActive && Boolean(createAssetA) && Boolean(createAssetB);
    if (depOverA) { setError(`Insufficient ${createAssetA?.symbol} balance`); return; }
    if (depOverB) { setError(`Insufficient ${createAssetB?.symbol} balance`); return; }
    try {
      setBusy("Checking pair…");
      // existingPoolQ already answered this from AWS while the user typed —
      // reuse it. Only when the query hasn't resolved yet (data undefined)
      // do one urgent poolForPair read.
      let existing = "";
      let ep: Pool | null = null;
      if (existingPoolQ.data !== undefined) {
        ep = existingPool;
        existing = existingPool ? String(existingPool.id) : "";
      } else {
        existing = String(await client.view(createDex, "poolForPair", [token, tokenB], { wallet: true, urgent: true }) || "");
      }
      if (existing) {
        const row = allRows.find((r) => poolKey(r.pool.dex, r.pool.id) === poolKey(createDex, existing));
        // With deposit amounts entered, add liquidity straight into the
        // existing pool instead of stopping at the "already exists" wall.
        // depositToPool orders legs internally off its own fresh getPool.
        if (wantsDeposit) {
          setBusy("Adding liquidity…");
          await depositToPool(createDex, ep ?? ({ id: existing, dex: createDex } as Pool), createAssetA!, depAWei!, createAssetB!, depBWei!);
          await patchLpPosition(createDex, existing);
          setNotice(`Liquidity added to the existing ${createAssetA!.symbol}/${createAssetB!.symbol} pool.`);
          setDepAmtA(""); setDepAmtB("");
          if (row) openLpModal(row);
          void refresh();
          return;
        }
        if (row) { openLpModal(row); setNotice("Pool already exists. Manage its liquidity here."); return; }
        // Navigate first, then scope the note to the terminal card — a
        // "create"-scoped note can't render once the swap view is up.
        setSelKey(poolKey(createDex, existing)); setTab("swap"); setDetail(true);
        noteScope.current = "trade"; setNotice("Pool already exists; selected it."); return;
      }
      setBusy("Confirm pool creation in your wallet…");
      const createHash = await sendWalletCall({ to: createDex, method: "createPool", args: [token, tokenB, createFee] });
      setBusy("Creating pool…");
      const createReceipt = await requireWalletTxMined(createHash, "create pool", 180000);
      // The receipt already carries the new pool id — PoolCreated event data
      // or returnValue. Take it from there instead of polling poolForPair
      // while the read node catches up (up to 16s of dead time).
      const rAny = createReceipt as unknown as { returnValue?: string; events?: { name?: string; data?: { poolId?: string | number } }[] };
      let id = String(
        rAny?.events?.find((e) => e?.name === "PoolCreated")?.data?.poolId
        ?? rAny?.returnValue ?? ""
      );
      if (!id) {
        for (let i = 0; i < 20 && !id; i++) {
          id = String(await client.view(createDex, "poolForPair", [token, tokenB]).catch(() => "") || "");
          if (!id) await new Promise((r) => setTimeout(r, 800));
        }
      }
      if (!id) throw new Error("Pool created but its id hasn't propagated yet — refresh in a moment.");
      let successMsg: string;
      if (wantsDeposit) {
        // depositToPool orders the legs off its own fresh getPool — no extra
        // round trip needed here just for token0/token1 mapping.
        setBusy("Depositing liquidity…");
        await depositToPool(createDex, { id, dex: createDex } as Pool, createAssetA!, depAWei!, createAssetB!, depBWei!);
        await patchLpPosition(createDex, id);
        successMsg = `${createAssetA!.symbol}/${createAssetB!.symbol} pool created on ${dexName(createDex)} and liquidity deposited. Trading is live.`;
        setDepAmtA(""); setDepAmtB("");
      } else {
        successMsg = `Pool created on ${dexName(createDex)}. Add the first liquidity to activate trading.`;
      }
      const freshRow = allRows.find((r) => poolKey(r.pool.dex, r.pool.id) === poolKey(createDex, id));
      if (freshRow) openLpModal(freshRow);
      setSelKey(poolKey(createDex, id)); setTokenAddress(""); setTokenBAddress(""); setTab("swap"); setDetail(true);
      // After openLpModal (which clears notes) and the view switch — the note
      // renders in the LP modal if it opened, else the terminal card.
      noteScope.current = freshRow ? "lp" : "trade"; setNotice(successMsg);
      void refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Pool creation failed"); }
    finally { setBusy(null); }
  }

  function openLpModal(row: PoolRow) {
    setLpRow(row);
    setLpMode(safeBig(shareByPool.get(poolKey(row.pool.dex, row.pool.id)) || "0") > 0n ? "remove" : "add");
    setLiqAmt0(""); setLiqAmt1(""); setLiquidityPercent("100");
    begin("lp");
  }

  async function addLiquidity() {
    begin("lp");
    if (wallet.status !== "connected") { wallet.openConnect?.(); return; }
    if (!lpRow || !liq0 || !liq1 || !parsedAse || parsedAse <= 0n || !parsedAsset || parsedAsset <= 0n) { setError("Enter positive amounts for both sides of the pool"); return; }
    if (liquidityLocked) { setError("This token's AseDex transfers are locked until its AsePad migration finishes."); return; }
    if (liqOver0) { setError(`Insufficient ${liq0.symbol} balance. You have ${formatUnits(liqBal0, liq0.decimals)}`); return; }
    if (liqOver1) { setError(`Insufficient ${liq1.symbol} balance. You have ${formatUnits(liqBal1, liq1.decimals)}`); return; }
    // Inputs already follow pool order (token0/token1).
    const max0 = parsedAse;
    const max1 = parsedAsset;
    const pool = lpRow.pool;
    try {
      setBusy("Adding LP…");
      await depositToPool(pool.dex, pool, liq0, max0, liq1, max1);
      // Fire-and-forget — the batched patch lands in the caches behind the
      // success note instead of gating it on another round trip.
      void patchLpPosition(pool.dex, String(pool.id));
      // Keep the modal open: the success note renders inside it. Closing here
      // unmounts the note and the confirmation becomes invisible.
      setNotice(`Liquidity added to ${dexName(pool.dex)}.`);
      setLiqAmt0(""); setLiqAmt1("");
      void refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Add liquidity failed"); }
    finally { setBusy(null); }
  }

  async function removeLiquidity() {
    begin("lp");
    if (wallet.status !== "connected") { wallet.openConnect?.(); return; }
    if (!lpRow || lpShares <= 0n) { setError("No AseDex position for this pool"); return; }
    let pool = lpRow.pool;
    try {
      setBusy("Preparing removal…");
      // Re-read before signing ONLY when the row can't be trusted — a
      // synthetic indexer row carries totalShares "0" (zero mins = no
      // slippage protection). A modal showing real shares already has a
      // hydrated pool; slippage tolerance covers drift, and skipping the
      // blocking read puts the wallet prompt up instantly.
      const rmPoolId = String(pool.id).replace(/^asedex-/, "");
      const synthetic = safeBig(pool.totalShares || "0") <= 0n;
      if (synthetic) {
        const real = JSON.parse(String(await client.view(pool.dex, "getPool", [rmPoolId], { wallet: true, urgent: true }).catch(() => "null") || "null")) as Pool | null;
        if (real) sanPool(real);
        if (!real?.id) throw new Error("Pool data unavailable — the node is catching up. Retry in a few seconds.");
        pool = { ...real, dex: pool.dex };
      }
      const burn = lpShares * safeBig(liquidityPercent) / 100n;
      const total = safeBig(pool.totalShares || "0");
      const expected0 = total > 0n ? burn * safeBig(pool.reserve0) / total : 0n;
      const expected1 = total > 0n ? burn * safeBig(pool.reserve1) / total : 0n;
      const tolerance = slipBps(slippage);
      const min0 = expected0 * (10000n - tolerance) / 10000n;
      const min1 = expected1 * (10000n - tolerance) / 10000n;
      setBusy("Removing LP…");
      // AuraDex's removeLiquidity predates min0/min1 — it takes (poolId, shares).
      const rmArgs = isLegacyDex(pool.dex) ? [rmPoolId, burn.toString()] : [rmPoolId, burn.toString(), min0.toString(), min1.toString()];
      await requireWalletTxMined(await sendWalletCall({ to: pool.dex, method: "removeLiquidity", args: rmArgs }), "remove liquidity", 180000);
      // Instant position print: the tx is mined, so shares = old - burn is
      // known state — write it now. The read node can lag the block and
      // would otherwise echo the pre-remove count for ~15s, which looked
      // like a failed removal and invited duplicate transactions.
      const remaining = lpShares - burn > 0n ? lpShares - burn : 0n;
      if (ownerHex) {
        const k = poolKey(pool.dex, rmPoolId);
        queryClient.setQueryData(["asedex-lp-share", pool.dex, rmPoolId, ownerHex], remaining.toString());
        queryClient.setQueryData<ShareEntry[]>(["asedex-shares", ownerHex], (entries) =>
          entries?.map((e) => e.key === k ? { ...e, shares: remaining.toString() } : e));
      }
      // Fire-and-forget — patches the pool row + rewards behind the note;
      // expectedShares stops a lagging sharesOf read from clobbering the 0.
      void patchLpPosition(pool.dex, rmPoolId, remaining.toString());
      // Modal stays open — the success note renders inside it, and the
      // position is already 0 / reduced on screen.
      setNotice("Liquidity removed."); void refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Remove liquidity failed"); }
    finally { setBusy(null); }
  }

  async function claimLpRewards() {
    begin("lp");
    if (!lpRow) { setError("Select a pool first"); return; }
    if (wallet.status !== "connected") { wallet.openConnect?.(); return; }
    try {
      setBusy("Claiming LP rewards…");
      await requireWalletTxMined(await sendWalletCall({ to: lpRow.pool.dex, method: "claimLpRewards", args: [lpRow.pool.id] }), "claim LP rewards", 120000);
      setNotice("LP rewards claimed."); void refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Claim rewards failed"); }
    finally { setBusy(null); }
  }

  // ── limit + DCA orders (v2 venues) ────────────────────────────────────────
  // Limit price is entered as the token's price (ASE or USD per token) — the
  // book's canonical unit. Converted here to the directional out/in rate the
  // contract's minOut needs. Token/token pools (no ASE leg) take a raw rate.
  const limitRate = (() => {
    const p = Number(limitPrice);
    if (!Number.isFinite(p) || p <= 0 || !selectedInput) return null;
    if (pairPriceAse <= 0 || !pairAsset) return p;
    const pAse = limitUnit === "USD" ? (aseUsd > 0 ? p / aseUsd : 0) : p;
    if (!Number.isFinite(pAse) || pAse <= 0) return null;
    return selectedInput.address === pairAsset.address ? pAse : 1 / pAse;
  })();
  // minOut for a limit order = amountIn × rate, in output-token units.
  const limitMinOut = (() => {
    try {
      if (!selectedInput || !selectedOutput || !poolInWei || limitRate === null) return null;
      const priceWei = parseUnits(limitRate.toFixed(18), 18);
      if (!priceWei || priceWei <= 0n) return null;
      return (poolInWei * priceWei * 10n ** safeBig(selectedOutput.decimals)) / (10n ** 18n * 10n ** safeBig(selectedInput.decimals));
    } catch { return null; }
  })();


  async function placeLimitOrder() {
    begin("limit");
    if (wallet.status !== "connected") { wallet.openConnect?.(); return; }
    if (!selected || !selectedInput || !selectedOutput || !amountWei || amountWei <= 0n || !limitMinOut) { setError("Enter an amount and a limit price"); return; }
    if (!ordersEnabled) { setError("Select a pool first"); return; }
    if (sellLocked) { setError("This token is locked until its AsePad migration finishes"); return; }
    if (amountWei > inBalWei) { setError(`Insufficient ${selectedInput.symbol}`); return; }
    try {
      setBusy("Preparing order…");
      await ensureDexAllowance(selectedInput.address, selected.dex, poolInWei!, "Approving…");
      setBusy("Placing limit order…");
      const hash = await sendWalletCall({ to: selected.dex, method: "createLimitOrder", args: [selected.id, selectedInput.address, poolInWei!.toString(), limitMinOut.toString()], ...(selectedInput.address === NATIVE ? { valueWei: amountWei.toString() } : {}) });
      await requireWalletTxMined(hash, "limit order", 180000);
      setNotice(`Limit order placed, escrowed and waiting for the price. ${hash.slice(0, 12)}…`);
      setAmount(""); setLimitPrice("");
      void Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ["asedex-orders"] })]);
    } catch (e) { setError(e instanceof Error ? e.message : "Limit order failed"); }
    finally { setBusy(null); }
  }

  async function placeDcaOrder() {
    begin("dca");
    if (wallet.status !== "connected") { wallet.openConnect?.(); return; }
    const slices = safeBig(dcaSlices || "0");
    const minutes = Number(dcaMinutes || "0");
    if (!selected || !selectedInput || !amountWei || amountWei <= 0n) { setError("Enter a total amount to DCA"); return; }
    if (!dcaEnabled) { setError(selLegacy ? "DCA orders aren't supported on AURAS. Use Limit" : "Select a pool first"); return; }
    if (slices < 2n || slices > 60n) { setError("Choose between 2 and 60 slices"); return; }
    if (!Number.isFinite(minutes) || minutes < 1) { setError("Interval must be at least 1 minute"); return; }
    if (sellLocked) { setError("This token is locked until its AsePad migration finishes"); return; }
    if (amountWei > inBalWei) { setError(`Insufficient ${selectedInput.symbol}`); return; }
    try {
      setBusy("Preparing order…");
      await ensureDexAllowance(selectedInput.address, selected.dex, poolInWei!, "Approving…");
      setBusy("Creating DCA order…");
      const intervalSec = safeBig(Math.round(minutes * 60));
      const hash = await sendWalletCall({ to: selected.dex, method: "createDcaOrder", args: [selected.id, selectedInput.address, poolInWei!.toString(), slices.toString(), intervalSec.toString(), "0"], ...(selectedInput.address === NATIVE ? { valueWei: amountWei.toString() } : {}) });
      await requireWalletTxMined(hash, "DCA order", 180000);
      setNotice(`DCA started, ${slices} slices every ${dcaMinutes}m. First slice already filled. ${hash.slice(0, 12)}…`);
      setAmount("");
      void Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ["asedex-orders"] })]);
    } catch (e) { setError(e instanceof Error ? e.message : "DCA order failed"); }
    finally { setBusy(null); }
  }

  async function cancelOrder(order: Order) {
    begin("orders");
    if (wallet.status !== "connected") { wallet.openConnect?.(); return; }
    try {
      setBusy("Cancelling order…");
      const hash = await sendWalletCall({ to: order.dex, method: isLegacyDex(order.dex) ? "cancelLimitOrder" : "cancelOrder", args: [order.id] });
      await requireWalletTxMined(hash, "cancel order", 180000);
      setNotice("Order cancelled, escrow refunded.");
      void queryClient.invalidateQueries({ queryKey: ["asedex-orders"] });
    } catch (e) {
      // Reads can briefly serve a stale "open" (poll raced a book sweep, or a
      // lagging node) — the chain's own check is authoritative. A not-open
      // revert means the order already filled/cancelled: refresh, don't alarm.
      const msg = e instanceof Error ? e.message : "";
      if (/order not open|no such order/i.test(msg)) {
        setNotice("Order already filled or cancelled — refreshing.");
        void queryClient.invalidateQueries({ queryKey: ["asedex-orders"] });
      } else setError(msg || "Cancel failed");
    }
    finally { setBusy(null); }
  }

  // Pool/market search: name, ticker, 0x contract — and the ase1 form users
  // paste from the UI (rows carry hex, so the query converts to hex to match).
  const ase1OfAddr = (hex: string) => { try { return /^0x[0-9a-fA-F]{40}$/.test(hex) ? String(toAseAddress(hex)).toLowerCase() : ""; } catch { return ""; } };
  // Match haystack: ticker, name, hex AND ase1 forms of both token contracts,
  // plus pool id ("68", "#68") and venue ("asedex", "auras", "auras 68").
  const venueTag = (dex: string) => (isLegacyDex(dex) ? "auras" : "asedex");
  const poolHay = (asset0: PoolRow["asset0"], asset1: PoolRow["asset1"], pool: PoolRow["pool"]) =>
    `${asset0.symbol} ${asset1.symbol} ${asset0.name} ${asset1.name} ${pool.token0} ${pool.token1} ${ase1OfAddr(pool.token0)} ${ase1OfAddr(pool.token1)} ${pool.id} #${pool.id} pool ${pool.id} pool #${pool.id} ${venueTag(pool.dex)} ${venueTag(pool.dex)}${pool.id} ${venueTag(pool.dex)} ${pool.id} ${venueTag(pool.dex)} #${pool.id} ${venueTag(pool.dex)} pool ${pool.id} ${venueTag(pool.dex)} pool #${pool.id} pool ${pool.id} ${venueTag(pool.dex)} pool #${pool.id} ${venueTag(pool.dex)}`.toLowerCase();
  const rowMatches = (row: PoolRow, q: string) => {
    const norm = q.replace(/^\$+/, "");
    const hay = poolHay(row.asset0, row.asset1, row.pool);
    if (norm && hay.includes(norm)) return true;
    try {
      const hex = toHexAddress(q).toLowerCase();
      if (/^0x[0-9a-f]{40}$/.test(hex)) return hay.includes(hex);
    } catch { }
    return false;
  };
  const radarQ = radarSearch.trim().toLowerCase();
  const poolsQ = poolsSearch.trim().toLowerCase();
  // Focus-priority search — the box on screen (radar / pools / markets
  // drawer) fetches FIRST instead of waiting for the sweep to stream the row
  // in. Debounced so one scan runs per pause, not per keystroke; a new query
  // aborts the stale probe between pool ids.
  const liveSearch = (view === "radar" ? radarSearch : view === "pools" ? poolsSearch : view === "markets" ? marketSearch : "").trim();
  const [searchDeb, setSearchDeb] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearchDeb(liveSearch), 350);
    return () => clearTimeout(t);
  }, [liveSearch]);
  const searchQ = searchDeb.trim().toLowerCase();
  const searchNorm = searchQ.replace(/^\$+/, "");
  // Pair queries ("bet/ase") need side-aware matching in the unstreamed-pool
  // probe too — the combined haystack can't express "each side hits a term".
  const searchPairTerms = useMemo(() => {
    const m = /^([^/\-\s]+)\s*[/\-]\s*([^/\-\s]+)$/.exec(searchQ);
    return m ? [m[1], m[2]] as const : null;
  }, [searchQ]);
  const searchAddr = useMemo(() => {
    if (/^0x[0-9a-fA-F]{40}$/.test(searchQ)) return searchQ;
    try {
      const h = toHexAddress(searchQ);
      return /^0x[0-9a-f]{40}$/i.test(h) ? h.toLowerCase() : null;
    } catch { return null; }
  }, [searchQ]);
  const searchedPools = useQuery({
    queryKey: ["asedex-search-pool", searchQ],
    enabled: searchQ.length > 0,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      // AWS-only — allRows is the full indexed pool universe, so a search is a
      // local filter plus one apiResolve hop for pasted contracts (launch
      // migration pool + pools on every venue). No poolCount/getPool sweeps,
      // ever. Previous rows seed so invalidations can't drop a found pool.
      const prev = queryClient.getQueryData<PoolRow[]>(["asedex-search-pool", searchQ]) ?? [];
      const found = new Map<string, PoolRow>(prev.map((r) => [poolKey(r.pool.dex, r.pool.id), r] as const));
      const emit = () => { if (!signal?.aborted) queryClient.setQueryData<PoolRow[]>(["asedex-search-pool", searchQ], [...found.values()]); };
      const sideHay = (a: Asset, addr: string) => `${a.symbol} ${a.name} ${addr} ${ase1OfAddr(addr)}`.toLowerCase();
      const matches = (r: PoolRow) => searchPairTerms
        ? ((sideHay(r.asset0, r.pool.token0).includes(searchPairTerms[0]) && sideHay(r.asset1, r.pool.token1).includes(searchPairTerms[1]))
          || (sideHay(r.asset0, r.pool.token0).includes(searchPairTerms[1]) && sideHay(r.asset1, r.pool.token1).includes(searchPairTerms[0])))
        : poolHay(r.asset0, r.asset1, r.pool).includes(searchNorm);
      // Every indexed pool is already in allRows — filter, don't re-fetch.
      for (const r of allRows) {
        if (signal?.aborted) return [...found.values()];
        if (matches(r)) found.set(poolKey(r.pool.dex, r.pool.id), r);
      }
      emit();
      // Synthesize a row for pools the indexer serves but the loaded list
      // doesn't have yet (fresh pool, just-deployed venue).
      const addApiPool = async (dexRaw: string, p: { pool_id?: string | null; token0?: string | null; token1?: string | null; reserve0?: string | null; reserve1?: string | null; lp_supply?: string | null }) => {
        const dex = normAddr(String(dexRaw || "")) || PRIMARY_DEX;
        const pid = String(p.pool_id || "").replace(/^\D+-/, "");
        const t0 = String(p.token0 || "").toLowerCase(), t1 = String(p.token1 || "").toLowerCase();
        if (!/^\d+$/.test(pid) || !t0 || !t1 || found.has(poolKey(dex, pid))) return;
        const metas = await tokenAssetsBatch(client, [t0, t1], true).catch(() => new Map<string, Asset>());
        const asset0 = metas.get(t0) ?? assetSSRead()[t0] ?? { address: t0, name: "Unknown token", symbol: "?", decimals: 18 };
        const asset1 = metas.get(t1) ?? assetSSRead()[t1] ?? { address: t1, name: "Unknown token", symbol: "?", decimals: 18 };
        const pool = sanPool({ id: pid, token0: t0, token1: t1, reserve0: p.reserve0 ?? "0", reserve1: p.reserve1 ?? "0", totalShares: p.lp_supply ?? "0", dex } as Pool);
        if (!pool?.id) return;
        found.set(poolKey(dex, pid), { pool, asset0, asset1, seenAt: Date.now() });
        emit();
      };
      if (searchAddr) {
        // Pasted contract — resolve answers its launch, gate, and every pool
        // it appears in across venues in one call.
        const r = await apiResolve(searchAddr).catch(() => null);
        for (const p of r?.pools ?? []) {
          if (signal?.aborted) break;
          await addApiPool(String((p as { dex?: string }).dex || ""), p);
        }
        // Fresh launches' pools may not be indexed yet — resolve's own launch
        // record still carries the migration pool id.
        const mig = r?.launch as { migration_pool?: string | null } | null | undefined;
        const migId = String(mig?.migration_pool || "").replace(/^\D+-/, "");
        if (migId && safeBig(migId) > 0n) {
          const d = await apiPool(PRIMARY_DEX, migId).catch(() => null);
          if (d?.pool) await addApiPool(PRIMARY_DEX, d.pool);
        }
      } else {
        // Name/ticker — warm launch caches map it to token + migrated pool;
        // their pools are already matched via allRows, this covers the
        // indexer-lagging fresh migration.
        for (const l of asepadCachedLaunchMatches(searchQ)) {
          if (signal?.aborted) break;
          const pid = String(l.aseDexPoolId || "");
          const dex = normAddr(String(l.aseDex || "")) || PRIMARY_DEX;
          if (pid && safeBig(pid) > 0n && !found.has(poolKey(dex, pid))) {
            const d = await apiPool(dex, pid).catch(() => null);
            if (d?.pool) await addApiPool(dex, d.pool);
          }
        }
      }
      return [...found.values()];
    }
  });
  // Disabled queries still return their last data — gate on the live input so
  // clearing the box doesn't leave searched rows merged into the list.
  const searchedRows = liveSearch ? (searchedPools.data ?? EMPTY_POOL_ROWS) : EMPTY_POOL_ROWS;
  // Direct-hit rows merge in ahead of the sweep — dedupe by pool key so a row
  // the sweep later resolves isn't doubled. Memoized on stable refs — the 1s
  // clock tick must not re-sort/re-merge the whole list.
  const baseRows = useMemo(() => (searchedRows.length
    ? allRows.concat(searchedRows.filter((r) => !allRows.some((x) => poolKey(x.pool.dex, x.pool.id) === poolKey(r.pool.dex, r.pool.id))))
    : allRows
    // A row without both assets can't render anywhere downstream — persisted
    // snapshots from older builds can carry a different shape, so drop them at
    // the merge point instead of crashing every consumer.
  ).filter((r) => r?.asset0?.address && r?.asset1?.address && r?.pool?.id), [allRows, searchedRows]);
  // Pools with real liquidity — Radar, Markets and hotkey nav skip zero-LP
  // pools; they still appear (dimmed, last) in the Pools tab.
  // Newest pair first by pool id — ids are monotonic with creation order, so
  // the highest id is the newest market. Venues merge: an AuraDex pool with a
  // higher id than an AseDex pool correctly ranks above it. (seenAt was only
  // a first-discovery timestamp — not creation order.)
  const poolIdNum = (v?: string) => { try { return safeBig(v || "0"); } catch { return 0n; } };
  // Cross-pair pricing — reserve-graph BFS outward from ASE. Tokens with a
  // direct ASE pool price from reserves; a token paired with a priced token
  // then inherits price through the pool ratio (B = A_price × resA/resB),
  // transitively. Pairs with no ASE path still trade and show their real
  // token-denominated price — they just get no USD figure.
  // Market-facing list — gated, not just funded. poolViable drops dust/dead
  // pools (they stop earning stats + meta work upstream too); the token↔token
  // post-cut needs the price map, so it runs here: unpriced-both-legs pairs
  // whose quote side is also dust in units have no market to show. LP/position
  // views still list every pool so creators can find and fund them.
  // Sourced from baseRows — search boxes are per-surface downstream of this,
  // so one box's query can't leak into the drawer/totals/terminal lists.
  const liquidRows = useMemo(() => baseRows
    .filter((row) => poolViable(row.pool))
    .filter((row) => {
      if (row.pool.token0 === NATIVE || row.pool.token1 === NATIVE) return true;
      if (asePriceByToken.has(row.asset0.address) || asePriceByToken.has(row.asset1.address)) return true;
      return Number(safeBig(row.pool.reserve1 || "0")) / 10 ** row.asset1.decimals >= TT_MIN_QUOTE_UNITS;
    })
    .sort((a, b) => {
      const ia = poolIdNum(a.pool.id), ib = poolIdNum(b.pool.id);
      // Equal ids across venues (both can mint id N) — discovery order breaks ties.
      return ib > ia ? 1 : ib < ia ? -1 : (b.seenAt ?? 0) - (a.seenAt ?? 0);
    }), [baseRows, asePriceByToken]);
  // Pool weight in USD: ASE+token pools price as ASE side ×2. Token+token
  // pools price through the ASE-valued leg — the token1 (quote) side first,
  // token0 as fallback — so ABC/XYZ sorts by ABC's ASE→USD value. Pairs with
  // no ASE-priced leg can't be valued and sort after priced liquidity.
  // Per-leg ASE valuation — the ASE leg prices directly, each token leg rides
  // its own ASE price (direct pool or hop-priced through token↔token pairs).
  // Both legs priced → honest sum (skewed pools show their real weight);
  // one leg priced → double it (balanced-pool estimate); neither → 0.
  const tvlOf = (row: PoolRow): number => {
    const legVal = (addr: string, res: string | undefined, dec: number): number => {
      const r = safeBig(res || "0");
      if (r <= 0n) return 0;
      if (addr === NATIVE) return Number(r) / 1e18;
      const l = asePriceByToken.get(addr) ?? asePriceByToken.get(addr.toLowerCase());
      return l ? (Number(r) / 10 ** dec) * l.price : 0;
    };
    const v0 = legVal(row.pool.token0, row.pool.reserve0, row.asset0.decimals);
    const v1 = legVal(row.pool.token1, row.pool.reserve1, row.asset1.decimals);
    const ase = v0 > 0 && v1 > 0 ? v0 + v1 : Math.max(v0, v1) * 2;
    const usd = ase * aseUsdRate;
    // Display sanity: a hop-priced leg can still produce fantasy USD on
    // token↔token pools (dust ratios passing the mcap bound). Past the cap
    // the pool is shown in token units instead of a trillion-dollar lie.
    return usd > MAX_USD_DISPLAY ? 0 : usd;
  };
  // Pair-query side matcher — tighter than the haystack: "ase/bet" must not
  // match a PHASE/BET pool on the "ase" substring. Symbol/name equality,
  // ≥4-char substring, full address, or ≥10-char address prefix.
  const sideHit = (row: PoolRow, side: 0 | 1, term: string) => {
    const t = term.trim().toLowerCase().replace(/^\$+/, "");
    if (!t) return false;
    const addr = side === 0 ? row.pool.token0 : row.pool.token1;
    const asset = side === 0 ? row.asset0 : row.asset1;
    if (addr === NATIVE) return t === "ase" || t === "asentum" || t === NATIVE.toLowerCase();
    const sym = asset.symbol.trim().toLowerCase(), name = asset.name.trim().toLowerCase();
    const a1 = ase1OfAddr(addr);
    return sym === t || name === t
      || (t.length >= 4 && (sym.includes(t) || name.includes(t)))
      || addr.toLowerCase() === t || a1 === t
      || (t.length >= 10 && (addr.toLowerCase().startsWith(t) || a1.startsWith(t)));
  };
  // Search semantics — three query forms:
  //   "593" / "#593" / "pool 593"  → the exact pool id only (each venue owns
  //                                  its id space, so one per venue can hit).
  //   "asedex 593" / "auras 593"   → exact id pinned to that venue.
  //   "bet/ase", "ase/bet", "bet-xyz" → the exact pair, order-agnostic.
  //   "bet" → every pool carrying that token: ASE-paired first by native
  //           depth, then token↔token pools by their ASE-equivalent weight.
  const searchRows = (rows: PoolRow[], q: string): PoolRow[] => {
    const query = q.trim().toLowerCase();
    if (!query) return rows;
    const v2IdM = /^(?:aurasv2|auras\s+v2)\s*#?\s*(\d+)$/.exec(query);
    if (v2IdM) return rows.filter((r) => r.pool.dex === AURADEX_V2 && r.pool.id === v2IdM[1]).sort((a, b) => tvlOf(b) - tvlOf(a));
    const venueIdM = /^(asedex|auras)\s*#?\s*(\d+)$/.exec(query);
    if (venueIdM) {
      const legacy = venueIdM[1] === "auras";
      return rows
        .filter((r) => isLegacyDex(r.pool.dex) === legacy && r.pool.id === venueIdM[2])
        .sort((a, b) => tvlOf(b) - tvlOf(a));
    }
    const idM = /^(?:#\s*|pool\s+#?\s*)?(\d+)$/.exec(query);
    if (idM) return rows.filter((r) => r.pool.id === idM[1]).sort((a, b) => tvlOf(b) - tvlOf(a));
    const pairM = /^([^/\-\s]+)\s*[/\-]\s*([^/\-\s]+)$/.exec(query);
    if (pairM) {
      const x = pairM[1], y = pairM[2];
      return rows
        .filter((r) => (sideHit(r, 0, x) && sideHit(r, 1, y)) || (sideHit(r, 0, y) && sideHit(r, 1, x)))
        .sort((a, b) => tvlOf(b) - tvlOf(a));
    }
    return rows.filter((r) => rowMatches(r, query)).sort((a, b) => {
      const aAse = a.pool.token0 === NATIVE || a.pool.token1 === NATIVE ? 0 : 1;
      const bAse = b.pool.token0 === NATIVE || b.pool.token1 === NATIVE ? 0 : 1;
      return aAse - bAse || tvlOf(b) - tvlOf(a);
    });
  };
  // Radar's own search + venue toggle — filters only this list, never the
  // markets page / liquidity totals / terminal resolution upstream of it.
  const radarRows = (radarQ ? searchRows(liquidRows, radarQ) : liquidRows)
    .filter((row) => radarVenue === "all" || (radarVenue === "legacy" ? isLegacyDex(row.pool.dex) : !isLegacyDex(row.pool.dex)));
  // List paging — only the visible page is rendered into the DOM; the full
  // sorted/filtered array stays a cheap data structure. `cur` clamps when a
  // search/filter shrinks the list, so pages self-reset.
  const LIST_PAGE = 10;
  const usePagedRows = <T,>(rows: T[], pageSize = LIST_PAGE) => {
    const [page, setPage] = useState(1);
    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    const cur = Math.min(page, pages);
    const paged = useMemo(() => rows.slice((cur - 1) * pageSize, cur * pageSize), [rows, cur, pageSize]);
    return { paged, page: cur, pages, setPage };
  };
  // Pools view tabs — "mine" keeps only pools this wallet holds shares in.
  // Order: USD weight high → low, venues merged (a deep AuraDex pool outranks
  // a shallow AseDex one), zero-LP pools last.
  const poolRows = poolsQ
    ? searchRows(poolTab === "mine"
      ? baseRows.filter((row) => safeBig(shareByPool.get(poolKey(row.pool.dex, row.pool.id)) || "0") > 0n)
      : baseRows, poolsQ)
    : [...(poolTab === "mine"
      ? baseRows.filter((row) => safeBig(shareByPool.get(poolKey(row.pool.dex, row.pool.id)) || "0") > 0n)
      : baseRows)].sort((a, b) => {
        const aDead = poolViable(a.pool) ? 0 : 1;
        const bDead = poolViable(b.pool) ? 0 : 1;
        if (aDead !== bDead) return aDead - bDead;
        return tvlOf(b) - tvlOf(a);
      });
  const radarPage = usePagedRows(radarRows);
  const poolPage = usePagedRows(poolRows);
  // Total ASE-side liquidity across pools (matches the per-row LP column) —
  // token↔token pools count their legs at ASE-equivalent value instead of
  // silently contributing zero to the headline number.
  const aseLiquidity = liquidRows.reduce((sum, row) => {
    const native = row.pool.token0 === NATIVE ? row.pool.reserve0 : row.pool.token1 === NATIVE ? row.pool.reserve1 : "0";
    let v = safeBig(native);
    if (v === 0n) {
      const leg = (addr: string, res: string | undefined, dec: number) => {
        const r = safeBig(res || "0");
        if (r <= 0n || addr === NATIVE) return 0;
        const l = asePriceByToken.get(addr) ?? asePriceByToken.get(addr.toLowerCase());
        return l ? (Number(r) / 10 ** dec) * l.price : 0;
      };
      const a = leg(row.pool.token0, row.pool.reserve0, row.asset0.decimals);
      const b = leg(row.pool.token1, row.pool.reserve1, row.asset1.decimals);
      v = safeBig(Math.round((a > 0 && b > 0 ? a + b : Math.max(a, b) * 2) * 1e18));
    }
    return sum + v;
  }, 0n);

  // Per-pool 24h stats — powers the Radar screener and the Pools table.
  // volQuoteWei = the day's quote-token leg for token↔token pools (wei of the
  // quote asset) — lets unpriced pairs show real volume in quote terms.
  // One pool's 24h stat. Shared by the full refresh and the live listener,
  // which recomputes only the pool a Swap just touched. null = read failed
  // (callers keep the previous stat rather than zeroing it).
  const auraPairIndex = async () => {
    const m = new Map<string, AuraPair>();
    const res = await fetchAuraPairs();
    for (const p of res?.pairs ?? []) if (isLegacyDex(p.amm)) m.set(poolKey(String(p.amm).toLowerCase(), p.poolId), p);
    return m;
  };
  const computeStat = async (row: PoolRow, auraPairMap: Map<string, AuraPair>): Promise<PoolStat | null> => {
    const empty: PoolStat = { volWei: "0", trades: 0, change: 0, lastTs: 0, lastPrice: 0, lastBuy: null };
    // AuraDex predates recentSwaps — its stats come from the Auras indexer.
    if (isLegacyDex(row.pool.dex)) {
      const p = auraPairMap.get(poolKey(row.pool.dex, row.pool.id));
      if (!p) return empty;
      const last = (await auraApi<{ trades?: AuraTrade[] }>(`/api/trades?pool=${row.pool.dex}:${row.pool.id}&limit=1`))?.trades?.[0];
      return {
        volWei: safeBig(Math.round(p.volume24 * 1e18)).toString(),
        trades: p.trades24,
        change: (p.change24 || 0) * 100,
        lastTs: toSec(Date.parse(String(p.lastTradeAt || "")) || 0),
        lastPrice: p.price,
        lastBuy: last ? last.side === "buy" : null
      };
    }
    const raw = await client.view(row.pool.dex, "recentSwaps", [row.pool.id, "96"], { bulk: true }).catch(() => null);
    if (!raw) return null;
    try {
      const parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as { swaps?: { priceAsePerTokenScaled?: string; createdTs?: string; volumeAseWei?: string; tokenIn?: string; amountIn?: string; amountOut?: string }[] };
      // UTC-day stats — window resets at 00:00 UTC. swaps arrive newest-first.
      const dayStart = Math.floor(Date.now() / 86400000) * 86400;
      const recs = parsed.swaps ?? [];
      const tsOf = (s: { createdTs?: string }) => { try { return toSec(Number(safeBig(s.createdTs || "0"))); } catch { return 0; } };
      const pxOf = (s: { priceAsePerTokenScaled?: string }) => Number(safeBig(s.priceAsePerTokenScaled || "0")) / 1e18;
      const day = recs.filter((s) => tsOf(s) >= dayStart);
      const prevRec = recs.find((s) => tsOf(s) < dayStart);
      const lastPrice = recs.length ? pxOf(recs[0]!) : 0;
      const base = prevRec ? pxOf(prevRec) : day.length ? pxOf(day.at(-1)!) : 0;
      // Last-trade direction: a buy pays the quote asset in. For ASE
      // pools that's native ASE; for token↔token pools, asset1 quotes.
      const isAseLeg = row.pool.token0 === NATIVE || row.pool.token1 === NATIVE;
      const quoteAddr = isAseLeg ? NATIVE : row.asset1.address;
      // Token↔token swaps record volumeAseWei=0 on-chain (no ASE leg), so
      // convert the quote leg through its ASE price when one exists —
      // untrusted/missing price stays 0 rather than inventing a figure.
      const qVolWei = isAseLeg ? 0n : day.reduce((sum, s) =>
        sum + safeBig(String(s.tokenIn || "").toLowerCase() === quoteAddr.toLowerCase() ? (s.amountIn || "0") : (s.amountOut || "0")), 0n);
      const volWei = isAseLeg
        ? day.reduce((sum, s) => sum + safeBig(s.volumeAseWei || "0"), 0n)
        : (() => {
            const qPrice = asePriceByToken.get(quoteAddr.toLowerCase())?.price ?? asePriceByToken.get(quoteAddr)?.price ?? 0;
            if (qPrice <= 0) return 0n;
            return safeBig(Math.round(Number(qVolWei) / 10 ** row.asset1.decimals * qPrice * 1e18));
          })();
      return {
        volWei: volWei.toString(),
        volQuoteWei: qVolWei.toString(),
        trades: day.length,
        change: base > 0 && lastPrice > 0 ? ((lastPrice - base) / base) * 100 : 0,
        lastTs: recs.length ? tsOf(recs[0]!) : 0,
        lastPrice,
        lastBuy: recs.length ? String(recs[0]!.tokenIn || "").toLowerCase() === quoteAddr.toLowerCase() : null
      };
    } catch { return null; }
  };
  const poolStats = useQuery({
    queryKey: ["asedex-poolstats"],
    // Markets/Radar/Pools show 24h stats; the Wallet view doesn't.
    enabled: allRows.length > 0 && view !== "wallet",
    // Safety refresh only — live Swaps patch their pool's stat instantly via
    // the chain listener; this catches day rollover and anything missed.
    refetchInterval: 3_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      // Seeded: a failed read keeps that pool's previous stat.
      const map: Record<string, PoolStat> = { ...(queryClient.getQueryData<Record<string, PoolStat>>(["asedex-poolstats"]) ?? {}) };
      // The Auras indexer covers BOTH venues — ONE /api/pairs call replaces
      // ~400 per-pool recentSwaps reads for AseDex and the per-pool trades
      // probe for AuraDex. volume24 arrives in quote-token units: ASE pairs
      // read straight into wei; token↔token pools go through the quote leg's
      // ASE price exactly like the on-chain path did.
      const res = await fetchAuraPairs();
      if (res?.pairs?.length) {
        const empty: PoolStat = { volWei: "0", trades: 0, change: 0, lastTs: 0, lastPrice: 0, lastBuy: null };
        const byKey = new Map(res.pairs.map((p) => [
          poolKey(String(p.amm || "").toLowerCase(), String(p.chainPoolId ?? String(p.poolId).replace(/^asedex-/, ""))), p
        ]));
        for (const row of allRows) {
          const k = poolKey(row.pool.dex, row.pool.id);
          const p = byKey.get(k);
          if (!p) { if (!map[k]) map[k] = empty; continue; }
          const isAseLeg = row.pool.token0 === NATIVE || row.pool.token1 === NATIVE;
          const qDec = isAseLeg ? 18 : row.asset1.decimals;
          const qPx = isAseLeg ? 1 : (asePriceByToken.get(row.asset1.address.toLowerCase())?.price ?? 0);
          const vol24 = Number(p.volume24) || 0;
          const px = Number(p.price) || 0;
          map[k] = {
            volWei: isAseLeg
              ? safeBig(Math.round(vol24 * 1e18)).toString()
              : (qPx > 0 ? safeBig(Math.round((vol24 / 10 ** qDec) * qPx * 1e18)).toString() : "0"),
            volQuoteWei: isAseLeg ? "0" : safeBig(Math.round(vol24 * 10 ** qDec)).toString(),
            trades: Number(p.trades24) || 0,
            change: (Number(p.change24) || 0) * 100, // indexer sends a fraction
            lastTs: toSec(Date.parse(String(p.lastTradeAt || "")) || 0),
            // Indexer price is quote-per-base — invert when ASE is token0.
            lastPrice: isAseLeg
              ? (row.pool.token0 === NATIVE ? (px > 0 ? 1 / px : 0) : px)
              : px * qPx,
            // Direction isn't in the pairs record — live Swap patches set it.
            lastBuy: null
          };
        }
        return map;
      }
      // Feed dark — keep the previous map, zero chain reads.
      return map;
    }
  });
  // DB volume overrides volWei when indexed (uniform ASE wei — the auras
  // path's quote-unit conversion can't mix venues). UTC-day volume is the
  // primary number — it resets 00:00 UTC and is the same window the HOT
  // ranks and Trending sort use, so the column never disagrees with a tag.
  // Rolling-24h fills pools the day index hasn't reached yet. Other stat
  // fields (change/price/lastBuy) still come from the indexer/chain compute.
  const statOf = (row: PoolRow): PoolStat => {
    const s = poolStats.data?.[poolKey(row.pool.dex, row.pool.id)] ?? EMPTY_STAT;
    const k = poolKey(row.pool.dex, row.pool.id);
    const dd = dbDayVolByKey.get(k);
    const dv = dbVolByKey.get(k);
    if (dd == null && !dv) return s;
    return { ...s, volWei: safeBig(Math.round(dd ?? dv?.v ?? 0)).toString(), trades: Math.max(s.trades, dv?.n ?? 0) };
  };
  // Markets page — every liquid pool, search-scoped, sorted by the active pill:
  // All = deepest liquidity, 24h Vol = top volume, Gainers/Losers = 24h change.
  // Rows re-sort in place as pool stats resolve.
  // Low-LP cut for Markets — computed EXACTLY the way the "Low LP" tag is
  // (same poolDepleted call, same assets, same price map), so any pair that
  // would carry the tag in Markets/Radar/Pools is removed instead of drawn.
  const marketRowDepleted = (row: PoolRow): boolean => {
    const logo = row.asset0.address === NATIVE ? row.asset1 : row.asset0;
    const q = row.asset0.address === logo.address ? row.asset1 : row.asset0;
    return poolDepleted(row.pool, logo.address, q.address, q.decimals, asePriceByToken.get(q.address)?.price ?? 0);
  };
  // "fav" collapses to "all" when the last star is removed — an empty fav
  // list with no visible rows looks like a bug.
  const effMarketSort = marketSort === "fav" && favs.size === 0 ? "all" : marketSort;
  const marketRows = useMemo(() => {
    // No-LP pools (zero reserves on both legs — ASE or token↔token alike)
    // aren't markets; drop them entirely instead of dimming them.
    const liquid = [...baseRows]
      .filter((row) => safeBig(row.pool.totalShares || "0") > 0n || Number(row.pool.tvlQuote) > 0);
    const favOnly = effMarketSort === "fav" ? liquid.filter((r) => favs.has(poolKey(r.pool.dex, r.pool.id))) : liquid;
    const q = marketSearch.trim();
    const list = q ? searchRows(favOnly, q) : favOnly;
    return [...list].sort((a, b) => {
      if (effMarketSort === "gainers") return statOf(b).change - statOf(a).change;
      if (effMarketSort === "losers") return statOf(a).change - statOf(b).change;
      if (effMarketSort === "all" || effMarketSort === "fav") return tvlOf(b) - tvlOf(a);
      const va = poolIdNum(statOf(a).volWei), vb = poolIdNum(statOf(b).volWei);
      return vb > va ? 1 : vb < va ? -1 : 0;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseRows, marketSearch, effMarketSort, favs, poolStats.data]);
  // Low-LP cut — applied at render time with the live price map (not inside
  // the memo, where a stale asePriceByToken could let tagged rows through).
  // Whatever poolDepleted flags → the row never reaches All/Trending/
  // Gainers/Losers.
  const visibleMarketRows = marketRows.filter((row) => !marketRowDepleted(row));
  // HOT ranks = the true top-10 by UTC-day volume across the WHOLE market
  // (same non-depleted population, but BEFORE the search filter) — so a
  // searched low-volume pair can never fake "HOT #1" by landing first in
  // results. UTC-day numbers come from the DB; where it has no day rows yet
  // the rolling-24h stat ranks instead so tags never go blank mid-hydration.
  const hotRanks = useMemo(() => {
    // Rank by the same resolved volume statOf displays — UTC-day where the
    // DB has it, rolling-24h elsewhere — so a row's HOT rank always matches
    // the number printed in its 24h Vol cell.
    const dayVolOf = (row: PoolRow) => Number(statOf(row).volWei) || 0;
    const ranked = [...baseRows]
      .filter((row) => (safeBig(row.pool.totalShares || "0") > 0n || Number(row.pool.tvlQuote) > 0) && !marketRowDepleted(row))
      .sort((a, b) => { const va = dayVolOf(a), vb = dayVolOf(b); return vb > va ? 1 : vb < va ? -1 : 0; });
    const m = new Map<string, number>();
    let rank = 0;
    for (const row of ranked) {
      if (dayVolOf(row) <= 0) break;
      m.set(poolKey(row.pool.dex, row.pool.id), ++rank);
      if (rank >= 10) break;
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseRows, poolStats.data, asePriceByToken, dbVolByKey, dbDayVolByKey]);
  // Trending = top 50 by volume (already vol-sorted). A deliberate search
  // bypasses the cap so any matching pair is still findable.
  const displayMarketRows = effMarketSort === "vol" && !marketSearch.trim()
    ? visibleMarketRows.slice(0, 50)
    : visibleMarketRows;
  const marketPage = usePagedRows(displayMarketRows);
  // Pair-picker modal rows — same liquid/non-depleted population as Markets
  // but with its own search + tab so the modal filters independently of the
  // markets page. "fav" hides entirely when no stars are saved.
  const effPickTab = pairPickTab === "fav" && favs.size === 0 ? "all" : pairPickTab;
  const pairPickRows = useMemo(() => {
    const liquid = baseRows.filter((row) =>
      (safeBig(row.pool.totalShares || "0") > 0n || Number(row.pool.tvlQuote) > 0) && !marketRowDepleted(row));
    let list = effPickTab === "fav" ? liquid.filter((r) => favs.has(poolKey(r.pool.dex, r.pool.id))) : liquid;
    const q = pairPickQ.trim();
    if (q) list = searchRows(list, q);
    return [...list].sort((a, b) => {
      if (effPickTab === "gainers") return statOf(b).change - statOf(a).change;
      if (effPickTab === "losers") return statOf(a).change - statOf(b).change;
      if (effPickTab === "vol") { const va = poolIdNum(statOf(a).volWei), vb = poolIdNum(statOf(b).volWei); return vb > va ? 1 : vb < va ? -1 : 0; }
      return tvlOf(b) - tvlOf(a);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseRows, effPickTab, pairPickQ, favs, poolStats.data, asePriceByToken]);
  // Non-circulating supply per listed token (burned + AseLock escrow) so
  // Markets MC uses the same circulating rule as the terminal. Markets-view
  // only, cached.
  const marketTokens = useMemo(() => [...new Set(marketRows.map((r) =>
    (r.asset0.address === NATIVE ? r.asset1 : r.asset0).address).filter((a) => a !== NATIVE))].sort(), [marketRows]);
  const marketBurned = useQuery({
    queryKey: ["asedex-market-noncirc", marketTokens.join(",")],
    enabled: view === "markets" && marketTokens.length > 0,
    staleTime: 600_000,
    queryFn: async () => {
      const out = new Map<string, bigint>();
      // Bounded concurrency over /api/holders — ~8 in flight so a 400-token
      // market list resolves without stampeding the API.
      for (let i = 0; i < marketTokens.length; i += 8) {
        await Promise.all(marketTokens.slice(i, i + 8).map(async (t) => {
          out.set(t, await apiTokenNoncirc(t).catch(() => 0n));
        }));
      }
      return out;
    }
  });
  // Admin-granted blue ticks — the factory's on-chain "official:<token>" flag
  // (setWeiFeeEnabled), batched over every token a badge can render for:
  // market rows PLUS the terminal pair / held pickers / create-form assets,
  // which hydrate ahead of (or outside) the full market sweep.
  const officialProbeTokens = useMemo(() => {
    const set = new Set(marketTokens);
    for (const a of [...selectedAssets, ...(heldTokens.data ?? []), createAssetA, createAssetB])
      if (a && a.address !== NATIVE) set.add(a.address);
    return [...set].sort();
  }, [marketTokens, selectedAssets, heldTokens.data, createAssetA, createAssetB]);
  // Stable query key + accumulating cache — the watch set grows constantly as
  // pools/pickers/held tokens hydrate, and keying the query on the set made
  // every growth re-probe the ENTIRE list (2.5k+ calls starving the book and
  // order reads). Probe only the delta imperatively; the interval re-probes
  // the full set so admin revocations still propagate.
  const officialTokens = useQuery({
    queryKey: ["asedex-official-tokens"],
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    refetchInterval: 120_000,
    // AWS-authoritative: /api/tokens?official=1 returns the whole official
    // set in one HTTP read — the old per-token isWeiFeeEnabled probe was the
    // last standing RPC storm (~1.6k-2.5k calls per hydrate wave + retries).
    queryFn: async () => {
      try {
        const res = await apiTokens({ official: true, limit: 1000 });
        // Defense: an older/unfiltered backend once answered this with the
        // whole registry — every pad token got a blue tick. official=1 rows
        // only, always. Custom badge labels come from /api/verified notes;
        // unlabeled verified tokens default to "Verified by AsePad".
        const out = new Map<string, string>();
        for (const t of res?.tokens ?? []) {
          if (Number(t.official) === 1) out.set(String(t.address || "").toLowerCase(), "Verified by AsePad");
        }
        const v = await apiVerified().catch(() => null);
        for (const t of v?.tokens ?? []) {
          const a = String(t.address || "").toLowerCase();
          if (a) out.set(a, t.note?.trim() || "Verified by AsePad");
        }
        return out;
      } catch {
        return new Map<string, string>(); // API down — ticks stay blank rather than fall back to RPC storms
      }
    }
  });
  // Lock badges — shares the /lock page's ["aselock-all"] sweep, so no extra
  // scan runs here. Row badges show on every pool-listing view.
  const lockList = useQuery({
    queryKey: ["aselock-all"],
    queryFn: fetchAllLocks,
    enabled: (view === "markets" || view === "terminal" || view === "radar" || view === "pools") && Boolean(LOCK),
    staleTime: 30_000,
    refetchInterval: 60_000
  });
  // Lock id per row — LP locks key by pool (the lock contract is bound to the
  // current dex, so its poolIds are AseDex ids); token/vesting locks key by
  // the token address. Biggest live lock wins the badge.
  const lockTags = useMemo(() => {
    const lp = new Map<string, { id: string; amt: bigint; v2: boolean }>();
    const tok = new Map<string, { id: string; amt: bigint; v2: boolean }>();
    for (const l of lockList.data ?? []) {
      const rec = l.rec;
      if (rec.state !== "LOCKED") continue;
      const amt = safeBig(rec.amt || "0");
      const v2 = l.lock === LOCK_V2;
      if (rec.kind === "LP" && rec.poolId) {
        const k = `${DEX.toLowerCase()}:${rec.poolId}`;
        if (amt > (lp.get(k)?.amt ?? -1n)) lp.set(k, { id: l.id, amt, v2 });
      } else if (rec.token) {
        const k = rec.token.toLowerCase();
        if (amt > (tok.get(k)?.amt ?? -1n)) tok.set(k, { id: l.id, amt, v2 });
      }
    }
    return { lp, tok };
  }, [lockList.data]);
  const lpLockIdOf = (row: PoolRow) => lockTags.lp.get(`${row.pool.dex.toLowerCase()}:${row.pool.id}`);
  const tokLockIdOf = (row: PoolRow) => lockTags.tok.get((row.asset0.address === NATIVE ? row.asset1 : row.asset0).address.toLowerCase());
  // Selected pair's live locks — LP share lock keyed by pool, token/vesting
  // lock keyed by the viewed token. Driven by the shared ["aselock-all"] sweep.
  const pairLpLock = selectedRow ? lockTags.lp.get(`${selectedRow.pool.dex.toLowerCase()}:${selectedRow.pool.id}`) : undefined;
  const pairTokLock = pairAsset ? lockTags.tok.get(pairAsset.address.toLowerCase()) : undefined;

  // ── Live listener → smart cache, in place ──────────────────────────────
  // The watcher hands us each block's dex/pad receipts. Instead of refetching
  // every pool sweep, re-read ONLY the pools those events touched (one
  // getPool each) and patch that row into every cache holding it (pools,
  // AuraDex pools, search hits, deep-linked pool), plus its 24h stat and LP
  // burn %. A new pool is read once and lands on top. The patched caches
  // persist through the normal throttle, so a reload paints the live state.
  const listenerCtx = useRef({ computeStat, auraPairIndex });
  listenerCtx.current = { computeStat, auraPairIndex };
  useEffect(() => {
    const venueOf = (addr: string) => [...VENUES, ...LEGACY_DEXES].find((v) => v.toLowerCase() === addr.toLowerCase());
    const legacyKey = ["asedex-legacy-pools", LEGACY_DEXES.join(",")];
    const POOL_MOVES = new Set(["Swap", "Sync", "LiquidityAdded", "LiquidityRemoved", "LiquiditySeeded", "LpRewardsClaimed", "SharesTransferred", "SwapFeeUpdated", "PoolCreated", "LPShareBurned", "MigrationPoolReady", "MigrationCompleted"]);
    const SHARE_MOVES = new Set(["LiquidityAdded", "LiquidityRemoved", "LiquiditySeeded", "SharesTransferred", "LPShareBurned", "MigrationCompleted"]);
    const patchRows = (rows: PoolRow[] | undefined, next: PoolRow) => {
      if (!rows) return rows;
      const k = poolKey(next.pool.dex, next.pool.id);
      let hit = false;
      const out = rows.map((r) => {
        if (poolKey(r.pool.dex, r.pool.id) !== k) return r;
        hit = true;
        return { ...r, pool: next.pool, seenAt: r.seenAt ?? next.seenAt };
      });
      return hit ? out : rows;
    };
    const apply = async (dex: string, id: string, created: boolean, swap: boolean, shares: boolean) => {
      // Event-driven patch via AWS — the indexer commits the event in the
      // same tick it publishes it, so apiPool is already post-state. No
      // getPool chain read on a display path.
      const d = await apiPool(dex, id).catch(() => null);
      const ap = d?.pool;
      if (!ap?.token0) return;
      const pool = sanPool({
        id, dex, token0: String(ap.token0), token1: String(ap.token1),
        reserve0: String(ap.reserve0 || "0"), reserve1: String(ap.reserve1 || "0"),
        totalShares: String(ap.lp_supply || "0"), feeBps: String(ap.fee_bps ?? "30"),
        lastTs: String(ap.updated_at ?? "0"),
      } as Pool);
      if (!pool?.id) return;
      const listKey = isLegacyDex(dex) ? legacyKey : ["asedex-pools"];
      const k = poolKey(dex, pool.id);
      const known = (queryClient.getQueryData<PoolRow[]>(listKey) ?? []).find((r) => poolKey(r.pool.dex, r.pool.id) === k);
      let row: PoolRow;
      if (known) row = { ...known, pool };
      else {
        const [asset0, asset1] = await Promise.all([tokenAsset(client, pool.token0), tokenAsset(client, pool.token1)]);
        row = { pool, asset0, asset1, seenAt: Date.now() };
      }
      livePoolRows.set(k, { row, at: Date.now() });
      hydratedRows.set(k, { pool, asset0: row.asset0, asset1: row.asset1 });
      queryClient.setQueryData<PoolRow[]>(listKey, (rows) => {
        if (!rows) return [row];
        const patched = patchRows(rows, row);
        return patched !== rows ? patched : [row, ...rows]; // unseen pool → top
      });
      for (const [qk, data] of queryClient.getQueriesData<PoolRow[]>({ queryKey: ["asedex-search-pool"] })) {
        const p = patchRows(data, row);
        if (p !== data) queryClient.setQueryData(qk, p);
      }
      for (const [qk, data] of queryClient.getQueriesData<PoolRow | null>({ queryKey: ["asedex-url-pool"] })) {
        if (data && poolKey(data.pool.dex, data.pool.id) === k) queryClient.setQueryData(qk, { ...data, pool });
      }
      if (swap || created) {
        const s = await listenerCtx.current.computeStat(row, isLegacyDex(dex) ? await listenerCtx.current.auraPairIndex() : new Map());
        if (s) queryClient.setQueryData<Record<string, PoolStat>>(["asedex-poolstats"], (m) => ({ ...(m ?? {}), [k]: { ...m?.[k], ...s } }));
      }
      if (shares || created) {
        // AWS burn index — shares burned to ZERO per pool, zero chain reads.
        const b = await fetch(`${UNIFIED_API}/api/burn/${dex}/${pool.id}`, { signal: AbortSignal.timeout(8000) })
          .then((r) => (r.ok ? r.json() : null)).catch(() => null) as { shares?: string; supply?: string } | null;
        const total = safeBig(b?.supply ?? pool.totalShares ?? "0");
        const burned = safeBig(b?.shares ?? "0");
        queryClient.setQueryData<Record<string, number>>(["asedex-lp-burns"], (m) => ({ ...(m ?? {}), [k]: total > 0n && burned > 0n ? Number(burned * 10000n / total) / 100 : 0 }));
      }
    };
    // While a pool sweep is in-flight, live patches DEFER: every apply is
    // several ui-lane view reads, and a busy chain generates dozens per block —
    // they'd starve the sweep's bulk chunks and rows would drip in one event
    // at a time. The sweep's own reads are fresher than the event anyway.
    // Touched pools collect (deduped) and flush once the sweep settles.
    type Touched = { dex: string; id: string; created: boolean; swap: boolean; shares: boolean };
    const pending = new Map<string, Touched>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const sweepBusy = () =>
      queryClient.isFetching({ queryKey: ["asedex-pools"] }) > 0 ||
      queryClient.isFetching({ queryKey: ["asedex-legacy-pools"] }) > 0;
    const flush = () => {
      flushTimer = null;
      if (!pending.size) return;
      if (sweepBusy()) { flushTimer = setTimeout(flush, 1500); return; }
      const list = [...pending.values()];
      pending.clear();
      for (const t of list) void apply(t.dex, t.id, t.created, t.swap, t.shares).catch(() => { });
    };
    const unsub = subscribeChainEvents((batch) => {
      for (const { contract, events } of batch) {
        const venue = venueOf(contract);
        // Pad receipts: migration creates/seeds/burns on the pad's AseDex.
        const fromPad = Boolean(PAD) && contract === PAD.toLowerCase();
        if (!venue && !fromPad) continue;
        for (const e of events) {
          const name = String(e?.name || "");
          const d = (e?.data ?? {}) as Record<string, unknown>;
          // Migration events flip a pad token's dex gate — clear the cached
          // gate + refetch so the Create-pool lock lifts instantly instead of
          // on the gate-cache TTL.
          const evTok = String(d.token ?? "").toLowerCase();
          if (/^0x[0-9a-f]{40}$/.test(evTok) && /migrat|liquidityseeded|burn/i.test(name)) {
            gateCache.delete(evTok);
            void queryClient.invalidateQueries({ queryKey: ["asedex-gate"] });
          }
          if (!POOL_MOVES.has(name)) continue;
          const id = String(d.poolId ?? d.aseDexPoolId ?? "");
          if (!/^\d+$/.test(id) || id === "0") continue;
          const dex = venue ?? PRIMARY_DEX;
          const k = poolKey(dex, id);
          const t = pending.get(k) ?? { dex, id, created: false, swap: false, shares: false };
          t.created ||= name === "PoolCreated" || name === "MigrationPoolReady";
          t.swap ||= name === "Swap";
          t.shares ||= SHARE_MOVES.has(name);
          pending.set(k, t);
        }
      }
      // Small debounce: consecutive block ticks coalesce into one apply wave.
      if (!flushTimer) flushTimer = setTimeout(flush, 800);
    });
    return () => { unsub(); if (flushTimer) clearTimeout(flushTimer); };
  }, [client, queryClient]);

  // Lazy indexer-row hydration — rows built from /api/pairs carry TVL but
  // no real reserves/shares (tvlQuote marker). Anything needing real numbers
  // (open terminal pair, LP modal, a pool the wallet holds LP in) triggers
  // one getPool and patches the row in place; the marker then disappears and
  // this stops re-firing. Applies to BOTH venues now.
  useEffect(() => {
    const synth = (r: PoolRow | null | undefined): r is PoolRow =>
      Boolean(r && r.pool.tvlQuote != null);
    const targets = new Map<string, PoolRow>();
    for (const row of [lpRow, selectedRow]) if (synth(row)) targets.set(poolKey(row.pool.dex, row.pool.id), row);
    for (const row of allRows) {
      if (synth(row) && safeBig(shareByPool.get(poolKey(row.pool.dex, row.pool.id)) || "0") > 0n) {
        targets.set(poolKey(row.pool.dex, row.pool.id), row);
      }
    }
    for (const row of targets.values()) {
      const { dex, id } = row.pool;
      const k = poolKey(dex, id);
      void apiPool(dex, id).then(async (d) => {
        const p = d?.pool;
        if (!p?.token0) return;
        const real = sanPool({
          id, dex, token0: String(p.token0), token1: String(p.token1),
          reserve0: String(p.reserve0 || "0"), reserve1: String(p.reserve1 || "0"),
          totalShares: String(p.lp_supply || "0"), feeBps: String(p.fee_bps ?? "30"),
          lastTs: String(p.updated_at ?? "0"),
        } as Pool);
        // Synthetic rows carry placeholder assets — resolve real meta (supply
        // included) in the same pass so MC/FDV/caps don't stay "-".
        const [asset0, asset1] = await Promise.all([
          tokenAsset(client, String(p.token0).toLowerCase(), true),
          tokenAsset(client, String(p.token1).toLowerCase(), true)
        ]).catch(() => [row.asset0, row.asset1] as [Asset, Asset]);
        livePoolRows.set(k, { row: { ...row, pool: real, asset0, asset1 }, at: Date.now() });
        hydratedRows.set(k, { pool: real, asset0, asset1 });
        queryClient.setQueryData<PoolRow[]>(
          isLegacyDex(dex) ? ["asedex-legacy-pools", LEGACY_DEXES.join(",")] : ["asedex-pools"],
          (rows) => rows?.map((r) => poolKey(r.pool.dex, r.pool.id) === k ? { ...r, pool: real, asset0, asset1 } : r));
        setLpRow((cur) => cur && poolKey(cur.pool.dex, cur.pool.id) === k ? { ...cur, pool: real, asset0, asset1 } : cur);
      }).catch(() => { });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lpRow, selectedRow, allRows, shareByPool, client, queryClient]);

  // Wallet trade history — every pool's swaps filtered to this trader.
  // Powers the Wallet view's history tab + per-token avg-paid cost basis.
  type WalletSwap = SwapRec & { row?: PoolRow; side: "Buy" | "Sell"; base: Asset; quote: Asset; baseAmt: number; quoteAmt: number; px: number; txHash?: string };
  const mySwaps = useQuery({
    queryKey: ["asedex-my-swaps", ownerHex],
    // Only the Activity tab consumes this — the per-pool chain tail behind
    // it is a storm source on every wallet tick otherwise.
    enabled: Boolean(ownerHex && view === "wallet" && walletTab === "activity"),
    refetchInterval: 3_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const out: WalletSwap[] = [];
      const seenTx = new Set<string>();
      // Indexer wallet feed covers BOTH venues — poolId "asedex-N" for AseDex,
      // bare "N" for legacy AuraDex. Journal each into the user log so
      // history persists locally and traded tokens feed discovery.
      const rowForIndexerTrade = (t: AuraTrade) => {
        const pid = String(t.poolId || "");
        const asedexM = pid.match(/^asedex-(\d+)$/);
        if (asedexM) return allRows.find((r) => !isLegacyDex(r.pool.dex) && r.pool.id === asedexM[1]);
        return allRows.find((r) => isLegacyDex(r.pool.dex) && r.pool.id === pid);
      };
      const ownerL = ownerHex.toLowerCase();
      const ownerAse = (() => { try { return String(toAseAddress(ownerHex)); } catch { return ownerHex; } })();
      const [auraTrades, idxLegs, awsTrades] = await Promise.all([
        queryClient.fetchQuery({ queryKey: ["asedex-wallet-trades", ownerHex], queryFn: () => aurasIdx<{ trades?: AuraTrade[] }>(`/api/trades?wallet=${ownerHex}&limit=200`), staleTime: 15_000 }).then((d) => d?.trades ?? []),
        queryClient.fetchQuery({ queryKey: ["asedex-wallet-xfers", ownerHex], queryFn: () => indexerTransfers(ownerAse, 3), staleTime: 15_000 }),
        apiTrades({ wallet: ownerHex, limit: 200 }).catch(() => null),
      ]);
      // AWS trade rows → same AuraTrade shape the loop below consumes
      // (asedex-N for the canonical dex, bare id for legacy venues).
      for (const t of awsTrades?.trades ?? []) {
        const leg = String(t.dex ?? "").toLowerCase();
        const sell = String(t.side ?? "").toLowerCase() === "sell";
        auraTrades.push({
          poolId: isLegacyDex(leg) ? String(t.pool_id) : `asedex-${t.pool_id}`,
          trader: String(t.trader ?? ownerHex),
          tokenIn: sell ? String(t.token ?? "") : NATIVE,
          amountIn: String(t.amount_in ?? "0"),
          amountOut: String(t.amount_out ?? "0"),
          txHash: String(t.tx ?? ""),
          ts: Number(t.ts ?? 0),
        } as unknown as AuraTrade);
      }
      // Cross-source dedupe: `${tokenIn}|${amountIn}|${amountOut}|10min bucket`
      // — the same swap seen via indexer + per-pool chain reads merges once.
      const swapSigs = new Set<string>();
      const sigOf = (tokenIn: string, amountIn: string, amountOut: string, ts: number) =>
        `${tokenIn.toLowerCase()}|${amountIn}|${amountOut}|${Math.round(ts / 600)}`;
      for (const t of auraTrades) {
        userLogNoteTrade(ownerHex, t);
        if (t.txHash) seenTx.add(String(t.txHash));
        const row = rowForIndexerTrade(t);
        if (!row) continue;
        const base = row.pool.token0 === NATIVE ? row.asset1 : row.asset0;
        const quote = row.pool.token0 === NATIVE ? row.asset0 : row.asset1;
        const tokenIn = String(t.tokenIn || "");
        const amtIn = safeBig(t.amountIn || "0"), amtOut = safeBig(t.amountOut || "0");
        const inIsBase = tokenIn.toLowerCase() === base.address.toLowerCase();
        const baseAmt = Number(inIsBase ? amtIn : amtOut) / 10 ** base.decimals;
        const quoteAmt = Number(inIsBase ? amtOut : amtIn) / 10 ** quote.decimals;
        out.push({
          trader: ownerHex, tokenIn, amountIn: amtIn.toString(), amountOut: amtOut.toString(),
          price: Number(t.price || 0), ts: toSec(Date.parse(String(t.ts || "")) || 0), volumeAseWei: "0",
          row, side: inIsBase ? "Sell" : "Buy", base, quote, baseAmt, quoteAmt,
          px: baseAmt > 0 ? quoteAmt / baseAmt : 0,
          txHash: t.txHash ? String(t.txHash) : undefined,
        });
        swapSigs.add(sigOf(tokenIn, amtIn.toString(), amtOut.toString(), toSec(Date.parse(String(t.ts || "")) || 0)));
      }
      // Explorer transfers → swap reconstruction: one asset out + a different
      // asset in = a trade (DEX swap, bonding buy/sell, token↔token). Pool-less
      // entries still render (no pair link) — pad buys show in history at last.
      if (idxLegs) {
        const assetOf = (l: IndexerLeg): { key: string; asset: Asset } | null => {
          if (l.kind === "native" || !l.token) return { key: NATIVE, asset: ASE_ASSET };
          try {
            const h = toHexAddress(String(l.token)).toLowerCase();
            if (!/^0x[0-9a-f]{40}$/i.test(h) || h === NATIVE) return null;
            const fromRow = allRows.flatMap((r) => [r.asset0, r.asset1]).find((a) => a.address.toLowerCase() === h);
            return { key: h, asset: fromRow ?? assetSSRead()[h] ?? { address: h, name: l.token_name || "Unknown token", symbol: l.symbol || "?", decimals: l.decimals ?? 18 } };
          } catch { return null; }
        };
        const byTx = new Map<string, IndexerLeg[]>();
        for (const l of idxLegs) {
          const h = String(l.tx_hash || "");
          if (!h || seenTx.has(h)) continue;
          const arr = byTx.get(h) ?? [];
          arr.push(l);
          byTx.set(h, arr);
        }
        for (const [txHash, legs] of byTx) {
          const ins = new Map<string, bigint>(), outs = new Map<string, bigint>(), meta = new Map<string, Asset>();
          let tsMs = 0;
          for (const l of legs) {
            const a = assetOf(l);
            if (!a) continue;
            meta.set(a.key, a.asset);
            tsMs = tsMs || Number(l.timestamp || 0);
            let v = 0n;
            try { v = safeBig(String(l.value || "0")); } catch { }
            if (String(l.from_addr || "").toLowerCase() === ownerL) outs.set(a.key, (outs.get(a.key) ?? 0n) + v);
            if (String(l.to_addr || "").toLowerCase() === ownerL) ins.set(a.key, (ins.get(a.key) ?? 0n) + v);
          }
          // Net the flows — refund/dust legs of the same asset cancel out, so
          // only the real spent/received assets remain.
          for (const k of new Set([...ins.keys(), ...outs.keys()])) {
            const net = (ins.get(k) ?? 0n) - (outs.get(k) ?? 0n);
            if (net > 0n) { ins.set(k, net); outs.delete(k); }
            else if (net < 0n) { outs.set(k, -net); ins.delete(k); }
            else { ins.delete(k); outs.delete(k); }
          }
          // 1 out + 1 in = swap. Multi-asset txs (LP add/remove, batch sends)
          // don't fit Buy/Sell — Orders/positions views cover those.
          if (ins.size !== 1 || outs.size !== 1) continue;
          const inKey = [...ins.keys()][0]!, outKey = [...outs.keys()][0]!;
          const inAsset = meta.get(inKey)!, outAsset = meta.get(outKey)!;
          const row = allRows.find((r) => {
            const s = new Set([r.asset0.address.toLowerCase(), r.asset1.address.toLowerCase()]);
            return s.has(inKey) && s.has(outKey);
          });
          // Convention: the non-native leg is base; receiving base = Buy.
          const base = inKey === NATIVE ? outAsset : inAsset;
          const quote = base === inAsset ? outAsset : inAsset;
          const side = base === inAsset ? "Buy" : "Sell";
          const baseWei = side === "Buy" ? ins.get(inKey)! : outs.get(outKey)!;
          const quoteWei = side === "Buy" ? outs.get(outKey)! : ins.get(inKey)!;
          const baseAmt = Number(baseWei) / 10 ** base.decimals;
          const quoteAmt = Number(quoteWei) / 10 ** quote.decimals;
          const ts = toSec(tsMs);
          const sig = sigOf(outKey, outs.get(outKey)!.toString(), ins.get(inKey)!.toString(), ts);
          if (swapSigs.has(sig)) { seenTx.add(txHash); continue; }
          swapSigs.add(sig);
          seenTx.add(txHash);
          userLogNoteTrade(ownerHex, {
            poolId: row ? poolKey(row.pool.dex, row.pool.id) : undefined,
            side: side.toLowerCase(), tokenIn: outKey, tokenOut: inKey,
            amountIn: outs.get(outKey)!.toString(), amountOut: ins.get(inKey)!.toString(),
            txHash, ts: ts * 1000,
          });
          out.push({
            trader: ownerHex, tokenIn: outKey, amountIn: outs.get(outKey)!.toString(), amountOut: ins.get(inKey)!.toString(),
            price: 0, ts, volumeAseWei: "0",
            row, side, base, quote, baseAmt, quoteAmt,
            px: baseAmt > 0 ? quoteAmt / baseAmt : 0,
            txHash,
          });
        }
      }
      // No per-pool recentSwaps scan — apiTrades?wallet already journaled
      // every dex trade for this wallet.
      const walletRows: PoolRow[] = [];
      const poolRaws: unknown[] = [];
      for (const [ri, row] of walletRows.entries()) {
        const raw = poolRaws[ri];
        if (raw === undefined || raw === null) continue;
        try {
          const parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as { swaps?: { trader?: string; tokenIn?: string; amountIn?: string; amountOut?: string; createdTs?: string }[] };
          const base = row.pool.token0 === NATIVE ? row.asset1 : row.asset0;
          const quote = row.pool.token0 === NATIVE ? row.asset0 : row.asset1;
          for (const s of parsed.swaps ?? []) {
            if (String(s.trader || "").toLowerCase() !== ownerHex.toLowerCase()) continue;
            const tokenIn = String(s.tokenIn || "");
            const amtIn = safeBig(s.amountIn || "0"), amtOut = safeBig(s.amountOut || "0");
            const ts = toSec(Number(safeBig(s.createdTs || "0")));
            // Same swap already came through an indexed source — skip it.
            const sig = sigOf(tokenIn, amtIn.toString(), amtOut.toString(), ts);
            if (swapSigs.has(sig)) continue;
            swapSigs.add(sig);
            const inIsBase = tokenIn.toLowerCase() === base.address.toLowerCase();
            const baseAmt = Number(inIsBase ? amtIn : amtOut) / 10 ** base.decimals;
            const quoteAmt = Number(inIsBase ? amtOut : amtIn) / 10 ** quote.decimals;
            out.push({
              trader: String(s.trader || ""), tokenIn, amountIn: amtIn.toString(), amountOut: amtOut.toString(),
              price: 0, ts, volumeAseWei: "0",
              row, side: inIsBase ? "Sell" : "Buy", base, quote, baseAmt, quoteAmt,
              px: baseAmt > 0 ? quoteAmt / baseAmt : 0,
            });
          }
        } catch { }
      }
      // Journaled app-side swaps not yet visible via indexer/chain — show them
      // immediately in history instead of waiting for the indexer to catch up.
      for (const t of userLogTrades(ownerHex)) {
        if (t.txHash && seenTx.has(String(t.txHash))) continue;
        const tokenIn = String(t.tokenIn || "");
        const amtIn = safeBig(t.amountIn || "0"), amtOut = safeBig(t.amountOut || "0");
        const ts = toSec(Number(t.ts || 0));
        const sig = sigOf(tokenIn, amtIn.toString(), amtOut.toString(), ts);
        if (swapSigs.has(sig)) continue;
        const row = allRows.find((r) => poolKey(r.pool.dex, r.pool.id) === t.poolId);
        if (!row) continue;
        const inIsBase = tokenIn.toLowerCase() === row.asset0.address.toLowerCase();
        const base = inIsBase ? row.asset0 : row.asset1;
        const quote = inIsBase ? row.asset1 : row.asset0;
        const baseAmt = Number(inIsBase ? amtIn : amtOut) / 10 ** base.decimals;
        const quoteAmt = Number(inIsBase ? amtOut : amtIn) / 10 ** quote.decimals;
        out.push({
          trader: ownerHex, tokenIn, amountIn: amtIn.toString(), amountOut: amtOut.toString(),
          price: 0, ts, volumeAseWei: "0",
          row, side: t.side === "sell" ? "Sell" : "Buy", base, quote, baseAmt, quoteAmt,
          px: baseAmt > 0 ? quoteAmt / baseAmt : 0,
          txHash: t.txHash ? String(t.txHash) : undefined,
        });
        swapSigs.add(sig);
        if (t.txHash) seenTx.add(String(t.txHash));
      }
      return out.sort((a, b) => b.ts - a.ts);
    }
  });

  // Bonding-curve buys — dex swap history alone misses pre-migration entries,
  // so pad tokens would never get an avg-paid. recentTrades is per-launch.
  const myPadBuys = useQuery({
    // Per-owner key — embedding the held-token list minted a new persisted
    // copy every time a token was added. Held-token changes refresh it via
    // the owner-event invalidation instead.
    queryKey: ["asedex-pad-buys", ownerHex],
    enabled: Boolean(ownerHex && PAD && view === "wallet" && (heldTokens.data ?? []).some((t) => t.fromPad)),
    // Pad cost basis moves rarely — a ~60-call recentTrades batch must not
    // re-fire on a 60s stale; removed from OWNER_ROOTS so events don't drive it.
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const out: Record<string, { ase: number; qty: number }> = {};
      const padTokens = (heldTokens.data ?? []).filter((t) => t.fromPad);
      if (!padTokens.length) return out;
      const want = new Map(padTokens.map((t) => [`pad:${t.address.toLowerCase()}`, t]));
      // Wallet trades feed already carries pad curve buys server-side
      // (trades.dex = "pad:<token>") — cost basis is a filter, not a chain read.
      const d = await apiTrades({ wallet: ownerHex, limit: 1000 }).catch(() => null);
      for (const tr of d?.trades ?? []) {
        const t = want.get(String(tr.dex ?? "").toLowerCase());
        if (!t || String(tr.side ?? "").toLowerCase() !== "buy") continue;
        const cur = out[t.address] ?? { ase: 0, qty: 0 };
        cur.ase += Number(safeBig(tr.ase_wei ?? tr.amount_in ?? "0")) / 1e18;
        cur.qty += Number(safeBig(tr.amount_out || tr.amount_in || "0")) / 10 ** t.decimals;
        out[t.address] = cur;
      }
      return out;
    }
  });

  // Pad curve prices — bonding tokens have no dex pool, so asePriceByToken
  // can't price them at all. /api/launches carries price_native (spotPriceWei)
  // per indexed launch; warm launch records cover whatever isn't indexed yet.
  const padCurvePrices = useQuery({
    queryKey: ["pad-curve-prices"],
    enabled: view === "wallet",
    staleTime: 45_000,
    refetchInterval: 3_000,
    queryFn: async () => {
      const m = new Map<string, number>();
      const d = await apiLaunches("all", 5000).catch(() => null);
      for (const l of d?.launches ?? []) {
        const p = Number(l.price_native);
        if (p > 0) m.set(String(l.token).toLowerCase(), p / 1e18);
      }
      return m;
    }
  });
  // Held-token unit price (ASE): deepest dex pool wins; un-migrated pad
  // tokens fall back to their live bonding-curve spot.
  const heldPxOf = (t: HeldToken) => {
    const hit = asePriceByToken.get(t.address) ?? asePriceByToken.get(t.address.toLowerCase());
    if (hit) {
      // Dust-pool guard: when the pricing pool's whole token reserve is a
      // vanishing fraction of the held balance, the implied unit price is
      // untradeable (seeded-dust pools mint fantasy valuations). Real whales
      // sit well under 1000x pool depth; dust pools run 1e6-1e8x.
      const bal = Number(safeBig(t.balance)) / 10 ** t.decimals;
      const res = Number(hit.tokRes) / 10 ** t.decimals;
      if (res <= 0 || bal > res * 1000) return 0;
      // Personal-mcap bound: the held balance is a subset of supply, so
      // price × balance is a FLOOR on real market cap. price × 25k ASASE =
      // 157B ASE (>1B ceiling) is provably fake — no supply data needed.
      if (hit.price * Math.max(bal, res) > MAX_IMPLIED_MCAP_ASE) return 0;
      return hit.price;
    }
    const l = asepadPeekLaunchRecord(t.address);
    if (l && l.status !== "MIGRATED") {
      const p = Number(safeBig(l.spotPriceWei || "0")) / 1e18;
      if (p > 0) return p;
    }
    return padCurvePrices.data?.get(t.address.toLowerCase()) ?? 0;
  };

  // Indexer cost basis — /api/positions covers buys on BOTH venues (AseDex +
  // AuraDex) in one call, surviving storage wipes that drop the local journal.
  // Local swap aggregation only fills tokens the indexer hasn't indexed yet,
  // and pad bonding buys blend on top (the dex indexer can't see the curve).
  const idxPositions = useQuery({
    queryKey: ["asedex-idx-positions", ownerHex],
    enabled: Boolean(ownerHex && view === "wallet"),
    refetchInterval: 3_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const d = await aurasIdx<{ positions?: { token: string; avgPriceASE: number; tokensBought: number; aseSpent: number; buys: number }[] }>(
        `/api/positions?wallet=${ownerHex}`);
      const m = new Map<string, { ase: number; qty: number }>();
      for (const p of d?.positions ?? []) {
        const a = String(p.token || "").toLowerCase();
        if (/^0x[0-9a-f]{40}$/.test(a) && Number(p.tokensBought) > 0) {
          m.set(a, { ase: Number(p.aseSpent) || 0, qty: Number(p.tokensBought) });
        }
      }
      return m;
    }
  });

  // Cost basis per token: Σ ASE-equivalent spent on buys ÷ Σ tokens bought.
  // Token↔token buys convert the quote leg via its own ASE price; ASE legs are direct.
  const avgPaidByToken = useMemo(() => {
    const idx = idxPositions.data ?? new Map<string, { ase: number; qty: number }>();
    const acc = new Map<string, { ase: number; qty: number }>();
    for (const s of mySwaps.data ?? []) {
      if (s.side !== "Buy" || s.baseAmt <= 0 || !s.quote?.address) continue;
      if (idx.has(s.base.address.toLowerCase())) continue; // indexer already counted these buys
      const quoteAse = s.quote.address === NATIVE ? s.quoteAmt : s.quoteAmt * (asePriceByToken.get(s.quote.address)?.price ?? 0);
      const cur = acc.get(s.base.address.toLowerCase()) ?? { ase: 0, qty: 0 };
      cur.ase += quoteAse; cur.qty += s.baseAmt;
      acc.set(s.base.address.toLowerCase(), cur);
    }
    for (const [addr, v] of idx) acc.set(addr, { ase: v.ase, qty: v.qty });
    for (const [addr, v] of Object.entries(myPadBuys.data ?? {})) {
      const cur = acc.get(addr.toLowerCase()) ?? { ase: 0, qty: 0 };
      cur.ase += v.ase; cur.qty += v.qty;
      acc.set(addr.toLowerCase(), cur);
    }
    const out = new Map<string, number>();
    for (const [addr, v] of acc) if (v.qty > 0) out.set(addr, v.ase / v.qty);
    return out;
  }, [mySwaps.data, myPadBuys.data, idxPositions.data, rows]); // eslint-disable-line react-hooks/exhaustive-deps
  // Price color from the last trade's direction — flashes green/red for ~3s
  // after the trade, then falls back (CEX-style tick coloring).
  const dirFlash = (lastBuy: boolean | null, lastTs: number, fallback: string) =>
    lastBuy !== null && lastTs > 0 && now - lastTs * 1000 <= 3000
      ? (lastBuy ? "text-emerald-300" : "text-red-300")
      : fallback;
  const ago = (ts: number) => ts <= 0 ? "-" : (() => { const s = Math.max(0, Math.floor(Date.now() / 1000) - ts); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`; })();
  const currentSpot = selected && selectedInput && selectedOutput && !synthPool
    ? humanPrice(
        selectedInput.address === selected.token0 ? selected.reserve0 : selected.reserve1,
        selectedInput.decimals,
        selectedOutput.address === selected.token0 ? selected.reserve0 : selected.reserve1,
        selectedOutput.decimals
      )
    : 0;
  // Spot price expressed in the unit the user is typing in the limit field:
  // ASE or USD per token for ASE pools, raw out/in rate for token↔token pools.
  const spotInLimitUnit = (() => {
    if (pairPriceAse > 0 && pairAsset) return limitUnit === "USD" ? pairPriceAse * aseUsd : pairPriceAse;
    return currentSpot;
  })();
  // How far the entered limit rate sits from the live pool rate (out/in basis).
  const limitVsSpot = limitRate !== null && currentSpot > 0 ? (limitRate / currentSpot - 1) * 100 : null;

  // Quote-side pool depth — the ASE leg for ASE pairs, the quote token's leg
  // for token↔token pairs. Never label a token reserve as ASE.
  const poolQuoteReserve = selected && pairQuote && !synthPool
    ? safeBig((pairQuote.address === selected.token0 ? selected.reserve0 : selected.reserve1) || "0")
    : 0n;
  // Market cap / FDV — circulating = total supply − burned (0x0 + dead) −
  // tokens escrowed in AseLock (locks + unclaimed vesting). Pooled tokens ARE
  // circulating (tradeable), so adding/removing LP never moves the cap. Caps
  // price the TOKEN, not this pair: the base's own deepest ASE pool is the
  // most direct market (EDR has EDR/ASE even when viewing EDR/Blast).
  // Fallback: implied through this pair's quote leg (tokens whose only
  // market is a token↔token pair). No path → caps show in quote units.
  const ownAsePx = pairAsset
    ? (asePriceByToken.get(pairAsset.address)?.price ?? pairBaseAsePx)
    : 0;
  const pairAsePx = ownAsePx > 0 ? ownAsePx : pairPriceAse;
  // Display pair price in ASE terms — implied through the quote leg when the
  // quote has an ASE path (direct pool or hop-priced); else the base token's
  // own ASE market covers pairs whose quote leg is unpriced. 0 → quote units.
  const pairPxAse = pairPriceAse > 0 ? pairPriceAse : ownAsePx;
  const pairPxUsd = pairPxAse > 0 && aseUsd > 0 ? pairPxAse * aseUsd : 0;
  // Chart scale — re-denominates the pool's quote-priced tape onto the same
  // display basis as the header (display price ÷ raw pool ratio), so the
  // axis, legend and order lines can never disagree with the header.
  const chartScale = priceUnit === "USD" && pairPxUsd > 0 && pairPriceQuote > 0
    ? pairPxUsd / pairPriceQuote
    : priceUnit === "ASE" && pairPxAse > 0 && pairPriceQuote > 0
      ? pairPxAse / pairPriceQuote
      : 1;
  const chartUnit = chartScale === 1 ? (pairQuote?.symbol ?? "ASE") : priceUnit;
  // Pool volume is ASE-denominated on-chain — USD view scales it by the rate.
  const volScale = chartUnit === "USD" && aseUsd > 0 ? aseUsd : 1;
  // totalSupply lands in mixed units — chain reads are raw (wei-scaled) but
  // indexer/factory rows carry the creator-entered human supply. Raw is
  // always ≥ 10^decimals, human never is, so threshold on that.
  const pairSupply = (() => {
    const raw = pairAssetFull?.totalSupply ? safeBig(pairAssetFull.totalSupply) : 0n;
    if (raw <= 0n) return 0;
    const dec = BigInt(pairAssetFull?.decimals ?? 18);
    return raw >= 10n ** dec ? Number(raw) / 10 ** Number(dec) : Number(raw);
  })();
  const pairBurnedUnits = pairAssetFull && pairBurned.data
    ? Number(pairBurned.data) / 10 ** pairAssetFull.decimals
    : 0;
  const circSupply = Math.max(0, pairSupply - pairBurnedUnits);
  const fdvAse = pairAsePx * pairSupply;
  const mcAse = pairAsePx * circSupply;
  // Same caps denominated in the pair's quote token — used when no ASE path.
  const fdvQuote = pairPriceQuote * pairSupply;
  const mcQuote = pairPriceQuote * circSupply;
  // Depleted pool flag — same rule rows use (base dust or quote leg under the
  // ~100 ASE floor): implied spot is marginal math, not market truth.
  const depletedPool = Boolean(selected && pairAsset && pairQuote && !synthPool &&
    poolDepleted(selected, pairAsset.address, pairQuote.address, pairQuoteFull?.decimals ?? 18, asePriceByToken.get(pairQuote.address)?.price ?? 0));
  // 24h change only means something while the pool quotes a live spot — a
  // drained pool keeps its indexer change24 and reads "+5,847,951%" garbage.
  const pairChange = swaps.length && !depletedPool && pairPriceQuote > 0 ? dayStats.change : null;
  // Top-10 concentration — same math as the holders tab's share column.
  const top10Pct = useMemo(() => {
    const supply = holders.data?.supply;
    if (!supply || supply <= 0n || !holderRows.length) return null;
    const top = holderRows.slice(0, 10).reduce((a, h) => a + h.balance, 0n);
    return Number(top * 10000n / supply) / 100;
  }, [holderRows, holders.data]);
  // Buy share of the recent tape — the green/red ratio bar in the trade view.
  const pairBuyRatio = useMemo(() => {
    if (!pairQuote || !swaps.length) return null;
    const q = pairQuote.address.toLowerCase();
    const recent = swaps.slice(0, 30);
    const buys = recent.filter((s) => s.tokenIn.toLowerCase() === q).length;
    return Math.round((buys / recent.length) * 100);
  }, [swaps, pairQuote]);
  const minReceived = (() => {
    try { return quoteNetWei && selectedOutput ? formatUnits(quoteNetWei * (10000n - slipBps(slippage || "1")) / 10000n, selectedOutput.decimals) : "-"; }
    catch { return "-"; }
  })();

  function openPair(key: string, initialTab: "swap" | "limit" | "dca" = "swap") {
    setSelKey(key);
    setTab(initialTab);
    setAmount("");
    setError(null);
    setNotice(null);
    gotoView("terminal", allRows.find((r) => poolKey(r.pool.dex, r.pool.id) === key));
  }
  // Stable dispatcher for memoized market rows — reads the latest openPair so
  // the onOpen prop keeps identity across renders (a fresh fn per render
  // would defeat the row memo).
  const openPairRef = useRef(openPair);
  useEffect(() => { openPairRef.current = openPair; });
  const openPairStable = useCallback((key: string) => { openPairRef.current(key); }, []);
  // Pair-picker rows: close the modal AND jump to the pair — one stable prop
  // so the memoized rows never re-render on modal state churn.
  const pickPair = useCallback((key: string) => { setPairPickOpen(false); openPairRef.current(key); }, []);

  // Radar rows highlight on hover only — no keyboard hotkeys.
  useEffect(() => { setHotIdx(0); }, [poolTab, radarSearch, radarVenue, poolsSearch, view]);

  // Price impact for the current swap quote.
  const priceImpact = (() => {
    try {
      if (!selected || !selectedInput || !selectedOutput || !poolInWei || !quoteOut) return 0;
      const rin = safeBig(selectedInput.address === selected.token0 ? selected.reserve0 : selected.reserve1);
      const rout = safeBig(selectedOutput.address === selected.token0 ? selected.reserve0 : selected.reserve1);
      if (rin <= 0n || rout <= 0n) return 0;
      const expected = poolInWei * rout / rin;
      if (expected <= 0n) return 0;
      return Number(quoteOut - expected) / Number(expected) * 100;
    } catch { return 0; }
  })();
  const bigImpact = priceImpact <= -15;
  const [impactOk, setImpactOk] = useState(false);
  const sortedOrders = [...(myOrders.data ?? [])].sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || Number(b.id) - Number(a.id));
  // Buy = the order spends the pool's quote leg (ASE when paired, else
  // token1) to acquire the base. Sell = spends the base/unknown leg.
  const orderSideOf = (o: Order): "buy" | "sell" => {
    const row = [...allRows, ...legacyRows].find((r) => poolKey(r.pool.dex, r.pool.id) === poolKey(o.dex, o.poolId));
    const quote = row ? (row.pool.token0 === NATIVE || row.pool.token1 === NATIVE ? NATIVE : row.pool.token1) : NATIVE;
    return String(o.tokenIn || "").toLowerCase() === String(quote).toLowerCase() ? "buy" : "sell";
  };
  const orderRowsFiltered = sortedOrders.filter((o) =>
    (orderTab === "all" || (orderTab === "open" ? o.status === "open" : o.status === "filled"))
    && (orderSide === "all" || orderSideOf(o) === orderSide));
  const openOrderRows = sortedOrders.filter((o) => o.status === "open");
  const closedOrderRows = sortedOrders.filter((o) => o.status !== "open");

  // Order rows — shared by the standalone panel (radar/wallet views) and the
  // terminal's "My orders" tab.
  function orderRows(list: Order[], empty?: string) {
    if (list.length === 0) {
      return (
        <div className="p-5 text-center text-sm text-white/70">
          {wallet.address
            ? (empty ?? "No orders here.")
            : "Connect your wallet to see your orders."}
        </div>
      );
    }
    return (
      <>
        {list.slice(0, 25).map((order) => {
            const row = allRows.find((r) => r.pool.dex === order.dex && r.pool.id === order.poolId);
            const inAsset = row ? [row.asset0, row.asset1].find((a) => a.address === order.tokenIn) : undefined;
            const outAsset = row ? [row.asset0, row.asset1].find((a) => a.address !== order.tokenIn) : undefined;
            const isDca = order.kind === "DCA";
            const open = order.status === "open";
            // Recover the limit price the user set: quote per base, from the
            // escrowed input and the order's minOut — same unit the depth uses.
            const baseAsset = row ? (row.asset0.address === NATIVE ? row.asset1 : row.asset0) : undefined;
            const quoteAsset = row && baseAsset ? [row.asset0, row.asset1].find((a) => a.address !== baseAsset.address) : undefined;
            const side = quoteAsset ? (order.tokenIn === quoteAsset.address ? "Buy" : "Sell") : "?";
            const inUnits = inAsset ? Number(safeBig(order.totalIn)) / 10 ** inAsset.decimals : 0;
            const outUnits = outAsset ? Number(safeBig(order.minOut)) / 10 ** outAsset.decimals : 0;
            const baseUnits = inAsset?.address === baseAsset?.address ? inUnits : outUnits;
            const quoteUnits = inAsset?.address === quoteAsset?.address ? inUnits : outUnits;
            const limitPx = baseUnits > 0 ? quoteUnits / baseUnits : 0;
            const pxLabel = limitPx > 0 && baseAsset && quoteAsset
              ? quoteAsset.address === NATIVE
                ? `${fmtTiny(limitPx, 5)} ASE${aseUsd > 0 ? ` ≈ ${limitPx * aseUsd >= 1000 ? `$${fmtCompact(limitPx * aseUsd)}` : fmtUsd(limitPx * aseUsd)}` : ""}`
                : `${fmtTiny(limitPx, 5)} ${quoteAsset.symbol}/${baseAsset.symbol}`
              : "-";
            return (
              <div key={`${order.dex}:${order.id}`} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-white/[0.05] px-4 py-3.5", !open && "opacity-55")}>
                <span className={cn("rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", isDca ? "bg-violet-500/15 text-violet-300" : "bg-sky-500/15 text-sky-300")}>{order.kind}</span>
                <span className={cn("rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", side === "Buy" ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300")}>{side}</span>
                <span className="text-sm font-medium text-white/85">
                  {baseAsset && quoteAsset ? `${baseAsset.symbol}/${quoteAsset.symbol}` : `pool #${order.poolId}`}
                </span>
                {isDca ? (
                  <>
                    <span className="font-mono text-sm text-white/80">
                      {inAsset ? fmtWeiCompact(order.totalIn, inAsset.decimals) : order.totalIn} {inAsset?.symbol ?? ""} → {outAsset?.symbol ?? ""}
                    </span>
                    <span className="text-xs text-white/70">{order.slicesDone}/{order.slicesTotal} slices · every {Number(order.intervalSec) / 60}m</span>
                  </>
                ) : (
                  <span className="min-w-0 font-mono text-xs text-white/75">
                    <span className="text-white/90">@ {pxLabel}</span>
                    {" · "}
                    {inAsset ? fmtWeiCompact(order.totalIn, inAsset.decimals) : order.totalIn} {inAsset?.symbol ?? ""} → ≥{outAsset ? fmtWeiCompact(order.minOut, outAsset.decimals) : order.minOut} {outAsset?.symbol ?? ""}
                  </span>
                )}
                {open ? (
                  <Button variant="ghost" size="sm" className="ml-auto h-7 px-2.5 text-xs text-red-300 hover:text-red-200" disabled={Boolean(busy)} onClick={() => void cancelOrder(order)}>
                    Cancel
                  </Button>
                ) : (
                  <span className={cn("ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", order.status === "filled" ? "bg-emerald-500/15 text-emerald-300" : "bg-white/[0.06] text-white/70")}>{order.status}</span>
                )}
              </div>
            );
          })}
      </>
    );
  }

  // Recent-trades table — shared by the desktop tape column and the Trades tab
  // (which stays available on mobile where the tape is hidden).
  const renderTradesList = (scrollCls: string) => (
    <>
      <div className="flex items-center gap-3 border-b border-white/[0.07] px-3 py-2">
        <span className="flex gap-0.5 rounded-md bg-white/[0.05] p-0.5">
          {([["all", "All"], ["mine", "My trades"]] as const).map(([f, l]) => (
            <button key={f} onClick={() => setTradesMine(f === "mine")}
              className={cn("rounded px-2 py-0.5 text-[10px] font-medium transition", (f === "mine") === tradesMine ? "bg-white/10 text-white" : "text-white/60 hover:text-white/70")}>{l}</button>
          ))}
        </span>
      </div>
      <div className={cn("overflow-auto", scrollCls)}>
        <div className="min-w-[440px]">
        <div className="grid grid-cols-[1fr_0.7fr_1fr_1fr_1fr_1.3fr] gap-2 border-b border-white/[0.05] px-4 py-2 text-[9px] uppercase tracking-wider text-white/50">
          <span>Time</span><span>Side</span><span className="text-right">{trimSym(pairQuoteFull?.symbol ?? "ASE")}</span><span className="text-right">Price</span><span className="text-right">Amount</span><span className="text-right">Wallet</span>
        </div>
        {[...swaps].filter((s) => !tradesMine || (ownerHex && s.trader.toLowerCase() === ownerHex.toLowerCase())).reverse().slice(0, 80).map((s, i) => {
          const quoteAddr = (pairQuoteFull ?? pairQuote)?.address.toLowerCase() ?? NATIVE;
          const buy = s.tokenIn.toLowerCase() === quoteAddr;
          const bDec = pairAssetFull?.decimals ?? 18, qDec = pairQuoteFull?.decimals ?? 18;
          const baseWei = safeBig(buy ? s.amountOut : s.amountIn);
          const quoteWei = safeBig(buy ? s.amountIn : s.amountOut);
          const baseUnits = Number(baseWei) / 10 ** bDec, quoteUnits = Number(quoteWei) / 10 ** qDec;
          // Price derives from the actual swap legs — an inverted or
          // mis-scaled indexer price can never leak through. The spot guard
          // clamps anything that still deviates absurdly from the pool rate.
          let px = baseUnits > 0 ? quoteUnits / baseUnits : s.price;
          if (pairPriceQuote > 0 && px > 0 && (px / pairPriceQuote > 8 || px / pairPriceQuote < 0.125)) px = pairPriceQuote;
          return (
            <div key={i} className="grid grid-cols-[1fr_0.7fr_1fr_1fr_1fr_1.3fr] gap-2 border-b border-white/[0.03] px-4 py-1.5 font-mono text-[11px]">
              <span className="text-white/60">{(() => { const age = Date.now() - s.ts * 1000; if (age >= 86400000) { const d = Math.floor(age / 86400000); return `${d}d ago`; } return new Date(s.ts * 1000).toLocaleTimeString(); })()}</span>
              <span className={buy ? "text-emerald-300" : "text-red-300"}>{buy ? "BUY" : "SELL"}</span>
              <span className={cn("text-right", buy ? "text-red-300/80" : "text-emerald-300/80")}>{quoteUnits > 0 ? `${buy ? "-" : "+"}${fmtCompact(quoteUnits)} ${trimSym(pairQuoteFull?.symbol ?? "ASE")}` : "-"}</span>
              <span className="text-right text-white/70"><PricePower text={fmtPx(px)} /></span>
              <span className={cn("text-right", buy ? "text-emerald-300/80" : "text-red-300/80")}>{baseUnits > 0 ? `${buy ? "+" : "-"}${fmtCompact(baseUnits)} ${trimSym(pairAssetFull?.symbol ?? "")}` : "-"}</span>
              <a href={explorerAddressUrl(s.trader)} target="_blank" rel="noreferrer" className="text-right text-white/60 transition hover:text-accent" title={s.trader}>{namedAddr(s.trader, addrNames, shortenAddress)}</a>
            </div>
          );
        })}
        {!swaps.filter((s) => !tradesMine || (ownerHex && s.trader.toLowerCase() === ownerHex.toLowerCase())).length ? (
          <p className="p-5 text-center text-[11px] text-white/50">
            {swaps.length ? (wallet.address ? "No swaps from this wallet on this pair yet." : "Connect your wallet to see your trades.") : "No swaps yet."}
          </p>
        ) : null}
        </div>
      </div>
    </>
  );

  // Order-book ladder — asks over mid price over bids. Shared by the Depth tab
  // and the mobile trade view (which passes maxRows for a compact book).
  const renderDepthBook = (maxRows?: number, dense?: boolean) => (
    book.asks.length === 0 && book.bids.length === 0 ? (
      <p className={cn("py-4 text-center text-white/50", dense ? "px-2 text-[9px]" : "px-3 text-[11px]")}>No open limit orders on this pair yet.</p>
    ) : (
      <>
        <div>
          {[...book.asks].reverse().slice(0, maxRows ?? book.asks.length).map((a, i) => {
            const depth = Math.min(100, (a.cum / (book.asks.at(-1)?.cum || 1)) * 100);
            return (
              <div key={i} className={cn("relative flex justify-between font-mono", dense ? "px-2 py-0.5 text-[9px]" : "px-3 py-1 text-[11px]", a.mine && "bg-accent/10")}>
                <span className="absolute inset-y-0 right-0 bg-red-500/[0.10]" style={{ width: `${depth}%` }} />
                <span className="relative text-red-300"><PricePower text={fmtBookPx(a.price)} /></span>
                <span className="relative text-white/70">{fmtCompact(a.amount)}{a.mine ? " •" : ""}</span>
              </div>
            );
          })}
        </div>
        <div className={cn("border-y border-white/[0.07] bg-white/[0.03] text-center font-mono", dense ? "px-2 py-1 text-[10px]" : "px-3 py-1.5 text-[11px]")}>
          <span className="text-white/75">{pairPriceQuote > 0 ? <PricePower text={fmtBookPx(pairPriceQuote)} /> : "-"}</span>
          {book.asks.length && book.bids.length ? <span className="text-white/55"> · {((book.asks[0]!.price - book.bids[0]!.price) / book.bids[0]!.price * 100).toFixed(2)}%</span> : null}
        </div>
        <div>
          {book.bids.slice(0, maxRows ?? book.bids.length).map((b, i) => {
            const depth = Math.min(100, (b.cum / (book.bids.at(-1)?.cum || 1)) * 100);
            return (
              <div key={i} className={cn("relative flex justify-between font-mono", dense ? "px-2 py-0.5 text-[9px]" : "px-3 py-1 text-[11px]", b.mine && "bg-accent/10")}>
                <span className="absolute inset-y-0 left-0 bg-emerald-500/[0.10]" style={{ width: `${depth}%` }} />
                <span className="relative text-emerald-300"><PricePower text={fmtBookPx(b.price)} /></span>
                <span className="relative text-white/70">{fmtCompact(b.amount)}{b.mine ? " •" : ""}</span>
              </div>
            );
          })}
        </div>
      </>
    )
  );

  return (
    <OfficialTokensCtx.Provider value={officialTokens.data ?? EMPTY_TOKEN_SET}>
    <>
    <PageShell center title={VIEW_TITLES[view].label} titleImg={VIEW_TITLES[view].img} titleImgClassName="h-7 md:h-9" bare={detail || view === "wallet"} className="max-w-none" right={<LiveIndicator />}>
      <div className="mx-auto space-y-5">
        <Note scope="global" />
        {migratingToken && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          <span>AsePad migration in progress, token sells and liquidity unlock when it finishes.</span>
          <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => void finalizeMigration(migratingToken)}>{busy === "Finalizing migration…" ? busy : "Finalize migration"}</Button>
        </div>}
        {!DEX && <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">AseDex contract address is not configured.</div>}

        {/* ── top nav ── view switching lives in the rail / mobile hamburger ── */}
        <div className="grid grid-cols-1 items-center justify-items-center gap-2 md:grid-cols-[1fr_auto_1fr] md:gap-3">
          <div className="hidden md:block" />
          {view === "radar" ? (
            <div className="flex items-center gap-2 md:ml-auto">
              <div className="flex gap-1 rounded-lg bg-white/[0.05] p-0.5">
                {["0.5", "1", "2.5", "5"].map((v) => (
                  <button key={v} onClick={() => setBuySize(v)}
                    className={cn("rounded-md px-2.5 py-1 text-[10px] font-medium transition", buySize === v ? "bg-white/10 text-white" : "text-white/65 hover:text-white/70")}>{v} ASE</button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <AnimatePresence mode="wait" initial={false}>
        <motion.div key={view} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.16, ease: "easeOut" }}>
        {view === "markets" ? (
          /* ── Markets — every liquid pair, sortable ─────────────── */
          <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02]">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/[0.07] px-4 py-3">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">All markets <span className="font-mono text-white/60">({displayMarketRows.length})</span></h2>
              <div className="flex w-full flex-wrap items-center gap-3 sm:ml-auto sm:w-auto">
                <div className="flex gap-1 rounded-lg bg-white/[0.05] p-0.5">
                  {([...(favs.size > 0 ? [["fav", "Fav"] as const] : []), ["all", "All"], ["vol", "24h Trending"], ["gainers", "24h Gainers"], ["losers", "24h Losers"]] as const).map(([v, l]) => (
                    <button key={v} onClick={() => setMarketSort(v)}
                      className={cn("flex items-center gap-1 rounded-md px-3 py-1 text-[11px] font-medium transition", effMarketSort === v ? "bg-white/10 text-white" : "text-white/65 hover:text-white/70")}>
                      {v === "fav" ? <Star className="h-3 w-3 fill-amber-300 text-amber-300" /> : null}{l}
                    </button>
                  ))}
                </div>
                <div className="relative ml-auto min-w-0 flex-1 sm:ml-0 sm:flex-none">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/50" />
                  <Input value={marketSearch} onChange={(e) => setMarketSearch(e.target.value)} placeholder="Name, ticker or contract" className="h-8 w-full min-w-0 pl-8 text-xs sm:w-52" />
                </div>
              </div>
            </div>
            <div className="hidden grid-cols-[minmax(0,1.8fr)_1fr_0.8fr_1fr_1fr_1fr] gap-3 border-b border-white/[0.05] px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-white/50 md:grid">
              <span>Pair</span><span className="text-right">Price</span><span className="text-right">24h</span><span className="text-right">24h Vol</span><span className="text-right">Liquidity</span><span className="text-right">Mkt cap</span>
            </div>
            {pools.isPending || (legacyPools.isPending && !displayMarketRows.length) ? (
              <>
                <p className="px-4 py-2 text-[11px] font-medium text-white/55">{pools.isPending ? "Loading ASEDEX markets…" : "Loading AURAS markets…"}</p>
                {Array.from({ length: 8 }).map((_, i) => <PairRowSkeleton key={i} />)}
              </>
            ) : null}
            {marketPage.paged.map((row) => {
              const pk = poolKey(row.pool.dex, row.pool.id);
              const rst = statOf(row);
              const logoAddr = row.asset0.address === NATIVE ? row.asset1.address : row.asset0.address;
              return (
                <MarketListRow key={pk} row={row}
                  volRank={hotRanks.get(pk) ?? 0}
                  usdRate={aseUsdRate} priceMap={asePriceByToken} stat={rst} usd={priceUnit === "USD"}
                  burnedWei={marketBurned.data?.get(logoAddr) ?? 0n}
                  burnPct={burnPctOf(row)} burnShares={burnSharesOf(row)} burnTx={burnTxOf(row)} burnUrl={undefined}
                  priceCls={dirFlash(rst.lastBuy, rst.lastTs, "text-white/85")}
                  chgCls={dirFlash(rst.lastBuy, rst.lastTs, rst.change > 0 ? "text-emerald-300" : rst.change < 0 ? "text-red-300" : "text-white/50")}
                  lpLockId={lpLockIdOf(row)} tokLockId={tokLockIdOf(row)}
                  isFav={favs.has(pk)} onFav={toggleFav}
                  onOpen={openPairStable} />
              );
            })}
            {!pools.isPending && !legacyPools.isPending && !displayMarketRows.length ? <p className="p-6 text-center text-[11px] text-white/50">{marketSearch.trim() ? `No markets match "${marketSearch.trim()}".` : "No liquid markets yet."}</p> : null}
            <ListPager page={marketPage.page} pages={marketPage.pages} total={displayMarketRows.length} onPage={marketPage.setPage} />
          </div>
        ) : view === "radar" ? (
          <>
            {/* ── Radar screener ────────────────────────────── */}
            <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02]">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/[0.07] px-4 py-3">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold">New pairs <span className="font-mono text-white/60">({radarRows.length})</span></h2>
                <span className="text-[10px] text-white/50">Liquidity {priceUnit === "USD" ? aseWeiUsd(aseLiquidity) : `${fmtWeiCompact(aseLiquidity)} ASE`}</span>
                {legacyPools.isPending ? <span className="text-[10px] text-white/45">· AURAS pairs loading…</span> : null}
                <div className="flex w-full items-center gap-3 sm:ml-auto sm:w-auto">
                  <div className="flex gap-1 rounded-lg bg-white/[0.05] p-0.5">
                    {(["all", "current", "legacy"] as const).map((value) => (
                      <button key={value} onClick={() => setRadarVenue(value)}
                        className={cn("rounded-md px-3 py-1 text-[11px] font-medium transition", radarVenue === value ? "bg-white/10 text-white" : "text-white/65 hover:text-white/70")}>
                        {value === "all" ? "All" : value === "current" ? "ASEDEX" : "AURAS"}
                      </button>
                    ))}
                  </div>
                  <div className="relative ml-auto min-w-0 flex-1 sm:ml-0 sm:flex-none">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/50" />
                    <Input value={radarSearch} onChange={(e) => setRadarSearch(e.target.value)} placeholder="Search pairs" className="h-8 w-full min-w-0 pl-8 text-xs sm:w-44" />
                  </div>
                </div>
              </div>
              <div className="hidden grid-cols-[minmax(0,1.6fr)_minmax(0,0.7fr)_1fr_1fr_1fr_0.6fr_0.8fr_92px] gap-3 border-b border-white/[0.05] px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-white/50 md:grid">
                <span>Pair</span>
                <span>Dex</span>
                <span className="text-right">Price</span>
                <span className="text-right">24h Vol</span>
                <span className="text-right">LP</span>
                <span className="text-right">Trades</span>
                <span className="text-right">24h</span>
                <span />
              </div>
              {pools.isPending && !radarRows.length ? (
                <div className="space-y-px p-2">
                  <p className="px-3 py-2 text-[11px] font-medium text-white/55">Loading ASEDEX pairs…</p>
                  {Array.from({ length: 5 }).map((_, i) => <PairRowSkeleton key={i} />)}
                </div>
              ) : radarRows.length ? radarPage.paged.map((row, i) => {
                const nativeRes = safeBig(row.pool.token0 === NATIVE ? row.pool.reserve0 : row.pool.token1 === NATIVE ? row.pool.reserve1 : "0");
                const tokenRes = safeBig(row.pool.token0 === NATIVE ? row.pool.reserve1 : row.pool.token1 === NATIVE ? row.pool.reserve0 : "0");
                const logoAsset = row.asset0.address === NATIVE ? row.asset1 : row.asset0;
                const isAse = row.asset0.address === NATIVE || row.asset1.address === NATIVE;
                const price = humanPrice(tokenRes.toString(), logoAsset.decimals, nativeRes.toString(), 18);
                const quoteAsset = row.asset0.address === logoAsset.address ? row.asset1 : row.asset0;
                const quotePrice = isAse ? 0 : humanPrice(
                  row.asset0.address === logoAsset.address ? row.pool.reserve0 : row.pool.reserve1,
                  logoAsset.decimals,
                  row.asset0.address === logoAsset.address ? row.pool.reserve1 : row.pool.reserve0,
                  quoteAsset.decimals
                );
                // USD price for the row: direct ASE leg, else the token's own
                // ASE price from another pool, else routed through a quote
                // asset that itself has an ASE price.
                const logoAsePx = asePriceByToken.get(logoAsset.address)?.price ?? 0;
                const quoteAsePx = asePriceByToken.get(quoteAsset.address)?.price ?? 0;
                const usdPx = price > 0 ? price * aseUsdRate
                  : logoAsePx > 0 ? logoAsePx * aseUsdRate
                  : quotePrice > 0 && quoteAsePx > 0 ? quotePrice * quoteAsePx * aseUsdRate
                  : 0;
                const st = statOf(row);
                const hot = i === hotIdx;
                const empty = safeBig(row.pool.totalShares || "0") === 0n && !(Number(row.pool.tvlQuote) > 0);
                const rowDepleted = poolDepleted(row.pool, logoAsset.address, quoteAsset.address, quoteAsset.decimals, quoteAsePx);
                return (
                  <div key={poolKey(row.pool.dex, row.pool.id)}>
                  <div onClick={empty ? undefined : () => openPair(poolKey(row.pool.dex, row.pool.id))} onMouseEnter={() => setHotIdx(i)}
                    className={cn("grid w-full grid-cols-[minmax(0,1.6fr)_auto_auto] items-center gap-3 border-b border-white/[0.04] px-4 py-3 text-left transition md:grid-cols-[minmax(0,1.6fr)_minmax(0,0.7fr)_1fr_1fr_1fr_0.6fr_0.8fr_92px]",
                      empty ? "cursor-not-allowed opacity-50" : "cursor-pointer " + (hot ? "bg-accent/[0.06]" : "hover:bg-white/[0.03]"))}>
                    <span className="flex min-w-0 items-start gap-2.5">
                      <span className="relative shrink-0">
                        <TokenImg src={logoAsset.logoUrl} symbol={logoAsset.symbol} cls="h-9 w-9 rounded-lg border border-white/10 object-cover text-[10px]" />
                        {isAse ? <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-black/60 bg-[#0a0a0a] p-0.5"><AseLogo size={9} /></span> : null}
                      </span>
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-1.5 text-sm font-bold">
                          {logoAsset.symbol}
                          {logoAsset.fromPad && isAse ? <PadTag token={logoAsset.address} /> : null}
                          <OfficialTag addr={logoAsset.address} />
                          <LpBurnTag pct={burnPctOf(row)} shares={burnSharesOf(row)} tx={burnTxOf(row)} />
                          {!empty && rowDepleted ? <LowLiqTag /> : null}
                          {empty ? (
                            <span className="rounded-full border border-white/15 bg-white/[0.05] px-1.5 py-px text-[8px] font-bold uppercase tracking-wider text-white/45">No liquidity</span>
                          ) : safeBig(shareByPool.get(poolKey(row.pool.dex, row.pool.id)) || "0") > 0n ? (
                            <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-px text-[8px] font-bold uppercase tracking-wider text-emerald-300">LP</span>
                          ) : null}
                        </span>
                        <span className="block truncate text-[10px] text-white/55">
                          {logoAsset.symbol}/{isAse ? "ASE" : row.asset1.symbol} · {feePct(safeBig(row.pool.feeBps || "30"))} fee{st.lastTs ? ` · last ${ago(st.lastTs)}` : " · no trades"}
                        </span>
                      </span>
                    </span>
                    <span className="hidden min-w-0 items-center md:flex">
                      <DexTag dex={row.pool.dex} />
                    </span>
                    <span className={cn("hidden text-right font-mono text-xs font-semibold md:block", dirFlash(st.lastBuy, st.lastTs, "text-white/85"))}>
                      {usdPx > 0
                        ? fmtUsd(usdPx)
                        : quotePrice > 0 ? `${fmtTiny(quotePrice, 5)} ${quoteAsset.symbol}`
                          : st.lastPrice > 0 ? fmtUsd(st.lastPrice * aseUsdRate) : "-"}
                    </span>
                    <span className="hidden text-right font-mono text-xs text-white/60 md:block">
                      {safeBig(st.volWei) > 0n
                        ? (priceUnit === "USD" ? aseWeiUsd(st.volWei) : `${fmtWeiCompact(st.volWei)} ASE`)
                        : safeBig(st.volQuoteWei || "0") > 0n
                          ? `${fmtWeiCompact(st.volQuoteWei ?? "0", quoteAsset.decimals)} ${quoteAsset.symbol}`
                          : (priceUnit === "USD" ? "$0" : "0 ASE")}
                    </span>
                    <span className="hidden text-right font-mono text-xs text-white/60 md:block">
                      {(() => {
                        // LP cell — per-leg ASE valuation (ASE leg direct,
                        // token legs via their own ASE price incl. token↔token
                        // hops). Sum when both price, double when one does,
                        // raw quote units only when nothing prices.
                        const legVal = (addr: string, res: string | undefined, dec: number): number => {
                          const r = safeBig(res || "0");
                          if (r <= 0n) return 0;
                          if (addr === NATIVE) return Number(r) / 1e18;
                          const l = asePriceByToken.get(addr) ?? asePriceByToken.get(addr.toLowerCase());
                          return l ? (Number(r) / 10 ** dec) * l.price : 0;
                        };
                        const v0 = legVal(row.pool.token0, row.pool.reserve0, row.asset0.decimals);
                        const v1 = legVal(row.pool.token1, row.pool.reserve1, row.asset1.decimals);
                        const aseLiq = v0 > 0 && v1 > 0 ? v0 + v1 : Math.max(v0, v1) * 2;
                        return aseLiq > 0
                          ? `${fmtTiny(aseLiq, 2)} ASE`
                          : `${fmtWeiCompact((row.asset0.address === quoteAsset.address ? row.pool.reserve0 : row.pool.reserve1).toString(), quoteAsset.decimals)} ${quoteAsset.symbol}`;
                      })()}
                    </span>
                    <span className="hidden text-right font-mono text-xs text-white/60 md:block">{st.trades || "-"}</span>
                    <span className={cn("text-right font-mono text-xs font-bold", st.change >= 0 ? "text-emerald-300" : "text-red-300")}>
                      {st.change ? fmtChgPct(st.change) : "0.0%"}
                    </span>
                    <span className="text-right">
                      {empty ? (
                        <span className="block w-full rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5 text-center font-mono text-[10px] font-bold text-white/35">
                          empty
                        </span>
                      ) : !isAse ? (
                        <span title="Token↔token pair — no ASE leg to spend; hop swaps aren't live yet"
                          className="block w-full cursor-not-allowed rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5 text-center font-mono text-[10px] font-bold text-white/35">
                          buy {buySize}
                        </span>
                      ) : (
                        <button disabled={quickBuyKey === poolKey(row.pool.dex, row.pool.id)}
                          onClick={(e) => { e.stopPropagation(); void quickBuy(row); }}
                          className="w-full rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2 py-1.5 font-mono text-[10px] font-bold text-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.15)] transition hover:bg-emerald-500/25 hover:shadow-[0_0_16px_rgba(52,211,153,0.3)] disabled:opacity-60">
                          {quickBuyKey === poolKey(row.pool.dex, row.pool.id)
                            ? "buying…"
                            : quickBuyDone?.key === poolKey(row.pool.dex, row.pool.id)
                              ? `bought $${quickBuyDone.symbol}`
                              : `buy ${buySize}`}
                        </button>
                      )}
                    </span>
                  </div>
                  <Note scope={`radar:${poolKey(row.pool.dex, row.pool.id)}`} />
                  </div>
                );
              }) : legacyPools.isPending ? (
                <div className="space-y-px p-2">
                  <p className="px-3 py-2 text-[11px] font-medium text-white/55">Loading AURAS pairs…</p>
                  {Array.from({ length: 5 }).map((_, i) => <PairRowSkeleton key={i} />)}
                </div>
              ) : (
                <div className="p-10 text-center text-sm text-white/60">No pools match your search.</div>
              )}
              <ListPager page={radarPage.page} pages={radarPage.pages} total={radarRows.length} onPage={radarPage.setPage} />
            </div>
          </>
        ) : view === "pools" ? (
          /* ── pools view ───────────────────────────────────── */
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02]">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/[0.07] px-4 py-3">
                <h2 className="text-sm font-semibold">Liquidity pools</h2>
                <span className="text-[10px] text-white/50">TVL {priceUnit === "USD" ? aseWeiUsd((aseLiquidity * 2n).toString()) : `${fmtWeiCompact((aseLiquidity * 2n).toString())} ASE`}</span>
                {legacyPools.isPending ? <span className="text-[10px] text-white/45">· AURAS pools loading…</span> : null}
                <div className="flex w-full items-center gap-3 sm:ml-auto sm:w-auto">
                  <div className="flex gap-1 rounded-lg bg-white/[0.05] p-0.5">
                    {(["all", "mine"] as const).map((value) => (
                      <button key={value} onClick={() => setPoolTab(value)}
                        className={cn("rounded-md px-3 py-1 text-[11px] font-medium transition", poolTab === value ? "bg-white/10 text-white" : "text-white/65 hover:text-white/70")}>
                        {value === "mine" ? "My pools" : "All pools"}
                      </button>
                    ))}
                  </div>
                  <div className="relative ml-auto min-w-0 flex-1 sm:ml-0 sm:flex-none">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/50" />
                    <Input value={poolsSearch} onChange={(e) => setPoolsSearch(e.target.value)} placeholder="Search pools" className="h-8 w-full min-w-0 pl-8 text-xs sm:w-40" />
                  </div>
                </div>
              </div>
              {poolTab === "mine" ? (
                <div className="hidden grid-cols-[minmax(0,2fr)_1.4fr_0.7fr_0.7fr_1.3fr_80px] gap-3 border-b border-white/[0.05] px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-white/50 md:grid">
                  <span>Pair</span>
                  <span className="text-right">Position</span>
                  <span className="text-right">Share</span>
                  <span className="text-right">APR</span>
                  <span className="text-right">Rewards</span>
                  <span />
                </div>
              ) : (
                <div className="grid grid-cols-[minmax(0,2fr)_0.9fr_0.7fr] gap-2 border-b border-white/[0.05] px-3 py-2.5 text-[10px] uppercase tracking-wider text-white/50 md:grid-cols-[1.6fr_0.7fr_1fr_1fr_1fr_0.9fr] md:gap-3 md:px-4">
                  <span>Pool</span><span className="hidden md:block">Fee</span><span className="text-right">TVL</span><span className="hidden text-right md:block" title="All-time ASE-side volume">Volume</span><span className="hidden text-right md:block" title="All-time fees paid">Fees</span><span className="text-right" title="Annualized from today's LP fees">APR</span>
                </div>
              )}
              {(pools.isPending || legacyPools.isPending) && !poolRows.length && !(poolTab === "mine" && wallet.status === "connected") ? (
                <div className="space-y-px p-2">
                  <p className="px-3 py-2 text-[11px] font-medium text-white/55">{pools.isPending ? "Loading ASEDEX pools…" : "Loading AURAS pools…"}</p>
                  {Array.from({ length: 6 }).map((_, i) => <PairRowSkeleton key={i} />)}
                </div>
              ) : null}
              {poolPage.paged.map((row) => {
                const logoAsset = row.asset0.address === NATIVE ? row.asset1 : row.asset0;
                const quoteAsset = row.asset0.address === logoAsset.address ? row.asset1 : row.asset0;
                const isAsePair = row.asset0.address === NATIVE || row.asset1.address === NATIVE;
                const st = statOf(row);
                const feeBpsRow = safeBig(row.pool.feeBps || "30");
                // Lifetime volume/fees — AseDex pools carry volumeAseWei;
                // AuraDex pools predate it and show 0.
                const volWeiAll = safeBig(row.pool.volumeAseWei || "0");
                const feeAllWei = volWeiAll * feeBpsRow / 10000n;
                // USD pool weight — ASE pairs = ASE side ×2; token+token pairs
                // price through the ASE-valued leg (tvlOf). Same number that
                // sorts the table, so order matches the displayed value.
                const tvlUsd = tvlOf(row);
                // APR = annualized LP-share fees ÷ total pool value. Day
                // volume: ASE-denominated when priced, else the quote leg
                // valued through its ASE price (0 when unpriceable → 0%).
                const qAssetPx = asePriceByToken.get(quoteAsset.address)?.price ?? 0;
                const volUsd = safeBig(st.volWei) > 0n
                  ? (Number(safeBig(st.volWei)) / 1e18) * aseUsdRate
                  : qAssetPx > 0 ? (Number(safeBig(st.volQuoteWei || "0")) / 10 ** quoteAsset.decimals) * qAssetPx * aseUsdRate : 0;
                const lpFee24Usd = volUsd * (Number(lpBps) / 10000);
                const apr = tvlUsd > 0 ? (lpFee24Usd * 365 / tvlUsd) * 100 : 0;
                const rowDepleted = poolDepleted(row.pool, logoAsset.address, quoteAsset.address, quoteAsset.decimals, qAssetPx);
                const myShares = safeBig(shareByPool.get(poolKey(row.pool.dex, row.pool.id)) || "0");
                const totalShares = safeBig(row.pool.totalShares || "0");
                const noLiq = totalShares === 0n && !(Number(row.pool.tvlQuote) > 0);
                const sharePct = totalShares > 0n ? Number(myShares * 10000n / totalShares) / 100 : 0;
                const myAmt0 = totalShares > 0n ? myShares * safeBig(row.pool.reserve0 || "0") / totalShares : 0n;
                const myAmt1 = totalShares > 0n ? myShares * safeBig(row.pool.reserve1 || "0") / totalShares : 0n;
                const rew = rewardsByPool.get(poolKey(row.pool.dex, row.pool.id));
                const rewLabel = (() => {
                  if (!rew) return "";
                  const parts: string[] = [];
                  try {
                    const a0 = safeBig(rew.amount0 || "0"), a1 = safeBig(rew.amount1 || "0");
                    if (a0 > 0n) parts.push(`${formatUnits(a0, row.asset0.decimals, 4)} ${row.asset0.symbol}`);
                    if (a1 > 0n) parts.push(`${formatUnits(a1, row.asset1.decimals, 4)} ${row.asset1.symbol}`);
                  } catch { }
                  return parts.join(" + ");
                })();
                return poolTab === "mine" ? (
                  <div key={poolKey(row.pool.dex, row.pool.id)} onClick={() => openLpModal(row)}
                    className="grid w-full cursor-pointer grid-cols-[minmax(0,2fr)_auto] items-center gap-2 border-b border-white/[0.04] px-3 py-3 text-left transition hover:bg-white/[0.03] md:grid-cols-[minmax(0,2fr)_1.4fr_0.7fr_0.7fr_1.3fr_80px] md:gap-3 md:px-4">
                    <span className="flex min-w-0 items-start gap-2.5">
                      <TokenImg src={logoAsset.logoUrl} symbol={logoAsset.symbol} cls="h-9 w-9 shrink-0 rounded-lg border border-white/10 object-cover text-[10px]" />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-1 text-xs font-semibold"><span className="truncate">{logoAsset.symbol}/{isAsePair ? "ASE" : quoteAsset.symbol}{logoAsset.fromPad && isAsePair ? <PadTag token={logoAsset.address} className="ml-1" /> : null}<OfficialTag addr={logoAsset.address} /></span><LpBurnTag pct={burnPctOf(row)} shares={burnSharesOf(row)} tx={burnTxOf(row)} /><DexTag dex={row.pool.dex} />{rowDepleted ? <LowLiqTag /> : null}</span>
                        <span className="block font-mono text-[9px] text-white/45">Pool #{row.pool.id}</span>
                        <span className="mt-0.5 block truncate font-mono text-[10px] text-white/70 md:hidden">
                          {`${formatUnits(myAmt0, row.asset0.decimals, 3)} ${row.asset0.symbol} + ${formatUnits(myAmt1, row.asset1.decimals, 3)} ${row.asset1.symbol}`}
                          {" · "}{sharePct.toFixed(2)}% · {apr.toFixed(1)}% APR{rewLabel ? ` · +${rewLabel}` : ""}
                        </span>
                      </span>
                    </span>
                    <span className="hidden text-right md:block">
                      <span className="block font-mono text-xs font-semibold text-white/85">{formatUnits(myAmt0, row.asset0.decimals, 4)} {row.asset0.symbol}</span>
                      <span className="block font-mono text-[10px] text-white/60">{formatUnits(myAmt1, row.asset1.decimals, 4)} {row.asset1.symbol}</span>
                    </span>
                    <span className="hidden text-right font-mono text-xs text-white/70 md:block">{sharePct.toFixed(2)}%</span>
                    <span className={cn("hidden text-right font-mono text-xs font-semibold md:block", apr > 0 ? "text-emerald-300" : "text-white/55")}>{apr.toFixed(1)}%</span>
                    <span className="hidden text-right font-mono text-[10px] text-accent/90 md:block">{rewLabel || "0"}</span>
                    <span className="text-right">
                      <span className="inline-block w-full rounded-lg border border-accent/40 bg-accent/10 px-2 py-1.5 text-center font-mono text-[10px] font-bold text-accent">
                        Manage
                      </span>
                    </span>
                  </div>
                ) : (
                  <button key={poolKey(row.pool.dex, row.pool.id)} onClick={() => openLpModal(row)}
                    className={cn("grid w-full grid-cols-[minmax(0,2fr)_0.9fr_0.7fr] items-center gap-2 border-b border-white/[0.04] px-3 py-3 text-left transition md:grid-cols-[1.6fr_0.7fr_1fr_1fr_1fr_0.9fr] md:gap-3 md:px-4",
                      noLiq ? "opacity-50" : "hover:bg-white/[0.03]")}>
                    <span className="flex min-w-0 items-start gap-2.5">
                      <TokenImg src={logoAsset.logoUrl} symbol={logoAsset.symbol} cls="h-9 w-9 shrink-0 rounded-lg border border-white/10 object-cover text-[10px]" />
                      <span className="min-w-0">
                        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <span className="truncate text-xs font-semibold">{logoAsset.symbol}/{isAsePair ? "ASE" : quoteAsset.symbol}{logoAsset.fromPad && isAsePair ? <PadTag token={logoAsset.address} className="ml-1" /> : null}<OfficialTag addr={logoAsset.address} /></span>
                          <LpBurnTag pct={burnPctOf(row)} shares={burnSharesOf(row)} tx={burnTxOf(row)} />
                          <DexTag dex={row.pool.dex} />
                          {totalShares > 0n && rowDepleted ? <LowLiqTag /> : null}
                          {noLiq ? <span className="shrink-0 rounded-full border border-white/15 bg-white/[0.05] px-1.5 py-px text-[8px] font-bold uppercase tracking-wider text-white/45">No liquidity</span> : null}
                        </span>
                        <span className="block font-mono text-[9px] text-white/45">Pool #{row.pool.id}</span>
                      </span>
                    </span>
                    <span className="hidden font-mono text-xs text-white/55 md:block">{feePct(safeBig(row.pool.feeBps || "30"))}%</span>
                    <span className="text-right font-mono text-xs text-white/70">{priceUnit === "USD" ? fmtUsd(tvlUsd) : `${fmtTiny(tvlUsd / aseUsdRate, 2)} ASE`}</span>
                    <span className="hidden text-right font-mono text-xs text-white/70 md:block" title="All-time ASE-side volume">{volWeiAll > 0n ? (priceUnit === "USD" ? aseWeiUsd(volWeiAll.toString()) : `${fmtWeiCompact(volWeiAll.toString())} ASE`) : (priceUnit === "USD" ? "$0" : "0 ASE")}</span>
                    <span className="hidden text-right font-mono text-xs text-white/70 md:block" title="All-time fees paid">{feeAllWei > 0n ? (priceUnit === "USD" ? aseWeiUsd(feeAllWei.toString()) : `${fmtWeiCompact(feeAllWei.toString())} ASE`) : (priceUnit === "USD" ? "$0" : "0 ASE")}</span>
                    <span className={cn("text-right font-mono text-xs font-semibold", apr > 0 ? "text-emerald-300" : "text-white/55")}>{apr.toFixed(1)}%</span>
                  </button>
                );
              })}
              {!poolRows.length && poolTab === "mine" && wallet.status === "connected" && !lpConfirmed ? (
                <div className="space-y-px p-2">
                  <p className="px-3 py-2 text-[11px] font-medium text-white/55">Loading your pool positions…</p>
                  {Array.from({ length: 4 }).map((_, i) => <PairRowSkeleton key={i} />)}
                </div>
              ) : !poolRows.length && !(pools.isPending || legacyPools.isPending) ? (
                <p className="p-8 text-center text-sm text-white/60">
                  {poolTab === "mine"
                    ? wallet.status !== "connected" ? "Connect a wallet to see your LP positions."
                      : "No LP positions yet. Click a pool to add liquidity."
                    : !pools.isFetched ? "Pools couldn't load — retrying in the background…"
                    : "No pools yet. Create one."}
                </p>
              ) : null}
              <ListPager page={poolPage.page} pages={poolPage.pages} total={poolRows.length} onPage={poolPage.setPage} />
            </div>

            {/* create pool card */}
            <div className="self-start rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 sm:p-5">
              <h3 className="text-sm font-semibold">Create pool</h3>
              <p className="mt-1 text-[11px] text-white/55">pool your token against ASE · Asentum</p>
              <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-white/[0.05] p-1" aria-label="Venue">
                {([["AseDex", PRIMARY_DEX], ["AURAS", AURADEX_V2]] as const).map(([label, d]) => (
                  <button key={d} onClick={() => setCreateDex(d)}
                    className={cn("rounded-md py-1.5 text-xs font-medium transition", createDex === d ? "bg-white/10 text-white" : "text-white/60 hover:text-white/75")}>{label}</button>
                ))}
              </div>
              <p className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-white/55">Token A</p>
              <TokenSearchPick tokens={heldTokens.data ?? []} value={tokenAddress} onChange={setTokenAddress} placeholder="ase1… / 0x… or token name" />
              {tokenAddress.trim() && !createAValid ? <p className="mt-1 text-[10px] text-red-300/80">Not a valid token address</p> : null}
              {createAssetA ? (
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2">
                  <TokenImg src={createAssetA.logoUrl} symbol={createAssetA.symbol} cls="h-6 w-6 rounded-lg border border-white/10 object-cover text-[8px]" />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1 text-xs font-semibold">
                      <span className="truncate">{createAssetA.symbol}</span>
                      {createAssetA.fromPad ? <PadTag token={createAssetA.address} /> : null}
                      <OfficialTag addr={createAssetA.address} className="h-3 w-3" />
                    </span>
                    <span className="block truncate text-[9px] text-white/50">{createAssetA.name}</span>
                  </span>
                </div>
              ) : createAValid ? <p className="mt-1.5 text-[10px] text-white/45">Resolving token…</p> : null}
              <p className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-white/55">Pair with <span className="normal-case text-white/45">(empty = ASE)</span></p>
              <TokenSearchPick tokens={heldTokens.data ?? []} value={tokenBAddress} onChange={setTokenBAddress} placeholder="ASE or token contract" allowNative />
              {tokenBAddress.trim() && !createBValid ? <p className="mt-1 text-[10px] text-red-300/80">Not a valid token address</p> : null}
              {createAssetB ? (
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2">
                  {createTokenBAddr === NATIVE ? <AseLogo size={24} className="h-6 w-6 rounded-lg border border-white/10 object-cover" /> : <TokenImg src={createAssetB.logoUrl} symbol={createAssetB.symbol} cls="h-6 w-6 rounded-lg border border-white/10 object-cover text-[8px]" />}
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1 text-xs font-semibold">
                      <span className="truncate">{createAssetB.symbol}</span>
                      {createAssetB.fromPad ? <PadTag token={createAssetB.address} /> : null}
                      <OfficialTag addr={createAssetB.address} className="h-3 w-3" />
                    </span>
                    <span className="block truncate text-[9px] text-white/50">{createAssetB.name}</span>
                  </span>
                </div>
              ) : null}
              {existingPool && createAssetA && createAssetB ? (
                <div className="mt-3 rounded-lg border border-accent/25 bg-accent/[0.06] px-3 py-2.5">
                  <p className="text-[11px] font-semibold text-accent">
                    {createAssetA.symbol}/{createAssetB.symbol} pool already exists on {dexName(existingPool.dex)} · {feePct(safeBig(existingPool.feeBps || "30"))}% fee
                  </p>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-white/60">
                    {epPriced
                      ? `Reserves ${formatUnits(epResA, createAssetA.decimals, 4)} ${createAssetA.symbol} / ${formatUnits(epResB, createAssetB.decimals, 4)} ${createAssetB.symbol}. Deposit below adds to it at the pool price.`
                      : "This pool is empty. Your deposit sets the price."}
                    {" "}A new pool needs a different pair.
                  </p>
                </div>
              ) : null}
              {!existingPool ? (
                <>
                  <p className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-white/55">Fee tier</p>
                  <div className="mt-1.5 grid grid-cols-2 gap-2">
                    {([["1", "0.01%", "stables"], ["5", "0.05%", "correlated"], ["30", "0.30%", "most pairs"], ["100", "1.00%", "exotic / new"]] as const).map(([bps, pct, hint]) => (
                      <button key={bps} onClick={() => setCreateFee(bps)}
                        className={cn("rounded-lg border px-3 py-2 text-left transition", createFee === bps ? "border-accent/40 bg-accent/10" : "border-white/[0.08] bg-white/[0.03] hover:border-white/20")}>
                        <span className={cn("block text-xs font-bold", createFee === bps ? "text-accent" : "text-white/80")}>{pct}</span>
                        <span className="block text-[9px] text-white/55">{hint}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
              <p className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-white/55">Deposit <span className="normal-case text-white/45">({existingPool ? (epPriced ? "at pool price" : "sets the price") : "optional, seeds the pool"})</span></p>
              <div className="mt-1.5 space-y-2">
                {[
                  { asset: createAssetA, value: depAmtA, set: onDepAChange, bal: createBalA, over: depOverA },
                  { asset: createAssetB, value: depAmtB, set: onDepBChange, bal: createBalB, over: depOverB }
                ].map(({ asset, value, set, bal, over }, i) => {
                  const sellBps = taxOf(asset?.address).sell;
                  const maxSpend = sellBps > 0n ? (bal * (10000n - sellBps)) / 10000n : bal;
                  return (
                  <div key={i} className={cn("rounded-xl border bg-black/30 px-3 py-2.5 transition", over ? "border-red-500/40" : "border-white/10 focus-within:border-white/25")}>
                    <div className="flex items-center gap-2">
                      <input value={value} onChange={(e) => set(e.target.value)} inputMode="decimal" placeholder="0.0"
                        className="min-w-0 flex-1 bg-transparent text-base font-semibold text-white outline-none placeholder:text-white/35" />
                      <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-white/85">
                        {asset?.address === NATIVE ? <AseLogo size={14} /> : asset?.logoUrl ? <TokenImg src={asset.logoUrl} symbol={asset.symbol} cls="h-3.5 w-3.5 rounded-lg object-cover text-[6px]" /> : null}
                        {asset?.symbol ?? (i === 0 ? "Token" : "ASE")}
                        {asset?.fromPad ? <PadTag token={asset.address} className="h-3.5 w-3.5" /> : null}
                        <OfficialTag addr={asset?.address} className="h-3.5 w-3.5" />
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[10px]">
                      <span className={cn("font-mono", over ? "text-red-300" : "text-white/50")}>Balance {asset ? formatUnits(bal, asset.decimals, 4) : "0"} {asset?.symbol}{sellBps > 0n ? ` (+${Number(sellBps) / 100}% tax)` : ""}</span>
                      <button type="button" className="font-semibold text-accent transition hover:underline disabled:opacity-40" disabled={!asset || maxSpend <= 0n}
                        onClick={() => { if (asset && maxSpend > 0n) set(weiToDecimalStr(maxSpend, asset.decimals)); }}>Max</button>
                    </div>
                  </div>
                  );
                })}
              </div>
              {createAssetA && createAssetB && ((existingPool && epPriced) || depActive) ? (
                <div className="mt-3 flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2">
                  <span className="text-[10px] uppercase tracking-wider text-white/55">{existingPool && epPriced ? "Pool price" : "Initial price"}</span>
                  <span className="font-mono text-[11px] text-white/85">1 {createAssetA.symbol} = {fmtTiny(existingPool && epPriced ? epPrice : initPrice, 6)} {createAssetB.symbol}</span>
                </div>
              ) : null}
              {depOneSided ? <p className="mt-2 text-[10px] text-amber-200/80">Enter both amounts: liquidity needs both sides of the pair.</p> : null}
              {createLocked ? <p className="mt-2 text-[11px] leading-relaxed text-amber-200/80">This AsePad token is locked to the DEX. Its pool opens through the official migration.</p> : null}
              <Note scope="create" />
              <Button className="mt-4 w-full" disabled={Boolean(busy) || createLocked || (wallet.status === "connected" && (!createAValid || !createBValid || (createGate.isPending && createGate.isFetching) || (existingPoolQ.isPending && existingPoolQ.isFetching) || depOverA || depOverB || depOneSided))} onClick={() => void createPool()}>
                {busy || (wallet.status !== "connected" ? "Connect wallet"
                  : createGate.isPending && createGate.isFetching ? "Fetching token details…"
                  : existingPoolQ.isPending && existingPoolQ.isFetching ? `Checking pair on ${dexName(createDex)}…`
                  : depOverA ? `Insufficient ${createAssetA?.symbol}` : depOverB ? `Insufficient ${createAssetB?.symbol}` : existingPool ? (depActive ? "Add liquidity" : "Open pool") : depActive ? "Create pool & deposit" : "Create pool")}
              </Button>
              {wallet.status === "connected" && createAValid && createBValid && createAssetA && createAssetB ? (() => {
                const steps: string[] = [];
                if (!existingPool) steps.push("create pool");
                if (depActive) {
                  for (const [a, amt] of [[createAssetA, depAWei], [createAssetB, depBWei]] as [Asset, bigint | null][]) {
                    if (a.address === NATIVE) continue;
                    const need = approveNeeded(a.address, createDex, amt);
                    if (need !== false) steps.push(`approve ${a.symbol}${need === null ? " (if needed)" : ""}`);
                  }
                  steps.push(existingPool ? "add liquidity" : "deposit");
                }
                return <p className="mt-1.5 text-center text-[10px] text-white/45">{txHint(steps)}</p>;
              })() : null}
              <p className="mt-2 text-center text-[10px] text-white/50">{createAssetA?.symbol ?? "Token"} · pairs with {createAssetB?.symbol ?? "ASE"}</p>
            </div>
          </div>
        ) : view === "wallet" ? (
          /* ── wallet view ──────────────────────────────────── */
          wallet.status !== "connected" ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] py-24 text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/wallettitle.png" alt="Wallet" className="mb-3 h-7 w-auto max-w-[80vw] object-contain md:h-9" />
              <p className="text-sm font-semibold">Connect a wallet to view your assets</p>
              <p className="text-[11px] text-white/55">your ASE + token balances, read live from the chain</p>
              <Button size="sm" className="mt-2" onClick={() => wallet.openConnect?.()}>Connect wallet</Button>
            </div>
          ) : (() => {
            // Blue-tick tokens pin top under the ASE row — official status
            // outranks raw holding value, then value sorts within each tier.
            const held = (heldTokens.data ?? []).slice().sort((a, b) =>
              Number(Boolean(officialLabel(b.address, officialTokens.data)))
              - Number(Boolean(officialLabel(a.address, officialTokens.data)))
              || (Number(safeBig(b.balance)) / 10 ** b.decimals) * heldPxOf(b)
                - (Number(safeBig(a.balance)) / 10 ** a.decimals) * heldPxOf(a));
            const aseBal = Number(safeBig(aseBalance || "0")) / 1e18;
            const tokenValAse = held.reduce((s, t) => s + (Number(safeBig(t.balance)) / 10 ** t.decimals) * heldPxOf(t), 0);
            const totalAse = aseBal + tokenValAse;
            const assetCount = held.length + 1;
            const openOrders = openMyOrders.length;
            const lpCount = Math.max(
              allRows.filter((r) => safeBig(shareByPool.get(poolKey(r.pool.dex, r.pool.id)) || "0") > 0n).length,
              dbLpCount
            );
            const pnlAse = held.reduce((s, t) => {
              const avg = avgPaidByToken.get(t.address), px = heldPxOf(t);
              return avg && px ? s + (px - avg) * (Number(safeBig(t.balance)) / 10 ** t.decimals) : s;
            }, 0);
            const exportCsv = () => {
              const list = mySwaps.data ?? [];
              const head = "time,pool,side,base,amount_base,quote,amount_quote,price";
              const lines = list.map((s) => [new Date(s.ts * 1000).toISOString(), `${s.base?.symbol ?? "?"}/${s.quote?.symbol ?? "?"}`, s.side, s.base?.symbol ?? "?", s.baseAmt, s.quote?.symbol ?? "?", s.quoteAmt, s.px].join(","));
              const blob = new Blob([[head, ...lines].join("\n")], { type: "text/csv" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob); a.download = `asedex-trades-${shortenAddress(ownerHex, 8, 4)}.csv`; a.click();
              URL.revokeObjectURL(a.href);
            };
            return (
            <div className="space-y-4">
              {/* ── portfolio hero ─────────────────────────────── */}
              <div className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-gradient-to-br from-accent/[0.07] via-white/[0.02] to-transparent p-5">
                <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-accent/[0.08] blur-3xl" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/wallettitle.png" alt="Wallet" className="mx-auto mb-2 h-6 w-auto max-w-[80vw] object-contain md:mb-4 md:h-9" />
                {/* mobile: in-flow under the title (absolute top-right lands on
                    the centered wordmark); desktop keeps the corner slot */}
                <div className="mb-3 flex justify-center md:absolute md:right-4 md:top-4 md:mb-0"><LiveIndicator /></div>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/60">Portfolio</p>
                    <p className="mt-1.5 text-4xl font-black tracking-tight">{fmtTiny(totalAse, 4)} <span className="text-xl text-white/60">ASE</span></p>
                    <p className="mt-0.5 text-sm text-white/70">{fmtUsd(totalAse * aseUsd)} · across {assetCount} asset{assetCount === 1 ? "" : "s"}</p>
                  </div>
                  <a href={explorerAddressUrl(ownerHex)} target="_blank" rel="noreferrer"
                    className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 font-mono text-xs text-white/75 transition hover:border-white/20 hover:text-white">
                    {namedAddr(ownerHex, addrNames, shortenAddress)}<ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {([
                    ["ASE balance", aseBalance === null ? <span className="inline-block h-5 w-16 animate-pulse rounded bg-white/10 align-middle" /> : formatUnits(aseBalance || "0", 18, 4), "native gas token"],
                    ["Tokens held", String(held.length), "live from chain"],
                    ["Open orders", String(openOrders), "limit + dca"],
                    ["LP positions", String(lpCount), "pools you fund"],
                  ] as [string, ReactNode, string][]).map(([l, v, sub]) => (
                    <div key={l} className="rounded-xl border border-white/[0.06] bg-black/20 px-3.5 py-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/60">{l}</p>
                      <p className="mt-1 font-mono text-lg font-bold">{v}</p>
                      <p className="text-[11px] text-white/55">{sub}</p>
                    </div>
                  ))}
                </div>
                {pnlAse !== 0 ? (
                  <p className={cn("mt-2.5 text-xs font-medium", pnlAse > 0 ? "text-emerald-300" : "text-red-300")}>
                    Unrealized PnL {pnlAse > 0 ? "+" : ""}{fmtTiny(pnlAse, 3)} ASE on cost-basis positions
                  </p>
                ) : null}
              </div>

              {/* ── wallet tabs: holdings / created / orders / activity ── */}
              <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02]">
                <div className="flex items-center justify-between gap-2 border-b border-white/[0.07] px-4 py-2.5">
                  <div className="flex w-full flex-nowrap items-center gap-1 overflow-x-auto rounded-lg bg-white/[0.04] p-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {(["holdings", "created", "orders", "activity"] as const).map((k) => (
                      <button key={k} onClick={() => setWalletTab(k)}
                        className={cn("shrink-0 whitespace-nowrap rounded-md px-3.5 py-1 text-xs font-semibold capitalize transition", walletTab === k ? "bg-white/10 text-white" : "text-white/70 hover:text-white")}>
                        {k === "orders" ? `Orders${openOrders ? ` (${openOrders})` : ""}` : k === "holdings" ? `Holdings${assetCount ? ` (${assetCount})` : ""}` : k === "created" ? `Created${createdTokens.data?.tokens?.length ? ` (${createdTokens.data.tokens.length})` : ""}` : "Activity"}
                      </button>
                    ))}
                  </div>
                  {null}
                </div>
                {walletTab === "holdings" ? (
                <div>
                  <div className="hidden grid-cols-[1.6fr_1fr_1fr_1fr_1.2fr] gap-3 border-b border-white/[0.05] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-white/65 sm:grid">
                    <span>Token</span><span className="text-right">Balance</span><span className="text-right">Avg paid</span><span className="text-right">Price</span><span className="text-right">Value</span>
                  </div>
                  <div className="max-h-[380px] overflow-y-auto">
                  <div className="flex flex-col gap-1 border-b border-white/[0.04] px-4 py-3 sm:grid sm:grid-cols-[1.6fr_1fr_1fr_1fr_1.2fr] sm:items-center sm:gap-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-start gap-2.5 text-sm font-semibold"><AseLogo size={26} /><span><span className="inline-flex items-center gap-1">ASE<OfficialTag addr={NATIVE} className="h-3.5 w-3.5" /></span><span className="block text-[10px] font-normal text-white/55">Asentum</span></span></span>
                      <span className="text-right font-mono text-sm font-semibold sm:hidden">{fmtTiny(aseBal, 4)} ASE{aseUsd > 0 ? <span className="block text-[10px] font-normal text-white/55">{fmtUsd(aseBal * aseUsd)}</span> : null}</span>
                    </div>
                    <p className="text-[11px] text-white/55 sm:hidden">Balance <span className="font-mono text-white/80">{aseBalance === null ? <span className="inline-block h-3.5 w-14 animate-pulse rounded bg-white/10 align-middle" /> : formatUnits(aseBalance || "0", 18, 4)}</span> · Price <span className="font-mono text-white/80">1 ASE</span></p>
                    <span className="hidden text-right font-mono text-sm sm:block">{aseBalance === null ? <span className="inline-block h-4 w-14 animate-pulse rounded bg-white/10" /> : formatUnits(aseBalance || "0", 18, 4)}</span>
                    <span className="hidden text-right font-mono text-sm text-white/60 sm:block">-</span>
                    <span className="hidden text-right font-mono text-sm text-white/80 sm:block">1 ASE</span>
                    <span className="hidden text-right font-mono text-sm font-semibold sm:block">{fmtTiny(aseBal, 4)} ASE{aseUsd > 0 ? <span className="block text-[10px] font-normal text-white/55">{fmtUsd(aseBal * aseUsd)}</span> : null}</span>
                  </div>
                  {heldTokens.isPending && !heldTokens.data ? (
                    <div className="space-y-px p-2">
                      <p className="px-2 py-1.5 text-[11px] font-medium text-white/55">Loading token balances…</p>
                      {Array.from({ length: 3 }).map((_, i) => <PairRowSkeleton key={i} />)}
                    </div>
                  ) : null}
                  {held.map((t) => {
                    const matches = allRows.filter((r) => [r.asset0, r.asset1].some((a) => a.address.toLowerCase() === t.address.toLowerCase()));
                    const pool = matches.find((r) => r.asset0.address === NATIVE || r.asset1.address === NATIVE) ?? matches[0];
                    const px = heldPxOf(t);
                    const avg = avgPaidByToken.get(t.address);
                    const units = Number(safeBig(t.balance)) / 10 ** t.decimals;
                    const val = units * px;
                    const rowCls = "flex w-full flex-col gap-1 border-b border-white/[0.04] px-4 py-3 text-left transition sm:grid sm:grid-cols-[1.6fr_1fr_1fr_1fr_1.2fr] sm:items-center sm:gap-3";
                    const tokenCell = (
                      <span className="flex items-start gap-2.5 text-sm font-semibold">
                        <TokenImg src={t.logoUrl} symbol={t.symbol} cls="h-9 w-9 rounded-lg border border-white/10 object-cover text-[10px]" />
                        <span className="min-w-0"><span className="flex items-center gap-1.5 truncate">{t.symbol}{t.fromPad || asepadPeekLaunchRecord(t.address)?.token ? <PadTag token={t.address} /> : null}<OfficialTag addr={t.address} /></span><span className="block truncate text-[10px] font-normal text-white/55">{t.name}</span></span>
                      </span>
                    );
                    const valueCell = (
                      <span className="block text-right font-mono text-sm font-semibold">
                        {px ? <>{fmtTiny(val, 4)} ASE{aseUsd > 0 ? <span className="block text-[10px] font-normal text-white/55">{fmtUsd(val * aseUsd)}</span> : null}</> : "-"}
                      </span>
                    );
                    const content = (
                      <>
                        <div className="flex items-center justify-between gap-3">
                          {tokenCell}
                          <span className="sm:hidden">{valueCell}</span>
                        </div>
                        <p className="text-[11px] text-white/55 sm:hidden">
                          Balance <span className="font-mono text-white/80">{formatUnits(t.balance, t.decimals, 4)}</span>
                          {" · "}Avg <span className="font-mono text-white/80">{avg ? fmtUsd(avg * aseUsd) : "-"}</span>
                          {" · "}Price <span className="font-mono text-white/80">{px ? fmtUsd(px * aseUsd) : "-"}</span>
                        </p>
                        <span className="hidden text-right font-mono text-sm text-white/85 sm:block">{formatUnits(t.balance, t.decimals, 4)}</span>
                        <span className="hidden text-right font-mono text-sm text-white/70 sm:block">{avg ? fmtUsd(avg * aseUsd) : "-"}</span>
                        <span className="hidden text-right font-mono text-sm text-white/80 sm:block">{px ? fmtUsd(px * aseUsd) : "-"}</span>
                        <span className="hidden sm:block">{valueCell}</span>
                      </>
                    );
                    // Any indexed pair = migrated → its terminal, always. The
                    // viability gate only matters for picking the ASE pair
                    // above; a dead-but-real pool still owns this token.
                    if (pool) {
                      return <button key={t.address} onClick={() => openPair(poolKey(pool.pool.dex, pool.pool.id))} className={cn(rowCls, "hover:bg-white/[0.03]")}>{content}</button>;
                    }
                    // No AseDex pair: pad-launched tokens open their live
                    // bonding page on the pump app instead of a dead row.
                    const padLaunch = t.fromPad || asepadPeekLaunchRecord(t.address)?.token;
                    return padLaunch ? (
                      <a key={t.address} href={siteHref(`/asepad/token/${toAseAddress(t.address)}`)} className={cn(rowCls, "hover:bg-white/[0.03]")}>{content}</a>
                    ) : (
                      <div key={t.address} className={rowCls}>{content}</div>
                    );
                  })}
                  {/* Empty state only once the sweep fully settles — a partial
                      mid-sweep emit must not flash "no tokens" while probes run. */}
                  {heldSettledOwners.has(ownerHex) && (!held.length || aseBal <= 0) ? (
                    <p className="p-8 text-center text-sm text-white/70">
                      {!held.length && aseBal <= 0
                        ? "No ASE or ARC-20 tokens in this wallet yet."
                        : !held.length
                          ? "No ARC-20 tokens in this wallet yet."
                          : "No ASE native gas token in this wallet."}
                    </p>
                  ) : null}
                  {!heldSettledOwners.has(ownerHex) && !held.length ? <p className="p-8 text-center text-sm text-white/50">Loading balances…</p> : null}
                  </div>
                  </div>
                ) : walletTab === "created" ? (
                  <div>
                    {(createdTokens.data?.tokens ?? []).map((t) => {
                      const sym = t.symbol || "?";
                      const addr = ase1OfAddr(t.address);
                      return (
                        <div key={t.address} className="flex items-center justify-between gap-3 border-b border-white/[0.04] px-4 py-3">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <TokenImg src={t.logo_url ?? undefined} symbol={sym} cls="h-8 w-8 rounded-full border border-white/10 object-cover text-[9px]" />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                {t.kind === "pad" ? (
                                  <a href={siteHref(`/asepad/token/${addr}`)} className="truncate text-sm font-semibold text-white/90 transition hover:text-accent">{trimSym(sym)}</a>
                                ) : (
                                  <span className="truncate text-sm font-semibold text-white/90">{trimSym(sym)}</span>
                                )}
                                {t.kind === "pad" ? <PadTag token={t.address} /> : null}
                                {t.kind && t.kind !== "pad" ? <span className="rounded bg-white/[0.08] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white/60">{t.kind}</span> : null}
                                <OfficialTag addr={t.address} />
                              </div>
                              <div className="truncate font-mono text-[10px] text-white/45">{t.name || ""}</div>
                            </div>
                          </div>
                          <span className="shrink-0 font-mono text-[10px] text-white/40">{addr ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : ""}</span>
                        </div>
                      );
                    })}
                    {createdTokens.data && !createdTokens.data.tokens.length ? <p className="p-8 text-center text-sm text-white/70">No tokens created yet.</p> : null}
                    {!createdTokens.data ? <p className="p-8 text-center text-sm text-white/60">Loading created tokens…</p> : null}
                  </div>
                ) : walletTab === "orders" ? (
                  <>
                    <Note scope="orders" />
                    <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-1.5">
                      <div className="flex items-center gap-0.5 rounded-md bg-white/[0.04] p-0.5">
                        {(["all", "open", "filled"] as const).map((k) => (
                          <button key={k} onClick={() => setOrderTab(k)}
                            className={cn("rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide transition", orderTab === k ? "bg-white/10 text-white" : "text-white/45 hover:text-white/75")}>
                            {k === "all" ? "All Orders" : k === "open" ? "Open" : "Filled"}
                          </button>
                        ))}
                      </div>
                      {orderTab !== "all" ? (
                        <div className="flex items-center gap-0.5 rounded-md bg-white/[0.04] p-0.5">
                          {(["all", "buy", "sell"] as const).map((k) => (
                            <button key={k} onClick={() => setOrderSide(k)}
                              className={cn("rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide transition", orderSide === k ? "bg-white/10 text-white" : "text-white/45 hover:text-white/75")}>
                              {k === "all" ? "All" : k === "buy" ? "Buy" : "Sell"}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    {orderRows(orderRowsFiltered, orderTab === "open" ? "No open orders" : orderTab === "filled" ? "No filled orders" : "No limit orders or DCA plans")}
                  </>
                ) : (
                  /* ── activity: every tx the wallet touched, grouped by tx —
                     swaps merge in+out legs into one row automatically ── */
                  <>
                  <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-1.5">
                    <div className="flex items-center gap-0.5 rounded-md bg-white/[0.04] p-0.5">
                      {(["all", "buy", "sell"] as const).map((k) => (
                        <button key={k} onClick={() => setActivityTab(k)}
                          className={cn("rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide transition", activityTab === k ? "bg-white/10 text-white" : "text-white/45 hover:text-white/75")}>
                          {k === "all" ? "All" : k === "buy" ? "Buys" : "Sells"}
                        </button>
                      ))}
                    </div>
                    {(mySwaps.data?.length ?? 0) > 0 ? (
                      <button onClick={exportCsv} className="flex items-center gap-1 rounded-md border border-white/[0.08] px-2 py-0.5 text-[9px] font-semibold text-white/60 transition hover:border-white/20 hover:text-white/85">
                        <Download className="h-2.5 w-2.5" />CSV
                      </button>
                    ) : null}
                  </div>
                  <div className="max-h-[480px] overflow-y-auto">
                    {(() => {
                      const groups = new Map<string, { inL: IndexerLeg[]; outL: IndexerLeg[]; ts: number; tx: string }>();
                      for (const l of walletActivity.data ?? []) {
                        const tx = l.tx_hash || `${l.block_number}-${l.token}-${l.value}`;
                        const g = groups.get(tx) ?? { inL: [], outL: [], ts: 0, tx };
                        groups.set(tx, g);
                        const toMe = String(l.to_addr || "").toLowerCase() === ownerHex;
                        const fromMe = String(l.from_addr || "").toLowerCase() === ownerHex;
                        if (toMe) g.inL.push(l);
                        if (fromMe) g.outL.push(l);
                        g.ts = Math.max(g.ts, l.timestamp ?? 0);
                      }
                      const fmtLeg = (l: IndexerLeg) => `${fmtTiny(Number(safeBig(l.value || "0")) / 10 ** (l.decimals ?? 18), 4)} ${l.symbol || (l.kind === "native" ? "ASE" : "?")}`;
                      const rows = [...groups.values()]
                        .filter((g) => activityTab === "all" || (g.inL[0]?.side ?? g.outL[0]?.side ?? "").toLowerCase() === activityTab)
                        .sort((a, b) => b.ts - a.ts).slice(0, 80);
                      if (!rows.length) return <p className="p-8 text-center text-sm text-white/60">{walletActivity.data ? (activityTab === "all" ? "No activity yet." : `No ${activityTab} trades yet.`) : "Loading activity…"}</p>;
                      return rows.map((g) => {
                        const kind = g.inL.length && g.outL.length ? "swap" : g.inL.length ? "in" : "out";
                        const side = (g.inL[0]?.side ?? g.outL[0]?.side ?? "").toLowerCase();
                        const verb = side === "buy" ? "Buy" : side === "sell" ? "Sell" : "Swap";
                        const label = kind === "swap"
                          ? `${verb} ${fmtLeg(g.outL[0])} → ${fmtLeg(g.inL[0])}`
                          : kind === "in" ? `Received ${g.inL.map(fmtLeg).join(" + ")}` : `Sent ${g.outL.map(fmtLeg).join(" + ")}`;
                        return (
                          <a key={g.tx} href={explorerTxUrl(g.tx)} target="_blank" rel="noreferrer"
                            className="flex items-center justify-between gap-3 border-b border-white/[0.04] px-4 py-3 transition hover:bg-white/[0.03]">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                                kind === "swap" ? "bg-accent/15 text-accent" : kind === "in" ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300")}>
                                {kind === "swap" ? "⇄" : kind === "in" ? "↓" : "↑"}
                              </span>
                              <div className="min-w-0">
                                <p className="truncate text-sm text-white/85">{label}</p>
                                <p className="font-mono text-[10px] text-white/40">{kind === "swap" ? "Trade" : kind === "in" ? "Transfer in" : "Transfer out"}</p>
                              </div>
                            </div>
                            <span className="shrink-0 font-mono text-[10px] text-white/45">{ago(g.ts / 1000)}</span>
                          </a>
                        );
                      });
                    })()}
                  </div>
                  </>
                )}
              </div>
            </div>
            );
          })()
        ) : (
          /* ── pair terminal ─────────────────────────────────── */
          <div className="space-y-5 pb-24 lg:pb-0">
            <div className="relative grid gap-4 lg:min-h-[560px] lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[auto_430px] lg:gap-3">
            {/* market header + chart — one seamless panel (futures-style) */}
            <div className="min-w-0 space-y-4 lg:space-y-0 lg:contents">
            <div className="relative lg:contents">
            <Card data-chart-panel className="rounded-2xl border-white/[0.08] bg-black/30 backdrop-blur-md lg:col-start-1 lg:row-start-1 lg:min-h-[calc(100vh-6rem)] lg:overflow-hidden [&:fullscreen]:rounded-none [&:fullscreen]:overflow-y-auto [&:fullscreen]:bg-[#07080d]"><CardContent className="flex flex-col p-0 lg:h-full">
            {selectedRow && pairAsset ? (<>
              {/* ── mobile header ── */}
              <div className="lg:hidden">
                <div className="flex min-h-14 flex-wrap items-center gap-x-2.5 gap-y-1 px-4 py-2">
                  <span className="relative mt-0.5 shrink-0 self-start">
                    <TokenImg src={pairAsset.logoUrl} symbol={pairAsset.symbol} cls="h-9 w-9 rounded-[26%] border border-white/10 object-cover text-xs" />
                    {pairQuote?.address === NATIVE ? (
                      <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-black/60 bg-[#0a0a0a] p-0.5"><AseLogo size={9} /></span>
                    ) : null}
                  </span>
                  <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-sm font-bold tracking-tight">
                    <span className="max-w-[140px] truncate">{pairAssetFull?.name ?? pairAsset.symbol}</span><span className="shrink-0 font-normal text-white/45 max-sm:order-10 max-sm:basis-full">${trimSym(pairAsset.symbol)}-{trimSym(pairQuote?.symbol ?? "ASE")}</span>
                    {pairAssetFull?.fromPad && pairQuote?.address === NATIVE ? <PadTag token={pairAsset.address} /> : null}
                    <OfficialTag addr={pairAsset.address} />
                    <button onClick={() => toggleFav(poolKey(selected!.dex, selected!.id))} aria-label="Favourite pair" title="Favourite pair"
                      className={cn("shrink-0 self-center transition", favs.has(poolKey(selected!.dex, selected!.id)) ? "text-amber-300" : "text-white/25 hover:text-white/60")}>
                      <Star className={cn("h-3.5 w-3.5", favs.has(poolKey(selected!.dex, selected!.id)) && "fill-amber-300")} />
                    </button>
                    <button onClick={() => setPairPickOpen(true)} aria-label="Change market" title="Change market"
                      className="shrink-0 self-center rounded p-0.5 text-white/50 transition hover:bg-white/10 hover:text-white">
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-1">
                    <LpBurnTag pct={lpBurnPctFinal} shares={lpBurnShares || undefined} tx={lpBurnTx.data || undefined} pill />
                    {selected ? <DexTag dex={selected.dex} /> : null}
                    {depletedPool ? <LowLiqTag /> : null}
                  </span>
                </div>
                <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-2 px-4 pb-3 pt-1">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-white/50">Price</p>
                    <button onClick={() => setPriceUnit((u) => (u === "USD" ? "ASE" : "USD"))}
                      title="Switch price unit" aria-label="Switch price unit"
                      className="mt-1 flex min-w-0 items-center gap-1.5 text-left">
                      <span className={cn("truncate font-mono text-[21px] font-bold leading-none tracking-tight",
                        pairChange !== null ? (pairChange >= 0 ? "text-emerald-400" : "text-red-400") : (pxFlashCls ?? "text-white"))}>
                        <PricePower text={priceUnit === "USD"
                          ? (pairPxUsd > 0 ? fmtUsd(pairPxUsd)
                            : pairPriceQuote > 0 ? `${fmtTiny(pairPriceQuote, 5)} ${trimSym(pairQuote?.symbol ?? "")}` : "-")
                          : (pairPxAse > 0 ? `${fmtTiny(pairPxAse, 5)} ASE`
                            : pairPriceQuote > 0 ? `${fmtTiny(pairPriceQuote, 5)} ${trimSym(pairQuote?.symbol ?? "")}` : "-")} />
                      </span>
                      <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-white/40" />
                    </button>
                    <p className="mt-1 text-[11px] text-white/60">
                      ≈ <PricePower text={priceUnit === "USD"
                        ? (pairPxAse > 0 ? `${fmtTiny(pairPxAse, 5)} ASE`
                          : pairPriceQuote > 0 ? `${fmtTiny(pairPriceQuote, 5)} ${trimSym(pairQuote?.symbol ?? "")}` : "-")
                        : (pairPxUsd > 0 ? fmtUsd(pairPxUsd) : "")} />
                      {pairChange !== null ? (
                        <span className={cn("ml-2 font-semibold", pairChange >= 0 ? "text-emerald-300" : "text-red-300")}>
                          {fmtChgPct(pairChange)}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-white/45">
                      <a href={explorerAddressUrl(pairAsset.address)} target="_blank" rel="noreferrer" className="transition hover:text-accent" title={pairAsset.address}>{shortenAddress(pairAsset.address, 6, 4)}</a>
                      <CopyBtn text={pairAsset.address} />
                    </p>
                  </div>
                  <div className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 pt-1 text-[11px]">
                    {([
                      ["24h Vol", safeBig(dayStats.volWei) > 0n
                        ? (priceUnit === "USD" ? (aseUsd > 0 ? `$${fmtCompact(Number(safeBig(dayStats.volWei)) / 1e18 * aseUsd)}` : "-") : `${fmtWeiCompact(dayStats.volWei)} ASE`)
                        : safeBig(dayStats.volQuoteWei || "0") > 0n
                          ? (priceUnit === "USD" && pairQuoteAsePx > 0 && aseUsd > 0
                            ? `$${fmtCompact(Number(safeBig(dayStats.volQuoteWei || "0")) / 10 ** (pairQuoteFull?.decimals ?? 18) * pairQuoteAsePx * aseUsd)}`
                            : `${fmtWeiCompact(dayStats.volQuoteWei ?? "0", pairQuoteFull?.decimals ?? 18)} ${trimSym(pairQuoteFull?.symbol ?? "")}`)
                          : (priceUnit === "USD" ? "$0" : "0 ASE")],
                      ["Pool LP", synthPool ? "…"
                        : priceUnit === "USD" && pairQuoteAsePx > 0 && aseUsd > 0
                          ? `$${fmtCompact(Number(poolQuoteReserve) / 10 ** (pairQuoteFull?.decimals ?? 18) * pairQuoteAsePx * aseUsd)}`
                          : `${fmtWeiCompact(poolQuoteReserve, pairQuoteFull?.decimals ?? 18)} ${trimSym(pairQuoteFull?.symbol ?? "ASE")}`],
                      ["MC", mcAse > 0 ? (priceUnit === "USD" && aseUsd > 0 ? `$${fmtCompact(mcAse * aseUsd)}` : `${fmtCompact(mcAse)} ASE`)
                        : !depletedPool && mcQuote > 0 ? `${fmtCompact(mcQuote)} ${trimSym(pairQuoteFull?.symbol ?? "")}` : "-"],
                      ["Supply", pairSupply > 0 ? `${fmtCompact(pairSupply)} ${trimSym(pairAssetFull?.symbol ?? "")}` : "-"]
                    ] as [string, string][]).map(([label, val]) => (
                      <div key={label} className="min-w-0">
                        <p className="text-[10px] text-white/40">{label}</p>
                        <p className="mt-0.5 truncate font-mono text-[11px] text-white/85" title={val}>{val}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {/* ── app tab strip — Price (chart) | Info (token facts) ── */}
              <div className={cn("flex items-center gap-5 border-y border-white/[0.06] px-4", mobileView === "trade" && "max-lg:hidden")}>
                {([["chart", "Price"], ["info", "Info"]] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setMobTab(k)}
                    className={cn("relative py-2 text-xs font-semibold transition", mobTab === k ? "text-white" : "text-white/45 hover:text-white/70")}>
                    {l}
                    {mobTab === k ? <span className="absolute inset-x-1 -bottom-px h-[2px] rounded-full bg-accent" /> : null}
                  </button>
                ))}
                <LiveIndicator className="ml-auto" />
              </div>
              {/* ── Info view — market/basic facts + links ── */}
              {mobTab === "info" ? (
                <div className="space-y-4 px-4 py-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/45">Market info</p>
                    <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2.5">
                      {([
                        ["Circulating Supply", circSupply > 0 ? `${fmtCompact(circSupply)} ${trimSym(pairAssetFull?.symbol ?? "")}` : "-"],
                        ["Market Cap", mcAse > 0 ? (aseUsd > 0 ? `$${fmtCompact(mcAse * aseUsd)}` : `${fmtCompact(mcAse)} ASE`) : mcQuote > 0 ? `${fmtCompact(mcQuote)} ${trimSym(pairQuoteFull?.symbol ?? "")}` : "-"],
                        ["Total Supply", pairSupply > 0 ? `${fmtCompact(pairSupply)} ${trimSym(pairAssetFull?.symbol ?? "")}` : "-"],
                        ["FDV", fdvAse > 0 ? (aseUsd > 0 ? `$${fmtCompact(fdvAse * aseUsd)}` : `${fmtCompact(fdvAse)} ASE`) : fdvQuote > 0 ? `${fmtCompact(fdvQuote)} ${trimSym(pairQuoteFull?.symbol ?? "")}` : "-"],
                        ["24h Vol", safeBig(dayStats.volWei) > 0n ? `${fmtWeiCompact(dayStats.volWei)} ASE` : safeBig(dayStats.volQuoteWei || "0") > 0n ? `${fmtWeiCompact(dayStats.volQuoteWei ?? "0", pairQuoteFull?.decimals ?? 18)} ${trimSym(pairQuoteFull?.symbol ?? "")}` : "0"],
                        ["Pool LP", synthPool ? "…" : `${fmtWeiCompact(poolQuoteReserve, pairQuoteFull?.decimals ?? 18)} ${trimSym(pairQuoteFull?.symbol ?? "ASE")}`]
                      ] as [string, string][]).map(([label, val]) => (
                        <div key={label} className="min-w-0">
                          <p className="text-[10px] text-white/40">{label}</p>
                          <p className="mt-0.5 truncate font-mono text-xs text-white/85" title={val}>{val}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/45">Basic info</p>
                    <div className="mt-2 space-y-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[10px] text-white/40">Contract</span>
                        <span className="flex items-center gap-1.5 font-mono text-[11px] text-white/80">
                          <a href={explorerAddressUrl(pairAsset.address)} target="_blank" rel="noreferrer" className="transition hover:text-accent">{shortenAddress(pairAsset.address, 6, 4)}</a>
                          <CopyBtn text={pairAsset.address} />
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[10px] text-white/40">Pair</span>
                        <span className="flex items-center gap-1.5 font-mono text-[11px] text-white/80">{trimSym(pairAsset.symbol)}-{trimSym(pairQuote?.symbol ?? "ASE")} · #{selected!.id} {selected ? <DexTag dex={selected.dex} /> : null}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[10px] text-white/40">Swap fee</span>
                        <span className="font-mono text-[11px] text-white/80">{feePct(safeBig(selected?.feeBps || feeBps.toString()))}%</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[10px] text-white/40">LP burned</span>
                        {lpBurnPctFinal > 0 && lpBurnHref ? (
                          <a href={lpBurnHref} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-mono text-[11px] text-white/80 transition hover:text-accent">
                            {lpBurnPctFinal.toFixed(1)}% <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        ) : (
                          <span className="font-mono text-[11px] text-white/80">{lpBurnPctFinal.toFixed(1)}%</span>
                        )}
                      </div>
                      {pairLpLock ? (
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[10px] text-white/40">LP locked</span>
                          <a href={pairLpLock.v2 ? `/lock/v2/${pairLpLock.id}` : `/lock/${pairLpLock.id}`} className="flex items-center gap-1 font-mono text-[11px] text-white/80 transition hover:text-accent">
                            {fmtWeiCompact(pairLpLock.amt.toString())} shares · <LockKeyhole className="h-2.5 w-2.5" />#{pairLpLock.id}
                          </a>
                        </div>
                      ) : null}
                      {pairTokLock ? (
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[10px] text-white/40">Tokens locked</span>
                          <a href={pairTokLock.v2 ? `/lock/v2/${pairTokLock.id}` : `/lock/${pairTokLock.id}`} className="flex items-center gap-1 font-mono text-[11px] text-white/80 transition hover:text-accent">
                            {fmtWeiCompact(pairTokLock.amt.toString(), pairAssetFull?.decimals ?? 18)} {trimSym(pairAssetFull?.symbol ?? "")} · <Lock className="h-2.5 w-2.5" />#{pairTokLock.id}
                          </a>
                        </div>
                      ) : null}
                      {taxOf(pairAsset?.address).buy > 0n || taxOf(pairAsset?.address).sell > 0n ? (
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[10px] text-white/40">Tax (buy/sell)</span>
                          <span className="font-mono text-[11px] text-amber-300/90">{(Number(taxOf(pairAsset?.address).buy) / 100).toFixed(2)}% / {(Number(taxOf(pairAsset?.address).sell) / 100).toFixed(2)}%</span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  {pairAssetFull?.meta?.description ? (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/45">About {trimSym(pairAssetFull.symbol)}</p>
                      {/* one line collapsed, chevron unfolds the full text —
                          same interaction as the desktop description strip */}
                      <button onClick={() => setDescOpen((o) => !o)} aria-expanded={descOpen}
                        className="mt-2 flex w-full items-start gap-1.5 text-left text-[11px] leading-relaxed text-white/60">
                        <ChevronDown className={cn("mt-0.5 h-3 w-3 shrink-0 transition-transform", descOpen && "rotate-180")} />
                        <span className={cn("min-w-0 flex-1", descOpen ? "whitespace-pre-wrap" : "truncate")}>{pairAssetFull.meta.description}</span>
                      </button>
                    </div>
                  ) : null}
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/45">Links</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {socialUrl("website", pairAssetFull?.meta?.website) ? (
                        <a href={socialUrl("website", pairAssetFull?.meta?.website)} target="_blank" rel="noreferrer" aria-label="Website" title="Website"
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-white/70 transition hover:border-white/25 hover:text-white">
                          <Globe className="h-3.5 w-3.5" />
                        </a>
                      ) : null}
                      {socialUrl("twitter", pairAssetFull?.meta?.twitter) ? (
                        <a href={socialUrl("twitter", pairAssetFull?.meta?.twitter)} target="_blank" rel="noreferrer" aria-label="X" title="X"
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-white/70 transition hover:border-white/25 hover:text-white">
                          <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
                        </a>
                      ) : null}
                      {socialUrl("telegram", pairAssetFull?.meta?.telegram) ? (
                        <a href={socialUrl("telegram", pairAssetFull?.meta?.telegram)} target="_blank" rel="noreferrer" aria-label="Telegram" title="Telegram"
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-white/70 transition hover:border-white/25 hover:text-white">
                          <Send className="h-3.5 w-3.5" />
                        </a>
                      ) : null}
                      <a href={explorerAddressUrl(pairAsset.address)} target="_blank" rel="noreferrer" aria-label="Explorer" title="Explorer"
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-white/70 transition hover:border-white/25 hover:text-white">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                      {pairAssetFull?.fromPad ? (
                        <a href={siteHref(`/asepad/token/${toAseAddress(pairAsset.address)}`)}
                          className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[10px] font-semibold text-white/70 transition hover:border-white/25 hover:text-white">
                          AsePad page <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
              {/* ── desktop header ── */}
              <div className="hidden items-center gap-x-7 px-4 py-3 lg:flex">
                <div className="flex shrink-0 items-start gap-2.5">
                  <span className="relative mt-0.5 shrink-0">
                    <TokenImg src={pairAsset.logoUrl} symbol={pairAsset.symbol} cls="h-11 w-11 rounded-[26%] border border-white/10 object-cover text-xs" />
                    {pairQuote?.address === NATIVE ? (
                      <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-black/60 bg-[#0a0a0a] p-0.5"><AseLogo size={9} /></span>
                    ) : null}
                  </span>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm font-bold tracking-tight">
                      <span className="max-w-[200px] truncate">{pairAssetFull?.name ?? pairAsset.symbol}</span><span className="shrink-0 font-normal text-white/45 max-sm:order-10 max-sm:basis-full">${trimSym(pairAsset.symbol)}-{trimSym(pairQuote?.symbol ?? "ASE")}</span>
                      {pairAssetFull?.fromPad && pairQuote?.address === NATIVE ? <PadTag token={pairAsset.address} /> : null}
                      <OfficialTag addr={pairAsset.address} />
                      <button onClick={() => toggleFav(poolKey(selected!.dex, selected!.id))} aria-label="Favourite pair" title="Favourite pair"
                        className={cn("transition", favs.has(poolKey(selected!.dex, selected!.id)) ? "text-amber-300" : "text-white/25 hover:text-white/60")}>
                        <Star className={cn("h-3.5 w-3.5", favs.has(poolKey(selected!.dex, selected!.id)) && "fill-amber-300")} />
                      </button>
                      <button onClick={() => setPairPickOpen(true)} aria-label="Change market" title="Change market"
                        className="rounded p-0.5 text-white/50 transition hover:bg-white/10 hover:text-white">
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    </p>
                    <p className="mt-0.5 flex items-baseline gap-2">
                      <button type="button" onClick={() => setPriceUnit((u) => (u === "USD" ? "ASE" : "USD"))}
                        title="Switch price unit" aria-label="Switch price unit"
                        className="flex items-center gap-1.5">
                        <span className={cn("font-mono text-xs font-bold", pxFlashCls ?? "text-white")}>
                          <PricePower text={priceUnit === "USD"
                            ? (pairPxUsd > 0 ? fmtUsd(pairPxUsd)
                              : pairPriceQuote > 0 ? `${fmtTiny(pairPriceQuote, 5)} ${trimSym(pairQuote?.symbol ?? "")}` : "-")
                            : (pairPxAse > 0 ? `${fmtTiny(pairPxAse, 5)} ASE`
                              : pairPriceQuote > 0 ? `${fmtTiny(pairPriceQuote, 5)} ${trimSym(pairQuote?.symbol ?? "")}` : "-")} />
                        </span>
                        <ArrowLeftRight className="h-3 w-3 shrink-0 text-white/40" />
                      </button>
                      {pairChange !== null ? (
                        <span className={cn("text-[11px] font-semibold", pairChange >= 0 ? "text-emerald-300" : "text-red-300")}>
                          {fmtChgPct(pairChange)}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1 font-mono text-[10px] text-white/40">
                      <a href={explorerAddressUrl(pairAsset.address)} target="_blank" rel="noreferrer" className="transition hover:text-accent" title={pairAsset.address}>{shortenAddress(pairAsset.address)}</a>
                      <CopyBtn text={pairAsset.address} />
                    </p>
                  </div>
                </div>
                <div className="flex min-w-0 flex-1 items-center gap-x-7 overflow-x-auto [&>*]:shrink-0">
                  <TermStat label="24h Vol" value={
                    safeBig(dayStats.volWei) > 0n
                      ? (priceUnit === "USD" ? (aseUsd > 0 ? `$${fmtCompact(Number(safeBig(dayStats.volWei)) / 1e18 * aseUsd)}` : "-") : `${fmtWeiCompact(dayStats.volWei)} ASE`)
                      : safeBig(dayStats.volQuoteWei || "0") > 0n
                        ? (priceUnit === "USD" && pairQuoteAsePx > 0 && aseUsd > 0
                          ? `$${fmtCompact(Number(safeBig(dayStats.volQuoteWei || "0")) / 10 ** (pairQuoteFull?.decimals ?? 18) * pairQuoteAsePx * aseUsd)}`
                          : `${fmtWeiCompact(dayStats.volQuoteWei ?? "0", pairQuoteFull?.decimals ?? 18)} ${trimSym(pairQuoteFull?.symbol ?? "")}`)
                        : (priceUnit === "USD" ? "$0" : "0 ASE")
                  } />
                  <TermStat label="Pool LP" value={
                    synthPool ? "…"
                      : priceUnit === "USD" && pairQuoteAsePx > 0 && aseUsd > 0
                        ? `$${fmtCompact(Number(poolQuoteReserve) / 10 ** (pairQuoteFull?.decimals ?? 18) * pairQuoteAsePx * aseUsd)}`
                        : `${fmtWeiCompact(poolQuoteReserve, pairQuoteFull?.decimals ?? 18)} ${trimSym(pairQuoteFull?.symbol ?? "ASE")}`
                  } />
                  <TermStat label="MC" value={
                    mcAse > 0 ? (priceUnit === "USD" && aseUsd > 0 ? `$${fmtCompact(mcAse * aseUsd)}` : `${fmtCompact(mcAse)} ASE`)
                      : !depletedPool && mcQuote > 0 ? `${fmtCompact(mcQuote)} ${trimSym(pairQuoteFull?.symbol ?? "")}` : "-"
                  } />
                  <TermStat label="FDV" value={
                    fdvAse > 0 ? (priceUnit === "USD" && aseUsd > 0 ? `$${fmtCompact(fdvAse * aseUsd)}` : `${fmtCompact(fdvAse)} ASE`)
                      : !depletedPool && fdvQuote > 0 ? `${fmtCompact(fdvQuote)} ${trimSym(pairQuoteFull?.symbol ?? "")}` : "-"
                  } />
                  <TermStat label="Supply" value={pairSupply > 0 ? `${fmtCompact(pairSupply)} ${trimSym(pairAssetFull?.symbol ?? "")}` : "-"} />
                </div>
                <span className="flex shrink-0 flex-col items-end gap-1.5">
                  <span className="flex items-center gap-1">
                    {depletedPool ? <LowLiqTag /> : null}
                    {selected ? <DexTag dex={selected.dex} /> : null}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="relative inline-flex">
                      <button type="button" onClick={(e) => { e.stopPropagation(); setBurnOpen((v) => !v); }}
                        title={`LP burned ${lpBurnPctFinal >= 99.95 ? 100 : lpBurnPctFinal.toFixed(1)}% — click for details`}
                        className={cn("inline-flex items-center transition", lpBurnPctFinal > 0 ? "text-orange-400 hover:text-orange-300" : "text-white/25 hover:text-white/45")}>
                        <Flame className="h-4 w-4" />
                      </button>
                      {burnOpen ? (
                        <span className="absolute right-0 top-full z-[80] mt-1.5 w-56 rounded-xl border border-white/10 bg-[#0d0f16] p-3 text-left shadow-xl" onClick={(e) => e.stopPropagation()}>
                          <p className="flex items-center gap-1.5 text-sm font-bold text-orange-400"><Flame className="h-4 w-4" />{lpBurnPctFinal >= 99.95 ? "100" : lpBurnPctFinal.toFixed(1)}% LP burned</p>
                          {lpBurnShares ? <p className="mt-1 font-mono text-[10px] text-white/60">{fmtWeiCompact(lpBurnShares)} shares burned</p> : null}
                          {lpBurnTx.data ? (
                            <a href={explorerTxUrl(lpBurnTx.data)} target="_blank" rel="noreferrer"
                              className="mt-2 flex items-center gap-1 text-[11px] text-white/60 transition hover:text-white">
                              <ExternalLink className="h-3 w-3" /> Burn transaction
                            </a>
                          ) : null}
                        </span>
                      ) : null}
                    </span>
                    <TaxTag buy={taxOf(pairAsset?.address).buy} sell={taxOf(pairAsset?.address).sell} pending={taxOf(pairAsset?.address).pending} />
                    {pairLpLock ? (
                      <a href={pairLpLock.v2 ? `/lock/v2/${pairLpLock.id}` : `/lock/${pairLpLock.id}`} onClick={(e) => e.stopPropagation()}
                        title={`LP locked · ${fmtWeiCompact(pairLpLock.amt.toString())} shares · view lock #${pairLpLock.id}`}
                        className="inline-flex items-center gap-0.5 text-emerald-300/90 transition hover:text-emerald-200">
                        <LockKeyhole className="h-4 w-4" /><span className="hidden text-[10px] font-bold leading-4 sm:inline">LP</span>
                      </a>
                    ) : null}
                    {pairTokLock ? (
                      <a href={pairTokLock.v2 ? `/lock/v2/${pairTokLock.id}` : `/lock/${pairTokLock.id}`} onClick={(e) => e.stopPropagation()}
                        title={`${trimSym(pairAssetFull?.symbol ?? "")} locked · ${fmtWeiCompact(pairTokLock.amt.toString(), pairAssetFull?.decimals ?? 18)} · view lock #${pairTokLock.id}`}
                        className="inline-flex items-center gap-0.5 text-sky-300/90 transition hover:text-sky-200">
                        <Lock className="h-4 w-4" /><span className="hidden text-[10px] font-bold leading-4 sm:inline">TOK</span>
                      </a>
                    ) : null}
                  </span>
                  <span className="flex items-center gap-2">
                    {socialUrl("website", pairAssetFull?.meta?.website) ? (
                      <a href={socialUrl("website", pairAssetFull?.meta?.website)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                        title="Website" className="inline-flex items-center text-white/45 transition hover:text-white">
                        <Globe className="h-4 w-4" />
                      </a>
                    ) : null}
                    {socialUrl("twitter", pairAssetFull?.meta?.twitter) ? (
                      <a href={socialUrl("twitter", pairAssetFull?.meta?.twitter)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                        title="X" className="inline-flex items-center text-white/45 transition hover:text-white">
                        <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
                      </a>
                    ) : null}
                    {socialUrl("telegram", pairAssetFull?.meta?.telegram) ? (
                      <a href={socialUrl("telegram", pairAssetFull?.meta?.telegram)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                        title="Telegram" className="inline-flex items-center text-white/45 transition hover:text-white">
                        <Send className="h-4 w-4" />
                      </a>
                    ) : null}
                  </span>
                </span>
              </div>
              {burnOpen ? (
                <div className="fixed inset-0 z-[70]" onClick={() => setBurnOpen(false)} />
              ) : null}
              {/* ── desktop description strip — one line, chevron expands ── */}
              {pairAssetFull?.meta?.description ? (
                <div className="hidden border-t border-white/[0.06] lg:block">
                  <button onClick={() => setDescOpen((o) => !o)} aria-expanded={descOpen}
                    className="flex w-full items-center gap-1.5 px-4 py-1.5 text-left text-[11px] text-white/55 transition hover:text-white/80">
                    <ChevronDown className={cn("h-3 w-3 shrink-0 transition-transform", descOpen && "rotate-180")} />
                    <span className={cn("min-w-0 flex-1", descOpen ? "whitespace-pre-wrap" : "truncate")}>{pairAssetFull.meta.description}</span>
                  </button>
                </div>
              ) : null}
            </>) : (
              /* header skeleton — same skeleton shape as the real header so the
                 swap doesn't jump: squircle logo + name/price/address lines +
                 stat columns + corner tags */
              <>
                <div className="flex items-center gap-x-7 px-4 py-3" aria-hidden>
                  <div className="flex min-w-0 items-start gap-2.5">
                    <div className="mt-0.5 h-11 w-11 shrink-0 animate-pulse rounded-[26%] bg-white/[0.07]" />
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <div className="h-4 w-36 animate-pulse rounded bg-white/[0.07]" />
                        <div className="h-3 w-16 animate-pulse rounded bg-white/[0.05]" />
                      </div>
                      <div className="h-3 w-24 animate-pulse rounded bg-white/[0.07]" />
                      <div className="h-2.5 w-28 animate-pulse rounded bg-white/[0.05]" />
                    </div>
                  </div>
                  <div className="hidden flex-1 items-start gap-x-7 md:flex">
                    {["24h Vol", "Pool LP", "MC", "FDV", "Supply"].map((l) => (
                      <div key={l} className="min-w-0 space-y-1">
                        <p className="text-[9px] uppercase tracking-wider text-white/40">{l}</p>
                        <div className="h-3 w-14 animate-pulse rounded bg-white/[0.07]" />
                      </div>
                    ))}
                  </div>
                  <div className="ml-auto flex shrink-0 items-center gap-2">
                    <div className="h-5 w-14 animate-pulse rounded-full bg-white/[0.07]" />
                    <div className="h-5 w-12 animate-pulse rounded-full bg-white/[0.07]" />
                  </div>
                </div>
              </>
            )}

                {/* futures-style chart toolbar — mobile-only tag row (unit
                    toggle + timeframe now live inside TokenChart's chrome) */}
                <div className={cn("flex items-center gap-1 overflow-x-auto border-y border-white/[0.06] px-2 py-1.5 lg:hidden", mobTab === "info" && "hidden")}>
                  <div className="flex items-center gap-1">
                    <TaxTag buy={taxOf(pairAsset?.address).buy} sell={taxOf(pairAsset?.address).sell} pending={taxOf(pairAsset?.address).pending} />
                    {pairLpLock ? (
                      <a href={pairLpLock.v2 ? `/lock/v2/${pairLpLock.id}` : `/lock/${pairLpLock.id}`} onClick={(e) => e.stopPropagation()}
                        title={`LP locked · ${fmtWeiCompact(pairLpLock.amt.toString())} shares · view lock #${pairLpLock.id}`}
                        className="inline-flex items-center gap-0.5 text-emerald-300/90 transition hover:text-emerald-200">
                        <LockKeyhole className="h-3.5 w-3.5" /><span className="text-[9px] font-bold">LP</span>
                      </a>
                    ) : null}
                    {pairTokLock ? (
                      <a href={pairTokLock.v2 ? `/lock/v2/${pairTokLock.id}` : `/lock/${pairTokLock.id}`} onClick={(e) => e.stopPropagation()}
                        title={`${trimSym(pairAssetFull?.symbol ?? "")} locked · ${fmtWeiCompact(pairTokLock.amt.toString(), pairAssetFull?.decimals ?? 18)} · view lock #${pairTokLock.id}`}
                        className="inline-flex items-center gap-0.5 text-sky-300/90 transition hover:text-sky-200">
                        <Lock className="h-3.5 w-3.5" /><span className="text-[9px] font-bold">TOK</span>
                      </a>
                    ) : null}
                    {selected ? <span className="rounded-md border border-white/10 bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white/60" title={`Pool #${selected.id}`}>#{selected.id}</span> : null}
                  </div>
                </div>
                <div className={cn("flex flex-1 flex-col lg:min-h-0", mobileView === "trade" && "max-lg:hidden", mobTab === "info" && "hidden")}>
                {selected ? (
                  <>
                    <div className="relative flex h-80 flex-col bg-[#07080d] lg:h-auto lg:min-h-0 lg:flex-1">
                      <TokenChart
                        symbol={`${trimSym(pairAsset?.symbol)}-${trimSym(chartUnit)}`}
                        tfLabel={chartRange}
                        tfs={[{ s: 900, l: "15m" }, { s: 3600, l: "1h" }, { s: 14400, l: "4h" }, { s: 86400, l: "1d" }, { s: 604800, l: "1w" }]}
                        tf={RANGE_SEC[chartRange]}
                        onTf={(s) => setChartRange(({ 900: "15m", 3600: "1h", 14400: "4h", 86400: "1d", 604800: "1w" } as const)[s] ?? "15m")}
                        formatPx={formatTokenPriceAxis}
                        unitToggle={selected ? <span className="rounded-md border border-white/10 bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white/60" title={`Pool #${selected.id}`}>#{selected.id}</span> : null}
                        candles={candles.map((c) => ({ time: c.t, open: c.o * chartScale, high: c.h * chartScale, low: c.l * chartScale, close: c.c * chartScale, volume: c.v * volScale }))}
                        lines={myChartOrders.map((o) => ({ price: o.price * chartScale, side: o.side }))}
                        loading={(auraCandles.isPending || swapHistory.isPending) && !candles.length}
                        empty={!candles.length && !(auraCandles.isPending || swapHistory.isPending)}
                      />
                    </div>
                    {myChartOrders.length ? (
                      <div className="mt-1.5 flex flex-wrap gap-x-3 text-[10px] text-white/60">
                        {myChartOrders.map((m, i) => (
                          <span key={i} className="inline-flex items-center gap-1">
                            <span className={cn("inline-block h-px w-3", m.side === "buy" ? "bg-emerald-400" : "bg-red-400")} />
                            your {m.side} limit · {fmtPx(m.price)}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div className="rounded-lg bg-white/[0.03] px-3 py-2.5"><p className="text-[10px] uppercase text-white/55">Reserve {trimSym(pairAssetFull?.symbol ?? selectedRow!.asset0.symbol)}</p><p className="mt-0.5 font-mono text-sm">{synthPool ? "…" : fmtWeiCompact(pairAssetFull!.address === selected.token0 ? selected.reserve0 : selected.reserve1, pairAssetFull?.decimals ?? 18)}</p></div>
                      <div className="rounded-lg bg-white/[0.03] px-3 py-2.5"><p className="text-[10px] uppercase text-white/55">Reserve {trimSym(pairQuoteFull?.symbol ?? selectedRow!.asset1.symbol)}</p><p className="mt-0.5 font-mono text-sm">{synthPool ? "…" : fmtWeiCompact(pairQuoteFull!.address === selected.token0 ? selected.reserve0 : selected.reserve1, pairQuoteFull?.decimals ?? 18)}</p></div>
                    </div>
                  </>
                ) : pools.isPending || legacyPools.isPending || selResolving || (wantsPoolFromUrl && !selectedRow) ? (
                  <ChartSkeleton className="flex h-72 flex-col lg:h-full" />
                ) : (
                  <div className="flex h-72 items-center justify-center text-sm text-white/60">Select a pool.</div>
                )}
                </div>
              </CardContent></Card>
              </div>

              </div>

              {/* ── trade panel — full-height right column; on mobile it swaps
                  in for the chart when Buy/Sell is tapped (book | form) ── */}
              <div className={cn("min-w-0 lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:self-start", mobileView === "chart" && "max-lg:hidden")}>
              <Card><CardContent className="p-0">
                <div className="flex items-center gap-2 border-b border-white/[0.07] px-3 py-2 lg:hidden">
                  <button onClick={() => setMobileView("chart")} className="inline-flex items-center gap-1 text-[11px] font-medium text-white/55 transition hover:text-white">
                    <ChevronDown className="h-3.5 w-3.5 rotate-90" /> Chart
                  </button>
                  <span className="ml-auto font-mono text-[10px] text-white/40">{trimSym(pairAsset?.symbol)}-{trimSym(pairQuote?.symbol ?? "ASE")} · #{selected?.id}</span>
                </div>
                {/* pair mini-stats — horizontal strip above the book|form split */}
                <div className="flex items-center gap-1.5 overflow-x-auto border-b border-white/[0.06] px-3 py-1.5 lg:hidden">
                  {([
                    ["MC", mcAse > 0 ? (aseUsd > 0 ? `$${fmtCompact(mcAse * aseUsd)}` : `${fmtCompact(mcAse)} ASE`) : mcQuote > 0 ? `${fmtCompact(mcQuote)} ${trimSym(pairQuoteFull?.symbol ?? "")}` : "-"],
                    ["24h Vol", safeBig(dayStats.volWei) > 0n ? `${fmtWeiCompact(dayStats.volWei)} ASE` : safeBig(dayStats.volQuoteWei || "0") > 0n ? `${fmtWeiCompact(dayStats.volQuoteWei ?? "0", pairQuoteFull?.decimals ?? 18)} ${trimSym(pairQuoteFull?.symbol ?? "")}` : "0"],
                    ["LP", synthPool ? "…" : `${fmtWeiCompact(poolQuoteReserve, pairQuoteFull?.decimals ?? 18)} ${trimSym(pairQuoteFull?.symbol ?? "ASE")}`],
                    ["Holders", holders.data?.count != null ? holders.data.count.toLocaleString() : holderCount.data != null ? holderCount.data.toLocaleString() : "…"]
                  ] as [string, string][]).map(([label, val]) => (
                    <span key={label} className="shrink-0 rounded-md border border-white/[0.07] bg-white/[0.03] px-2 py-1 font-mono text-[9px]" title={`${label} ${val}`}>
                      <span className="font-sans text-white/40">{label} </span><span className="font-semibold text-white/85">{val}</span>
                    </span>
                  ))}
                  {pairBuyRatio != null ? (
                    <span className="flex shrink-0 items-center gap-1 rounded-md border border-white/[0.07] bg-white/[0.03] px-2 py-1 font-mono text-[9px]">
                      <span className="text-emerald-400">{pairBuyRatio}%</span>
                      <span className="flex h-1 w-6 overflow-hidden rounded-full bg-red-400/80"><span className="bg-emerald-400" style={{ width: `${pairBuyRatio}%` }} /></span>
                      <span className="text-red-400">{100 - pairBuyRatio}%</span>
                    </span>
                  ) : null}
                </div>
                <div className="grid grid-cols-[minmax(108px,30%)_minmax(0,1fr)] lg:block">
                  <div className="border-r border-white/[0.06] lg:hidden">
                    <div className="flex justify-between border-b border-white/[0.05] px-2 py-1.5 text-[8px] font-semibold uppercase tracking-wider text-white/45">
                      <span>Price</span><span>Amt</span>
                    </div>
                    {renderDepthBook(7, true)}
                  </div>
                <div className="min-w-0 space-y-3 p-2.5 sm:space-y-4 sm:p-5">
                {pairAsset ? (
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => { if (pairQuote) { setTokenIn(pairQuote.address); setAmount(""); } }}
                      className={cn("rounded-lg py-2.5 text-sm font-bold transition max-lg:py-1.5 max-lg:text-xs", selectedInput?.address === pairQuote?.address ? "bg-emerald-500 text-black shadow-[0_0_24px_-4px_rgba(52,211,153,0.5)]" : "bg-white/[0.05] text-white/70 hover:bg-white/[0.08]")}>
                      Buy {trimSym(pairAsset.symbol)}
                    </button>
                    <button onClick={() => { setTokenIn(pairAsset.address); setAmount(""); }}
                      className={cn("rounded-lg py-2.5 text-sm font-bold transition max-lg:py-1.5 max-lg:text-xs", selectedInput?.address === pairAsset?.address ? "bg-red-500/90 text-white shadow-[0_0_24px_-4px_rgba(248,113,113,0.5)]" : "bg-white/[0.05] text-white/70 hover:bg-white/[0.08]")}>
                      Sell {trimSym(pairAsset.symbol)}
                    </button>
                  </div>
                ) : null}
                <div className="grid grid-cols-4 gap-1 rounded-lg bg-white/[0.05] p-1">
                  {(["swap", "limit", "dca"] as const).filter((v) => !selLegacy || v !== "dca").map((value) => (
                    <button key={value} onClick={() => setTab(value)}
                      className={cn("rounded-md py-1.5 text-xs font-medium transition max-lg:py-1 max-lg:text-[10px]", effTab === value ? "bg-white/10 text-white" : "text-white/65 hover:text-white/70")}>
                      {value === "dca" ? "DCA" : value === "swap" ? "Swap" : "Limit"}
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-[10px] max-lg:text-[9px] text-white/50">
                    {effTab === "swap" ? "Instant swap at the pool rate" : effTab === "limit" ? "Escrowed order, fills when the pool rate clears yours" : "Escrowed total, swaps a slice on every interval"}
                  </p>
                  {effTab === "swap" ? (
                    <div className="flex items-center gap-1" aria-label="Slippage">
                      <span className="text-[10px] max-lg:text-[9px] text-white/55">Slip</span>
                      <Input inputMode="decimal" className="h-7 w-14 px-2 text-right text-xs max-lg:h-6 max-lg:w-11 max-lg:text-[10px]" value={slippage} onChange={(e) => setSlippage(e.target.value)} />
                      <span className="text-[10px] max-lg:text-[9px] text-white/55">%</span>
                    </div>
                  ) : null}
                </div>
                {effTab === "limit" ? (
                  selected && selectedAssets.length === 2 ? (
                    <>
                      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 max-lg:p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] max-lg:text-[10px] text-white/60">You pay (escrowed)</span>
                          <span className="flex items-center gap-1 text-[11px] max-lg:text-[10px] text-white/55">{selectedInput?.address === NATIVE ? <AseLogo size={12} /> : null}{trimSym(selectedInput?.symbol)}</span>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.0" className="h-11 max-lg:h-9 min-w-0 flex-1 text-lg max-lg:text-base" />
                          <button type="button" onClick={() => { const other = selectedAssets.find((a) => a.address !== selectedInput?.address); if (other) { setTokenIn(other.address); setAmount(""); } }}
                            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold transition hover:border-white/25 max-lg:gap-1 max-lg:px-2 max-lg:py-1.5 max-lg:text-xs" title="Flip direction">
                            <ArrowDownUp className="h-3.5 w-3.5 max-lg:h-3 max-lg:w-3" />{selectedInput?.address === NATIVE ? <AseLogo size={14} /> : null}{trimSym(selectedInput?.symbol)}
                          </button>
                        </div>
                      </div>
                      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 max-lg:p-3">
                        <div className="flex items-center justify-between gap-2 text-[11px] max-lg:text-[10px] text-white/60">
                          <span className="min-w-0 truncate">Fill when {pairAsset?.symbol} price reaches</span>
                          <span className="shrink-0 whitespace-nowrap text-white/70">spot {pairPriceAse > 0 ? (limitUnit === "USD" ? fmtUsd(pairPriceAse * aseUsd) : <PricePower text={`${fmtTiny(pairPriceAse, 5)} ASE`} />) : currentSpot > 0 ? <PricePower text={`${fmtTiny(currentSpot, 5)} ${selectedOutput?.symbol ?? ""}`} /> : "…"}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Input value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} inputMode="decimal"
                            placeholder={spotInLimitUnit > 0 ? fmtTiny(spotInLimitUnit, 5) : "0.0"} className="h-10 max-lg:h-8 min-w-0 flex-1 max-lg:text-xs" />
                          {pairPriceAse > 0 && pairAsset ? (
                            <span className="flex shrink-0 overflow-hidden rounded-lg border border-white/10">
                              {(["ASE", "USD"] as const).map((u) => (
                                <button key={u} type="button" onClick={() => setLimitUnit(u)}
                                  className={cn("px-2.5 py-2 text-[11px] font-semibold transition max-lg:px-2 max-lg:py-1.5 max-lg:text-[10px]", limitUnit === u ? "bg-accent/15 text-accent" : "bg-white/[0.04] text-white/65 hover:text-white/70")}>
                                  {u}<span className="hidden sm:inline">/{pairAsset.symbol}</span>
                                </button>
                              ))}
                            </span>
                          ) : (
                            <span className="flex shrink-0 items-center gap-1 rounded-lg bg-white/[0.04] px-2.5 py-2 text-[11px] text-white/70 max-lg:px-2 max-lg:py-1.5 max-lg:text-[10px]">{trimSym(selectedOutput?.symbol)}/{trimSym(selectedInput?.symbol)}</span>
                          )}
                        </div>
                        {spotInLimitUnit > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1">
                            <button type="button" onClick={() => setLimitPrice(Number(spotInLimitUnit.toPrecision(10)).toString())}
                              className="rounded-md bg-white/[0.05] px-2 py-1 text-[10px] font-medium text-white/70 transition hover:text-white">
                              Spot
                            </button>
                            {[-10, -5, 5, 10].map((pct) => (
                              <button key={pct} type="button" onClick={() => setLimitPrice(Number((spotInLimitUnit * (1 + pct / 100)).toPrecision(10)).toString())}
                                className="rounded-md bg-white/[0.05] px-2 py-1 text-[10px] font-medium text-white/70 transition hover:text-white">
                                {pct > 0 ? `+${pct}%` : `${pct}%`}
                              </button>
                            ))}
                          </div>
                        ) : null}
                        <p className="mt-2 font-mono text-[11px] max-lg:text-[10px] text-white/55">
                          Fills when ≥ {limitMinOut && selectedOutput ? formatUnits(limitMinOut, selectedOutput.decimals) : "-"} {trimSym(selectedOutput?.symbol)}
                          {limitVsSpot !== null ? (
                            limitVsSpot <= 0 ? (
                              <span className="text-amber-300"> · at/below spot: fills on the next pass</span>
                            ) : (
                              <span className={limitVsSpot > 25 ? "text-amber-300" : "text-white/60"}> · {limitVsSpot > 0 ? "+" : ""}{limitVsSpot.toFixed(1)}% vs spot</span>
                            )
                          ) : null}
                        </p>
                      </div>
                      <Note scope="limit" />
                      <Button className="h-12 w-full text-base font-bold max-lg:h-10 max-lg:text-sm" disabled={Boolean(busy) || sellLocked || (wallet.status === "connected" && (!ordersEnabled || !amountWei || !limitMinOut))} onClick={() => void placeLimitOrder()}>
                        {busy || (sellLocked ? "Token locked, migrating" : wallet.status === "connected" ? "Place limit order" : "Connect wallet")}
                      </Button>
                      {selected?.dex === AURADEX_V2 && (
                        <p className="text-center text-[11px] text-white/45">AURAS v2: min ~0.1 ASE order value, max 10 open orders, orders expire in 30 days.</p>
                      )}
                    </>
                  ) : (
                    <p className="rounded-lg bg-white/[0.03] p-4 text-sm text-white/65">Select a pool.</p>
                  )
                ) : null}

                {effTab === "dca" ? (
                  selected && selectedAssets.length === 2 ? (
                    <>
                      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 max-lg:p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] max-lg:text-[10px] text-white/60">Total to DCA (escrowed)</span>
                          <span className="flex items-center gap-1 text-[11px] max-lg:text-[10px] text-white/55">{selectedInput?.address === NATIVE ? <AseLogo size={12} /> : null}{trimSym(selectedInput?.symbol)}</span>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.0" className="h-11 max-lg:h-9 min-w-0 flex-1 text-lg max-lg:text-base" />
                          <button type="button" onClick={() => { const other = selectedAssets.find((a) => a.address !== selectedInput?.address); if (other) { setTokenIn(other.address); setAmount(""); } }}
                            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold transition hover:border-white/25 max-lg:gap-1 max-lg:px-2 max-lg:py-1.5 max-lg:text-xs" title="Flip direction">
                            <ArrowDownUp className="h-3.5 w-3.5 max-lg:h-3 max-lg:w-3" />{selectedInput?.address === NATIVE ? <AseLogo size={14} /> : null}{trimSym(selectedInput?.symbol)}
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3 max-lg:gap-2">
                        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 max-lg:p-2.5">
                          <p className="text-[10px] uppercase text-white/55">Slices</p>
                          <Input inputMode="numeric" className="mt-1 h-9 max-lg:h-8 max-lg:text-xs" value={dcaSlices} onChange={(e) => setDcaSlices(e.target.value)} />
                        </div>
                        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 max-lg:p-2.5">
                          <p className="text-[10px] uppercase text-white/55">Every (min)</p>
                          <Input inputMode="numeric" className="mt-1 h-9 max-lg:h-8 max-lg:text-xs" value={dcaMinutes} onChange={(e) => setDcaMinutes(e.target.value)} />
                        </div>
                      </div>
                      <p className="flex items-center gap-1 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2 font-mono text-[11px] text-white/65 max-lg:px-2.5 max-lg:py-1.5 max-lg:text-[10px]">
                        ≈ {poolInWei && safeBig(dcaSlices || "0") > 0n ? formatUnits(poolInWei / safeBig(dcaSlices), selectedInput.decimals) : "-"} {selectedInput?.address === NATIVE ? <AseLogo size={11} /> : null}{trimSym(selectedInput?.symbol)} per slice → {selectedOutput?.address === NATIVE ? <AseLogo size={11} /> : null}{trimSym(selectedOutput?.symbol)}
                      </p>
                      <Note scope="dca" />
                      <Button className="h-12 w-full text-base font-bold max-lg:h-10 max-lg:text-sm" disabled={Boolean(busy) || sellLocked || (wallet.status === "connected" && (!dcaEnabled || !amountWei))} onClick={() => void placeDcaOrder()}>
                        {busy || (sellLocked ? "Token locked, migrating" : wallet.status === "connected" ? "Start DCA" : "Connect wallet")}
                      </Button>
                    </>
                  ) : (
                    <p className="rounded-lg bg-white/[0.03] p-4 text-sm text-white/65">Select a pool.</p>
                  )
                ) : null}

                {effTab === "swap" ? (
                  selected && selectedAssets.length === 2 ? (
                    <>
                      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 max-lg:p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] max-lg:text-[10px] text-white/60">You pay</span>
                          <span className="text-[11px] max-lg:text-[10px] text-white/55">
                            {selectedInput ? `bal ${formatUnits(inBalWei, selectedInput.decimals)}` : null}
                            {selectedInput && inBalWei > 0n ? (
                              <button type="button" className="ml-1.5 text-accent" onClick={() => selectedInput && setAmount(weiToDecimalStr(maxInWei, selectedInput.decimals))}>MAX</button>
                            ) : null}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.0" className="h-11 max-lg:h-9 min-w-0 flex-1 text-lg max-lg:text-base" />
                          <button
                            type="button"
                            onClick={() => { const other = selectedAssets.find((a) => a.address !== selectedInput?.address); if (other) { setTokenIn(other.address); setAmount(""); } }}
                            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold transition hover:border-white/25 max-lg:gap-1 max-lg:px-2 max-lg:py-1.5 max-lg:text-xs"
                            title="Flip direction"
                          >
                            <ArrowDownUp className="h-3.5 w-3.5 max-lg:h-3 max-lg:w-3" />
                            {selectedInput?.address === NATIVE ? <AseLogo size={14} /> : null}
                            {trimSym(selectedInput?.symbol)}
                          </button>
                        </div>
                        {selectedInput?.address === NATIVE ? (
                          <div className="mt-2.5 max-lg:mt-2 flex gap-1.5 max-lg:gap-1">
                            {["0.5", "1", "2.5", "5"].map((v) => (
                              <button key={v} type="button" onClick={() => setAmount(v)}
                                className={cn("flex-1 rounded-md py-1.5 text-[11px] transition max-lg:py-1 max-lg:text-[10px]", amount === v ? "bg-accent/15 text-accent" : "bg-white/[0.05] text-white/70 hover:text-white")}>
                                {v} ASE
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>

                      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 max-lg:p-3">
                        <div className="flex items-center justify-between text-[11px] max-lg:text-[10px] text-white/60">
                          <span>You receive</span>
                          <span className="flex items-center gap-1">{selectedOutput?.address === NATIVE ? <AseLogo size={12} /> : null}{trimSym(selectedOutput?.symbol)}</span>
                        </div>
                        <p className="mt-1.5 font-mono text-2xl font-semibold max-lg:text-lg">
                          {localQuote === null && quote.isFetching ? <span className="text-white/50">Fetching quote…</span> : displayedQuote}
                        </p>
                        <div className="mt-2 space-y-1 border-t border-white/[0.05] pt-2 text-[11px] max-lg:text-[10px] text-white/55">
                          <div className="flex justify-between"><span>Rate</span><span className="font-mono">1 {trimSym(selectedInput?.symbol)} ≈ {currentSpot > 0 ? <><PricePower text={`${fmtTiny(currentSpot, 6)} ${trimSym(selectedOutput?.symbol)}`} />{selectedOutput?.address === NATIVE && aseUsd > 0 ? ` (${fmtUsd(currentSpot * aseUsd)})` : ""}</> : "…"}</span></div>
                          <div className="flex justify-between"><span>Min received ({slippage}% slip)</span><span className="font-mono">{minReceived}</span></div>
                          <div className="flex justify-between">
                            <span>Price impact</span>
                            <span className={cn("font-mono", priceImpact <= -15 ? "text-red-300" : priceImpact <= -5 ? "text-amber-300" : "")}>{priceImpact ? `${priceImpact.toFixed(2)}%` : "0.00%"}</span>
                          </div>
                          <div className="flex justify-between"><span>Fee</span><span className="font-mono">{feePct(feeBps)}%</span></div>
                          {inTax.sell > 0n ? (
                            <div className="flex justify-between" title="Sell tax is taken out of the amount you sell. The pool trades the rest">
                              <span>Token sell tax</span>
                              <span className="font-mono text-amber-300/90">−{(Number(inTax.sell) / 100).toFixed(2)}%{inTaxWei && selectedInput ? ` = ${formatUnits(inTaxWei, selectedInput.decimals)} ${trimSym(selectedInput.symbol)}` : ""}</span>
                            </div>
                          ) : null}
                          {outTax.buy > 0n ? (
                            <div className="flex justify-between" title="Buy tax is skimmed from the tokens you receive">
                              <span>Token buy tax</span>
                              <span className="font-mono text-amber-300/90">-{(Number(outTax.buy) / 100).toFixed(2)}% receive</span>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      {bigImpact ? (
                        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/[0.07] px-3 py-2 text-[11px] leading-relaxed text-red-200/90 max-lg:px-2.5 max-lg:py-1.5 max-lg:text-[10px]">
                          <input type="checkbox" checked={impactOk} onChange={(e) => setImpactOk(e.target.checked)} className="mt-0.5 accent-red-400" />
                          This trade moves the price {Math.abs(priceImpact).toFixed(1)}%. The pool is too thin for this size. Tick to confirm anyway.
                        </label>
                      ) : null}

                      <Note scope="trade" />
                      <Button className="h-12 w-full text-base font-bold max-lg:h-10 max-lg:text-sm" disabled={Boolean(busy) || sellLocked || (wallet.status === "connected" && (!quoteOut || quoteOut <= 0n || !amountWei || inInsufficient || (bigImpact && !impactOk)))} onClick={() => void swap()}>
                        {busy || (sellLocked ? "Token locked, migrating" : inInsufficient ? `Insufficient ${trimSym(selectedInput?.symbol)}` : wallet.status === "connected"
                          ? (amountWei && quoteOut == null && (quote.isPending || quote.isFetching) ? "Fetching quote…" : `Swap ${trimSym(selectedInput?.symbol)} → ${trimSym(selectedOutput?.symbol)}`)
                          : "Connect wallet")}
                      </Button>
                      {selectedInput && selectedOutput && wallet.status === "connected" ? (() => {
                        const steps: string[] = [];
                        if (selectedInput.address !== NATIVE) {
                          const need = approveNeeded(selectedInput.address, selected!.dex, poolInWei ?? null);
                          if (need !== false) steps.push(`approve ${selectedInput.symbol}${need === null ? " (if needed)" : ""}`);
                        }
                        steps.push("swap");
                        return <p className="mt-1.5 text-center text-[10px] text-white/45">{txHint(steps)}</p>;
                      })() : null}
                      {sellLocked ? <p className="text-[11px] leading-relaxed text-amber-200/80">This AsePad token is locked to the DEX until its migration finishes. Sells keep working on its bonding curve.</p> : null}
                    </>
                  ) : (
                    <p className="rounded-lg bg-white/[0.03] p-4 text-sm text-white/65">Select a pool.</p>
                  )
                ) : null}

                {/* your position — wallet token balance × spot */}
                {pairAsset ? (
                  <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-white/55">Your position</p>
                      <div className="flex gap-1">
                        {[25, 50, 100].map((pct) => (
                          <button key={pct} type="button"
                            onClick={() => {
                              const bal = inBalWei;
                              if (selectedInput && bal > 0n) setAmount(weiToDecimalStr(bal * safeBig(pct) / 100n, selectedInput.decimals));
                            }}
                            className="rounded px-1.5 py-0.5 text-[10px] text-white/65 transition hover:bg-white/[0.07] hover:text-white">
                            {pct}%
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-3 font-mono">
                      <div>
                        <p className="text-[9px] uppercase text-white/50">Size</p>
                        <p className="mt-0.5 text-sm text-white/75">{pairAsset.address === NATIVE ? "-" : `${formatUnits(myTokenBalance.data || "0", pairAsset.decimals)} ${pairAsset.symbol}`}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[9px] uppercase text-white/50">Value</p>
                        <p className="mt-0.5 text-sm text-white/75">
                          {(() => {
                            try {
                              const bal = safeBig(myTokenBalance.data || "0");
                              const other = pairAsset && selectedRow ? (pairAsset.address === selectedRow.asset0.address ? selectedRow.asset1 : selectedRow.asset0) : undefined;
                              const tokR = safeBig(selected && pairAsset ? (selected.token0 === pairAsset.address ? selected.reserve0 : selected.reserve1) : "0");
                              const othR = safeBig(selected && pairAsset ? (selected.token0 === pairAsset.address ? selected.reserve1 : selected.reserve0) : "0");
                              if (bal <= 0n || tokR <= 0n || !other) return "-";
                              return `${formatUnits(bal * othR / tokR, other.decimals, 4)} ${other.symbol}`;
                            } catch { return "-"; }
                          })()}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}
                </div>
                </div>
              </CardContent></Card>
              </div>

              {/* ── trades | depth | my orders — collapsible bottom tabs;
                  on mobile it sits below the trade panel in trade view ── */}
              <div className={cn("min-w-0 overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02] lg:col-start-1 lg:row-start-2 lg:flex lg:h-[430px] lg:flex-col", mobTab === "info" && "hidden")}>
                <div className="flex flex-wrap items-center gap-1 border-b border-white/[0.07] px-3 py-2">
                  {([["trades", "Trades"], ["depth", "Depth"], ["orders", `My orders${openMyOrders.length ? ` (${openMyOrders.length})` : ""}`], ["holders", "Holders"]] as Array<["trades" | "depth" | "orders" | "holders", string]>).map(([t, l]) => (
                    <button key={t} onClick={() => setCenterTab(t)}
                      className={cn("rounded-md px-3 py-1.5 text-[11px] font-medium transition", centerTab === t ? "bg-white/10 text-white" : "text-white/60 hover:text-white/70")}>{l}</button>
                  ))}
                </div>
                <div className="flex min-h-0 flex-1 flex-col">
                {centerTab === "orders" ? (
                  <div className="flex items-center gap-3 border-b border-white/[0.07] px-3 py-2">
                    <span className="flex gap-0.5 rounded-md bg-white/[0.05] p-0.5">
                      {([["open", `Open orders ${openOrderRows.length}`], ["closed", `Closed orders ${closedOrderRows.length}`]] as const).map(([f, l]) => (
                        <button key={f} onClick={() => setOrdersFilter(f)}
                          className={cn("rounded px-2 py-0.5 text-[10px] font-medium transition", ordersFilter === f ? "bg-white/10 text-white" : "text-white/60 hover:text-white/70")}>{l}</button>
                      ))}
                    </span>
                  </div>
                ) : null}
                {centerTab === "trades" ? renderTradesList("max-h-80 lg:h-[380px] lg:shrink-0") : null}
                {centerTab === "depth" ? (
                  <div className="max-h-80 overflow-y-auto lg:h-[380px] lg:shrink-0">
                    {renderDepthBook()}
                  </div>
                ) : null}
                {centerTab === "orders" ? (
                  <div className="max-h-80 overflow-y-auto lg:h-[380px] lg:shrink-0">
                    <Note scope="orders" />
                    {orderRows(
                      ordersFilter === "open" ? openOrderRows : closedOrderRows,
                      ordersFilter === "open"
                        ? "No open orders. Place a Limit or DCA order above."
                        : "No filled orders yet. Instant buys/sells aren't orders; they show under Trades."
                    )}
                  </div>
                ) : null}
                {centerTab === "holders" ? (
                  <div className="max-h-80 overflow-auto lg:h-[380px] lg:shrink-0">
                    <div className="min-w-[440px]">
                      <div className="grid grid-cols-[2rem_1.4fr_1fr_1fr] gap-2 border-b border-white/[0.05] px-4 py-2 text-[9px] uppercase tracking-wider text-white/50">
                        <span>#</span><span>Holder{holders.data?.count ? ` (${holders.data.count.toLocaleString()})` : holderCount.data ? ` (${holderCount.data.toLocaleString()})` : (pairAsset && asepadPeekHolders(pairAsset.address)?.count ? ` (${asepadPeekHolders(pairAsset.address)!.count.toLocaleString()})` : "")}</span><span className="text-right">Balance</span><span className="text-right">Share</span>
                      </div>
                      {holderRows.map((h, i) => {
                        const addr = h.address.toLowerCase();
                        const creatorLc = holders.data?.creator?.toLowerCase();
                        const tag = addr === ownerHex?.toLowerCase() ? "you"
                          : addr === PAD.toLowerCase() ? "AsePad"
                          : addr === pairAsset?.address.toLowerCase() ? "Token"
                          : addr === DEAD ? "Burned" : addr === ZERO ? "zero"
                          : VENUES.includes(addr) || isLegacyDex(addr) ? dexName(addr)
                          : creatorLc && addr === creatorLc ? "dev"
                          : h.tag ?? null;
                        const pct = holders.data && holders.data.supply > 0n ? Number(h.balance * 10000n / holders.data.supply) / 100 : 0;
                        return (
                          <div key={h.address} className="grid grid-cols-[2rem_1.4fr_1fr_1fr] gap-2 border-b border-white/[0.03] px-4 py-1.5 font-mono text-[11px]">
                            <span className="text-white/50">{i + 1}</span>
                            <a href={explorerAddressUrl(h.address)} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1 text-white/70 transition hover:text-accent" title={h.address}>
                              <span className="truncate">{holderNames[addr] ? `@${holderNames[addr].replace(/^@/, "")}` : VENUES.includes(addr) || isLegacyDex(addr) ? dexName(addr) : addr === PAD.toLowerCase() ? "AsePad" : shortenAddress(h.address)}</span>{VENUES.includes(addr) || isLegacyDex(addr) || addr === PAD.toLowerCase() ? <svg className="h-3 w-3 shrink-0 text-sky-400" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.7-9.3a1 1 0 00-1.4-1.4L9 10.6 7.7 9.3a1 1 0 00-1.4 1.4l2 2a1 1 0 001.4 0l4-4z" clipRule="evenodd"/></svg> : tag ? <span className={cn("shrink-0 rounded px-1 text-[9px] font-sans", tag === "you" ? "bg-accent/15 text-accent" : "bg-white/10 text-white/60")}>{tag}</span> : null}
                            </a>
                            <span className="text-right text-white/70">{pairAsset ? fmtCompact(Number(h.balance) / 10 ** pairAsset.decimals) : "0"}</span>
                            <span className="text-right text-white/70">{pct < 0.01 && pct > 0 ? "<0.01" : pct.toFixed(2)}%</span>
                          </div>
                        );
                      })}
                      {!holderRows.length ? (
                        <p className="p-5 text-center text-[11px] text-white/50">
                          {holders.isPending ? "Loading holders…" : pairAsset ? `No ${pairAsset.symbol} holders found yet.` : "Select a pool."}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                </div>
              </div>
            </div>

            <p className="text-center text-[11px] text-white/50">All pool data, swaps, and token metadata are read directly from AseDex contracts on Asentum and update every block.</p>

            {/* ── mobile action bar — app-style Swap | Buy | Sell; in the
                trade view it becomes the chart-return strip ── */}
            {pairAsset ? (
              <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.08] bg-[#07080d]/95 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl lg:hidden">
                {mobileView === "trade" ? (
                  <button onClick={() => setMobileView("chart")}
                    className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-left transition active:scale-[0.99]">
                    <ChevronDown className="h-3.5 w-3.5 rotate-90 shrink-0 text-white/60" />
                    <span className="text-xs font-semibold text-white/85">{trimSym(pairAsset.symbol)}-{trimSym(pairQuote?.symbol ?? "ASE")} Chart</span>
                    <span className="ml-auto font-mono text-[11px] text-white/75">
                      <PricePower text={priceUnit === "USD"
                        ? (pairPxUsd > 0 ? fmtUsd(pairPxUsd) : fmtTiny(pairPriceQuote, 5))
                        : (pairPxAse > 0 ? `${fmtTiny(pairPxAse, 5)} ASE`
                          : pairPriceQuote > 0 ? `${fmtTiny(pairPriceQuote, 5)} ${trimSym(pairQuote?.symbol ?? "")}` : "-")} />
                    </span>
                    {pairChange !== null ? (
                      <span className={cn("font-mono text-[10px] font-semibold", pairChange >= 0 ? "text-emerald-300" : "text-red-300")}>
                        {fmtChgPct(pairChange)}
                      </span>
                    ) : null}
                  </button>
                ) : (
                  <>
                    <div className="flex items-center justify-between px-1 pb-1.5 text-[10px] text-white/45">
                      <span>My Bal {pairAsset.address !== NATIVE ? `${fmtCompact(Number(myTokenBalance.data || "0") / 10 ** pairAsset.decimals)} ${trimSym(pairAsset.symbol)}` : "-"}</span>
                      {pairChange !== null ? (
                        <span className={pairChange >= 0 ? "text-emerald-300" : "text-red-300"}>24h {fmtChgPct(pairChange)}</span>
                      ) : <span />}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={() => { if (pairQuote) { setTokenIn(pairQuote.address); setAmount(""); } setMobTab("chart"); setMobileView("trade"); }}
                        className="rounded-xl bg-emerald-500 py-3 text-sm font-bold text-black transition active:scale-[0.98]">
                        Buy
                      </button>
                      <button onClick={() => { setTokenIn(pairAsset.address); setAmount(""); setMobTab("chart"); setMobileView("trade"); }}
                        className="rounded-xl bg-red-500/90 py-3 text-sm font-bold text-white transition active:scale-[0.98]">
                        Sell
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </div>
        )}
        </motion.div>
        </AnimatePresence>

        {/* ── liquidity modal — add/remove LP on any pool ── */}
        <AnimatePresence>
          {burnModal ? <BurnModal pct={burnModal.pct} shares={burnModal.shares} tx={burnModal.tx} x={burnModal.x} y={burnModal.y} onClose={() => setBurnModal(null)} /> : null}
          {lpRow && liq0 && liq1 ? (() => {
            const pool = lpRow.pool;
            const total = safeBig(pool.totalShares || "0");
            const burn = lpShares * safeBig(liquidityPercent || "0") / 100n;
            const recv0 = total > 0n ? burn * safeBig(pool.reserve0) / total : 0n;
            const recv1 = total > 0n ? burn * safeBig(pool.reserve1) / total : 0n;
            // A tax token skims its buy tax off the dex→wallet payout — the
            // withdrawal can't revert, the wallet just receives the net.
            const recvNet = (a: Asset, amt: bigint) => {
              const buy = taxOf(a.address).buy;
              return buy > 0n ? amt - (amt * buy) / 10000n : amt;
            };
            const shareLeft = total > 0n ? Number((lpShares - burn) * 10000n / total) / 100 : 0;
            const pairLabel = `${liq0.symbol}/${liq1.symbol}`;
            const assetLogo = (a: Asset) => a.address === NATIVE
              ? <AseLogo size={18} />
              : <TokenImg src={a.logoUrl} symbol={a.symbol} cls="h-[18px] w-[18px] rounded-lg border border-white/10 object-cover text-[7px]" />;
            return (
              <motion.div key="lp-modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
                className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 backdrop-blur-sm sm:items-center"
                onClick={() => setLpRow(null)}>
                <motion.div initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.98 }} transition={{ duration: 0.18, ease: "easeOut" }}
                  className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0d0f16] p-4 shadow-[0_24px_80px_-16px_rgba(0,0,0,0.9)] sm:p-5"
                  onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">{lpMode === "remove" ? "Remove liquidity" : "Add liquidity"} · {pairLabel}</h3>
                    <button onClick={() => setLpRow(null)} className="rounded-lg p-1.5 text-white/55 transition hover:bg-white/[0.07] hover:text-white"><X className="h-4 w-4" /></button>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-white/[0.05] p-1">
                    {(["add", "remove"] as const).map((m) => (
                      <button key={m} onClick={() => setLpMode(m)} disabled={m === "remove" && lpShares <= 0n}
                        className={cn("rounded-md py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40", lpMode === m ? "bg-white/10 text-white" : "text-white/65 hover:text-white/70")}>
                        {m === "add" ? "Add" : "Remove"}
                      </button>
                    ))}
                  </div>

                  {lpMode === "add" ? (
                    <div className="mt-4 space-y-3">
                      <p className="text-[11px] text-white/60">{poolPriced ? `Paired at pool ratio: 1 ${liq0.symbol} = ${fmtTiny(humanPrice(pool.reserve0, liq0.decimals, pool.reserve1, liq1.decimals), 6)} ${liq1.symbol}` : lpRow.pool.tvlQuote != null ? "Loading pool ratio…" : "First deposit sets the price"}</p>
                      {[0, 1].map((side) => {
                        const a = side === 0 ? liq0 : liq1;
                        const v = side === 0 ? liqAmt0 : liqAmt1;
                        const set = side === 0 ? onLiq0Change : onLiq1Change;
                        const bal = side === 0 ? liqBal0 : liqBal1;
                        const over = side === 0 ? liqOver0 : liqOver1;
                        const sellBps = taxOf(a?.address).sell;
                        const maxSpend = sellBps > 0n ? (bal * (10000n - sellBps)) / 10000n : bal;
                        return (
                          <div key={side} className={cn("rounded-xl border bg-black/30 px-3 py-2.5 transition", over ? "border-red-500/40" : "border-white/10 focus-within:border-white/25")}>
                            <div className="flex items-center gap-2">
                              <input value={v} onChange={(e) => set(e.target.value)} inputMode="decimal" placeholder="0.0"
                                className="min-w-0 flex-1 bg-transparent text-base font-semibold text-white outline-none placeholder:text-white/35" />
                              <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-white/85">{assetLogo(a)}{a.symbol}{a.fromPad ? <PadTag token={a.address} className="h-3.5 w-3.5" /> : null}<OfficialTag addr={a.address} className="h-3.5 w-3.5" /></span>
                            </div>
                            <div className="mt-1 flex items-center justify-between text-[10px]">
                              <span className={cn("font-mono", over ? "text-red-300" : "text-white/50")}>Balance {formatUnits(bal, a.decimals, 4)} {a.symbol}{sellBps > 0n ? ` (+${Number(sellBps) / 100}% tax)` : ""}</span>
                              <button type="button" className="font-semibold text-accent transition hover:underline disabled:opacity-40" disabled={maxSpend <= 0n}
                                onClick={() => { if (maxSpend > 0n) set(weiToDecimalStr(maxSpend, a.decimals)); }}>Max</button>
                            </div>
                          </div>
                        );
                      })}
                      <Note scope="lp" />
                      <Button className="w-full" disabled={Boolean(busy) || liquidityLocked || (wallet.status === "connected" && (!parsedAse || !parsedAsset || liqInsufficient))} onClick={() => void addLiquidity()}>
                        {busy || (liquidityLocked ? "Token locked, migrating" : liqOver0 ? `Insufficient ${liq0.symbol}` : liqOver1 ? `Insufficient ${liq1.symbol}` : wallet.status === "connected" ? "Add liquidity" : "Connect wallet")}
                      </Button>
                      {wallet.status === "connected" && lpRow && liq0 && liq1 ? (() => {
                        const steps: string[] = [];
                        for (const [a, amt] of [[liq0, parsedAse], [liq1, parsedAsset]] as [Asset, bigint | null][]) {
                          if (a.address === NATIVE) continue;
                          const need = approveNeeded(a.address, lpRow.pool.dex, amt);
                          if (need !== false) steps.push(`approve ${a.symbol}${need === null ? " (if needed)" : ""}`);
                        }
                        steps.push("add liquidity");
                        return <p className="mt-1.5 text-center text-[10px] text-white/45">{txHint(steps)}</p>;
                      })() : null}
                      {liquidityLocked ? <p className="text-[11px] leading-relaxed text-amber-200/80">AsePad tokens accept liquidity only through the official migration. Finalize it to unlock.</p> : null}
                      <p className="text-center text-[10px] leading-relaxed text-white/45">LPs earn a share of every trade in this pool.</p>
                    </div>
                  ) : (
                    <div className="mt-4">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-white/55">Amount</p>
                      <div className="mt-1.5 grid grid-cols-4 gap-2">
                        {["25", "50", "75", "100"].map((value) => (
                          <button key={value} onClick={() => setLiquidityPercent(value)}
                            className={cn("rounded-lg py-2 text-xs font-medium transition", liquidityPercent === value ? "bg-accent/15 text-accent" : "bg-white/5 text-white/55 hover:text-white")}>
                            {value === "100" ? "Max" : `${value}%`}
                          </button>
                        ))}
                      </div>
                      <div className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                        <p className="text-[10px] uppercase tracking-wider text-white/55">You receive ≈</p>
                        <div className="mt-1.5 space-y-1">
                          {[0, 1].map((side) => {
                            const a = side === 0 ? liq0 : liq1;
                            const amt = side === 0 ? recv0 : recv1;
                            const buyBps = taxOf(a.address).buy;
                            return (
                              <p key={side} className="flex items-center gap-1.5 font-mono text-xs text-white/85">
                                {assetLogo(a)}{formatUnits(recvNet(a, amt), a.decimals, 4)} {a.symbol}{a.fromPad ? <PadTag token={a.address} className="h-3.5 w-3.5" /> : null}<OfficialTag addr={a.address} className="h-3.5 w-3.5" />
                                {buyBps > 0n ? <span className="text-[9px] text-white/45">(net of {Number(buyBps) / 100}% tax)</span> : null}
                              </p>
                            );
                          })}
                        </div>
                        <div className="mt-2 flex items-center justify-between border-t border-white/[0.06] pt-2 text-[10px]">
                          <span className="uppercase tracking-wider text-white/55">Pool share left</span>
                          <span className="font-mono text-white/75">{shareLeft.toFixed(2)}%</span>
                        </div>
                      </div>
                      <Note scope="lp" />
                      <Button className="mt-3 w-full" disabled={Boolean(busy) || (wallet.status === "connected" && lpShares <= 0n)} onClick={() => void removeLiquidity()}>
                        {busy || (wallet.status === "connected" ? (liquidityPercent === "100" ? "Remove all" : `Remove ${liquidityPercent}%`) : "Connect wallet")}
                      </Button>
                      {wallet.status === "connected" && lpShares > 0n ? <p className="mt-1.5 text-center text-[10px] text-white/45">1 transaction: remove liquidity</p> : null}
                      <p className="mt-2 text-center text-[10px] text-white/50">{lpShares <= 0n ? "No LP shares in this wallet" : "pick how much to withdraw"}</p>
                      {lpRewardsPending ? (
                        <div className="mt-3 rounded-lg border border-accent/20 bg-accent/[0.06] p-2.5">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-accent/70">Pending LP rewards</p>
                          <p className="mt-1 font-mono text-xs text-white/80">
                            {safeBig(lpRewards.amount0) > 0n ? `${formatUnits(safeBig(lpRewards.amount0), liq0.decimals, 6)} ${liq0.symbol}` : ""}
                            {safeBig(lpRewards.amount0) > 0n && safeBig(lpRewards.amount1) > 0n ? " · " : ""}
                            {safeBig(lpRewards.amount1) > 0n ? `${formatUnits(safeBig(lpRewards.amount1), liq1.decimals, 6)} ${liq1.symbol}` : ""}
                          </p>
                          <button className="mt-1.5 text-[10px] font-medium text-accent hover:underline" disabled={Boolean(busy)}
                            onClick={() => void claimLpRewards()}>{busy || "Claim rewards"}</button>
                        </div>
                      ) : null}
                    </div>
                  )}
                </motion.div>
              </motion.div>
            );
          })() : null}
        </AnimatePresence>

        {/* ── pair picker modal — markets browser + favourites ── */}
        <AnimatePresence>
          {pairPickOpen ? (
            <motion.div key="pair-pick" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
              className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 backdrop-blur-sm sm:items-center"
              onClick={() => setPairPickOpen(false)}>
              <motion.div initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.98 }} transition={{ duration: 0.18, ease: "easeOut" }}
                className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0d0f16] shadow-[0_24px_80px_-16px_rgba(0,0,0,0.9)]"
                onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between px-4 pt-4">
                  <h3 className="text-sm font-semibold">Select market</h3>
                  <button onClick={() => setPairPickOpen(false)} className="rounded-lg p-1.5 text-white/55 transition hover:bg-white/[0.07] hover:text-white"><X className="h-4 w-4" /></button>
                </div>
                <div className="px-4 pt-3">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/50" />
                    <Input value={pairPickQ} onChange={(e) => setPairPickQ(e.target.value)} placeholder="Name, ticker or contract" autoFocus
                      className="h-9 w-full pl-8 text-xs" />
                  </div>
                  <div className="mt-3 flex gap-1 overflow-x-auto rounded-lg bg-white/[0.05] p-0.5">
                    {([
                      ...(favs.size > 0 ? [["fav", "Favourites"] as const] : []),
                      ["all", "All"], ["vol", "Trending"], ["gainers", "24h Gainers"], ["losers", "24h Losers"]
                    ] as const).map(([v, l]) => (
                      <button key={v} onClick={() => setPairPickTab(v)}
                        className={cn("shrink-0 rounded-md px-3 py-1.5 text-[11px] font-medium transition", effPickTab === v ? "bg-white/10 text-white" : "text-white/65 hover:text-white/70")}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mt-2 min-h-0 flex-1 overflow-y-auto pb-2">
                  {pools.isPending && !pairPickRows.length ? (
                    <>
                      <p className="px-4 py-2 text-[11px] font-medium text-white/55">Loading markets…</p>
                      {Array.from({ length: 6 }).map((_, i) => <PairRowSkeleton key={i} />)}
                    </>
                  ) : pairPickRows.slice(0, 120).map((row) => {
                    const pk = poolKey(row.pool.dex, row.pool.id);
                    return <PairPickRow key={pk} row={row} isFav={favs.has(pk)} stat={statOf(row)}
                      usdRate={aseUsdRate} priceMap={asePriceByToken} onOpen={pickPair} onFav={toggleFav} />;
                  })}
                  {pairPickRows.length > 120 ? (
                    <p className="px-4 py-2.5 text-center text-[10px] text-white/40">Showing 120 of {pairPickRows.length} — search to narrow down</p>
                  ) : null}
                  {!pools.isPending && !pairPickRows.length ? (
                    <p className="p-6 text-center text-[11px] text-white/50">
                      {pairPickQ.trim() ? `No markets match "${pairPickQ.trim()}".`
                        : effPickTab === "fav" ? "No favourites yet — tap a star to save one."
                        : "No liquid markets yet."}
                    </p>
                  ) : null}
                </div>
              </motion.div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </PageShell>
    </>
    </OfficialTokensCtx.Provider>
  );
}
