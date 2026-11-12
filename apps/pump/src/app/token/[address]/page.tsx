"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PricePower } from "@/components/price-power";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { LiveIndicator } from "@/components/live/live-chain";
import { useAseBalance } from "@/lib/use-ase-balance";
import { useNames, namedAddr } from "@/lib/use-names";
import { UNIFIED_API, apiWallet } from "@/lib/ase-api";
import { TokenChart } from "@/components/token-chart";
import { ChartSkeleton } from "@/components/chart-skeleton";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDownUp, ArrowLeft, Check, ChevronDown, ChevronUp, Copy, ExternalLink, Flame, Globe, Rocket, Send, ShieldCheck, ShieldAlert } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  asepadGetLaunch,
  asepadGetCandles, asepadGetHolders, asepadGetConfig, asepadGetLaunches,
  asepadPeekLaunch, asepadPeekCandles, asepadPeekHolders, asepadPeekLaunches,
  aseToWei, bondingMessage, fmtAse, fmtAseCompact, fmtExactWei, fmtTokens, fmtUsd, formatTokenPrice, formatTokenPriceAxis, formatTokenPriceLabel, linkUrl, safeBig, socialUrl, shortenAddress, verifyTokenSource, weiToDecimal,
  type AsepadTrade
} from "@/lib/asepad";
import { explorerTxUrl, explorerAddressUrl } from "@/lib/explorer";
import { dexGateInvalidate } from "@/lib/dex-gate";
import { sameAddress, toAseAddress, toHexAddress } from "@asentrise/utils";
import { sendWalletCall, requireWalletTxMined, viewContract } from "@/lib/asentum-wallet";
import { useWalletStore } from "@/stores/wallet";
import { cn } from "@/lib/cn";
import { href as siteHref } from "@/lib/site";

const ASE_LOGO = "/ase.png";
const AseLogo = ({ size = 14, className }: { size?: number; className?: string }) => (
  <img src={ASE_LOGO} alt="ASE" width={size} height={size} className={cn("inline-block rounded-full object-cover", className)} />
);

const QUICK_BUY = ["0.5", "1", "5", "10"];
const QUICK_SELL = ["25", "50", "100"];
const SLIPPAGE_PRESETS = ["0.5", "1", "3", "5", "10"];
function slippageToBps(value: string): bigint {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error("Enter slippage as a percentage with up to 2 decimals");
  const [whole, fraction = ""] = value.split(".");
  const bps = safeBig(whole) * 100n + safeBig((fraction + "00").slice(0, 2));
  if (bps <= 0n || bps > 5000n) throw new Error("Slippage must be greater than 0% and at most 50%");
  return bps;
}
const INTERVALS = [{ s: 60, l: "1m" }, { s: 300, l: "5m" }, { s: 900, l: "15m" }, { s: 3600, l: "1h" }, { s: 86400, l: "1d" }];
type PriceUnit = "ASE" | "USD";
const PRICE_UNITS: readonly PriceUnit[] = ["ASE", "USD"];

// Shared glass panel - same surface language as the asepad board.
const Panel = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("relative overflow-hidden rounded-2xl border border-white/[0.08] bg-black/30 backdrop-blur-md", className)}>
    {children}
  </div>
);

// Bonding trace ramp: silver (0-30) → emerald (30-70) → amber (70-100),
// interpolated between stops so the logo ring fades color to color.
const RING_STOPS: [number, string][] = [[0, "#e4e4e7"], [30, "#e4e4e7"], [50, "#34d399"], [70, "#34d399"], [85, "#fbbf24"], [100, "#fbbf24"]];
function ringColor(pct: number) {
  const p = Math.max(0, Math.min(100, pct));
  const hi = RING_STOPS.findIndex(([s]) => p <= s);
  if (hi <= 0) return RING_STOPS[0][1];
  const [s0, c0] = RING_STOPS[hi - 1];
  const [s1, c1] = RING_STOPS[hi];
  if (s1 === s0) return c1;
  const t = (p - s0) / (s1 - s0);
  const n0 = parseInt(c0.slice(1), 16), n1 = parseInt(c1.slice(1), 16);
  const m = [16, 8, 0].map((sh) => Math.round(((n0 >> sh) & 255) + (((n1 >> sh) & 255) - ((n0 >> sh) & 255)) * t));
  return `#${m.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// Squircle logo inside the live bonding-trace ring - identical visual to the
// board card, so a token's progress reads the same everywhere.
const RingedLogo = ({ pct, children, box = "h-16 w-16 sm:h-20 sm:w-20" }: { pct: number; children: React.ReactNode; box?: string }) => {
  const p = Math.max(1, Math.min(100, pct));
  const endDeg = (p / 100) * 360;
  const stops = RING_STOPS.filter(([s]) => s <= p).map(([s, c]) => `${c} ${(s * 3.6).toFixed(1)}deg`);
  stops.push(`${ringColor(p)} ${endDeg.toFixed(1)}deg`);
  stops.push(`rgba(255,255,255,0.09) ${endDeg.toFixed(1)}deg`, "rgba(255,255,255,0.09) 360deg");
  return (
    <div className={cn("shrink-0 rounded-[26%] p-[1.5px]", box)}
      style={{ background: `conic-gradient(from -25deg at 50% 50%, ${stops.join(", ")})` }}>
      <div className="h-full w-full overflow-hidden rounded-[23%] bg-zinc-800">
        {children}
      </div>
    </div>
  );
};

// Segmented pill control - matches the board's sliding-pill tabs.
function SegTabs<T extends string | number>({
  options, value, onChange, layoutId, disabled
}: {
  options: readonly { v: T; l: string; disabled?: boolean }[];
  value: T;
  onChange: (v: T) => void;
  layoutId: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-full border border-white/[0.07] bg-white/[0.03] p-0.5">
      {options.map((o) => {
        const active = o.v === value;
        const off = disabled || o.disabled;
        return (
          <button key={String(o.v)} type="button" aria-pressed={active} disabled={off}
            onClick={() => onChange(o.v)}
            className={cn("relative rounded-full px-2.5 py-1 text-[10px] font-bold transition",
              active ? "text-white" : off ? "cursor-not-allowed text-white/30" : "text-white/55 hover:text-white/85")}>
            {active ? <motion.span layoutId={layoutId} className="absolute inset-0 rounded-full bg-white/[0.12]" transition={{ type: "spring", stiffness: 400, damping: 30 }} /> : null}
            <span className="relative">{o.l}</span>
          </button>
        );
      })}
    </div>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        onClick={() => { void navigator.clipboard.writeText(toAseAddress(text) || text); setOk(true); setTimeout(() => setOk(false), 1500); }}
        className={cn(
          "flex h-4 w-4 items-center justify-center rounded border transition",
          ok
            ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-300"
            : "border-white/10 bg-white/5 text-white/65 hover:border-white/25 hover:text-white"
        )}
        title="Copy contract address"
        aria-label="Copy contract address"
      >
        {ok ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
      </button>
      {ok ? (
        <motion.span
          initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-emerald-400/30 bg-[#0b0d14] px-2 py-0.5 text-[10px] font-semibold text-emerald-300 shadow-lg"
        >
          Copied
        </motion.span>
      ) : null}
    </span>
  );
}

function TokenDescription({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    setOverflowing(el.scrollHeight > el.clientHeight + 1);
  }, [text, expanded]);
  return (
    <div className="mt-2 max-w-xl">
      <p ref={ref} className={cn("text-xs leading-relaxed text-white/60", !expanded && "line-clamp-2")}>{text}</p>
      {overflowing ? (
        <button type="button" onClick={() => setExpanded((v) => !v)}
          className="mt-1 inline-flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-wider text-white/50 transition hover:text-white/80">
          {expanded ? <>Less <ChevronUp className="h-3 w-3" /></> : <>More <ChevronDown className="h-3 w-3" /></>}
        </button>
      ) : null}
    </div>
  );
}

function timeAgo(ts: string) {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

// Futures-style stat column — tiny uppercase label over a mono value, same
// layout language as the AsePad Futures market header / AseDex terminal.
const FutStat = ({ label, value, title }: { label: string; value: React.ReactNode; title?: string }) => (
  <div className="min-w-0">
    <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/40">{label}</p>
    <p className="mt-0.5 truncate font-mono text-xs text-white/75" title={title}>{value}</p>
  </div>
);

export default function AsepadTokenPage() {
  const params = useParams<{ address: string }>();
  // Static hosting serves every token from one prebuilt "_" shell, so the URL
  // (not the route param) is the source of truth for the address.
  // usePathname reports the shell path ("/asepad/token/_") on static hosting,
  // so read the real address bar in the browser.
  const routerPath = usePathname();
  const pathname = typeof window === "undefined" ? routerPath : window.location.pathname;
  // Path forms: /asepad/token/<addr> (monolith) or /token/<addr> (pump app).
  const pathSegs = pathname?.split("/").filter(Boolean) ?? [];
  const fromPath = decodeURIComponent(pathSegs[pathSegs.indexOf("token") + 1] ?? "");
  const address = fromPath && fromPath !== "_" ? fromPath : params.address;
  // URLs carry the public ase1 form - contract reads always use hex.
  const token = toHexAddress(String(address));
  // Hex links still resolve; they just rewrite to the canonical ase1 form so
  // any copied/shared URL is ase1.
  useEffect(() => {
    if (fromPath && /^0x[0-9a-fA-F]{40}$/.test(fromPath)) {
      const ase = toAseAddress(fromPath);
      if (ase && ase !== fromPath) window.history.replaceState(null, "", siteHref(`/asepad/token/${ase}`));
    }
  }, [fromPath]);
  const wallet = useWalletStore();
  
  const walletAse = useAseBalance(wallet.address ?? undefined, 15000);
  const qc = useQueryClient();
  const [tab, setTab] = useState<"buy" | "sell">("buy");
  // Mobile chart↔trade swap — same app behavior as the AseDex terminal:
  // the bottom Buy/Sell bar flips the page into a trade-only screen.
  const [mobileView, setMobileView] = useState<"chart" | "trade">("chart");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("5");
  const [interval, setChartInterval] = useState(60);
  const [priceUnit, setPriceUnit] = useState<PriceUnit>("USD");
  const chartLegendRef = useRef<HTMLDivElement | null>(null);
  const [activityTab, setActivityTab] = useState<"activity" | "holders">("activity");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<{ kind: "buy" | "sell"; hash: string } | null>(null);
  const [lastTxVisible, setLastTxVisible] = useState(false);
  // 1s heartbeat - drives the CEX-style price flash: the spot price turns
  // green/red for ~3s after a trade, then returns to neutral.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // No keepPreviousData on per-token queries - navigating between tokens must
  // never flash the previous token's price, trades or holders. The per-token
  // snapshot paints instantly; marked stale so the refresh runs immediately.
  const detail = useQuery({
    queryKey: ["asepad-token", token],
    queryFn: () => asepadGetLaunch(token),
    initialData: () => asepadPeekLaunch(token),
    initialDataUpdatedAt: () => 0
  });
  const candles = useQuery({
    queryKey: ["asepad-candles", token, interval],
    queryFn: () => asepadGetCandles(token, interval),
    initialData: () => asepadPeekCandles(token, interval),
    initialDataUpdatedAt: () => 0
  });
  const cfg = useQuery({ queryKey: ["asepad-config"], queryFn: asepadGetConfig, staleTime: 60000 });
  // Trending board rank - same query key as the launches page, so it's shared
  // cache when arriving from AsePad and one focused read on cold load. The
  // fire tag follows rank, not the board the user came from.
  const trending = useQuery({
    queryKey: ["asepad-launches", "trending", ""],
    queryFn: () => asepadGetLaunches("trending"),
    initialData: () => asepadPeekLaunches("trending"),
    initialDataUpdatedAt: () => 0,
    staleTime: 15_000,
    refetchInterval: 20_000
  });
  const hotRank = trending.data?.launches.findIndex((l) => sameAddress(l.token, token)) ?? -1;
  // Byte-compare the deployed token source against the canonical AsePad
  // template - a look-alike contract can spoof views but not this.
  const verification = useQuery({ queryKey: ["asepad-verification", token], queryFn: () => verifyTokenSource(token), staleTime: Infinity });
  const aseUsd = cfg.data?.aseUsd;
  const holders = useQuery({
    queryKey: ["asepad-holders", token],
    queryFn: () => asepadGetHolders(token),
    initialData: () => asepadPeekHolders(token),
    initialDataUpdatedAt: () => 0
  });
  const holding = useQuery({
    queryKey: ["asepad-holding", token, wallet.address],
    enabled: Boolean(wallet.address),
    queryFn: async () => {
      // AWS wallet tokens carry the indexed balance — no balanceOf chain read.
      const w = await apiWallet(toHexAddress(wallet.address!)).catch(() => null);
      const row = (w?.tokens ?? []).find((t) => String(t.token).toLowerCase() === token);
      return { balance: String(row?.balance ?? "0") };
    }
  });
  const sellAllowance = useQuery({
    queryKey: ["asepad-allowance", token, wallet.address],
    enabled: Boolean(wallet.address && tab === "sell" && detail.data?.launch?.status === "BONDING"),
    queryFn: async () => {
      // New AsePad tokens let the pad pull without an approve → 1-signature sell.
      const trusted = await viewContract(token, "trustedSpender", [contractAddr]).catch(() => false);
      const allowance = String(await viewContract(token, "allowance", [toHexAddress(wallet.address!), contractAddr]) || "0");
      return { allowance, spender: contractAddr, trusted: trusted === true || trusted === "true" };
    }
  });

  const d = detail.data;
  const launch = d?.launch;
  // @name service — one batch resolve for every address on this page.
  const addrNames = useNames([
    launch?.creator,
    ...(d?.trades ?? []).map((t) => t.traderAddress),
    ...(holders.data?.holders ?? []).map((h) => h.address),
  ]);

  useEffect(() => {
    if (launch?.symbol) document.title = `$${launch.symbol} on AsePad`;
    return () => { document.title = "Token | AsePad"; };
  }, [launch?.symbol, launch?.name]);

  // Success indicator: fade in, hold 5s, fade out smoothly.
  useEffect(() => {
    if (!lastTx) return;
    setLastTxVisible(true);
    const fade = setTimeout(() => setLastTxVisible(false), 5000);
    const clear = setTimeout(() => setLastTx(null), 5600);
    return () => { clearTimeout(fade); clearTimeout(clear); };
  }, [lastTx]);

  const contractAddr = process.env.NEXT_PUBLIC_CONTRACT_ASEPAD;
  // Resolve on-chain tx hashes for the launch + every trade. Trade records
  // carry the block timestamp; the resolver binary-searches blocks, then
  // matches the pad's Trade/LaunchCreated receipt events.
  // Smart-cached + incremental: tx hashes never change once found, so the map
  // persists (plain JSON record) and each refresh binary-searches ONLY trades
  // it hasn't matched yet - a reload or new trade no longer re-resolves all
  // 64 timestamps (~20 block reads each). Pad events refresh it (live root).
  type TxMap = { launchTx: string; tradeTxs: Record<string, string> };
  const txMap = useQuery({
    queryKey: ["asepad-tx-map", token],
    enabled: Boolean(d && contractAddr),
    staleTime: 30_000,
    queryFn: async (): Promise<TxMap> => {
      const prev = qc.getQueryData<TxMap>(["asepad-tx-map", token]);
      const known = prev?.tradeTxs ?? {};
      const pending = (d?.trades ?? []).filter((t) => !t.txHash && !known[t.id]);
      if (!pending.length) return prev ?? { launchTx: "", tradeTxs: {} };
      // Indexed pad trades already carry the tx hash — match by trader+block
      // time so the chain receipt-scan only fills what the index hasn't seen.
      const apiFound: Record<string, string> = {};
      if (pending.length && UNIFIED_API) {
        try {
          const res = await fetch(`${UNIFIED_API}/api/trades?pool=${encodeURIComponent(`${String(contractAddr).toLowerCase()}:pad:${toHexAddress(token).toLowerCase()}`)}&limit=256`, { signal: AbortSignal.timeout(8000) });
          const rows = (res.ok ? await res.json() : null)?.trades ?? [];
          const byKey = new Map<string, string>(rows.filter((r: { tx?: unknown }) => r.tx).map((r: { trader: string; ts: number; tx: unknown }) => [`${String(r.trader).toLowerCase()}|${Math.round(Number(r.ts) / 1000)}`, String(r.tx)]));
          for (const t of pending) {
            const tx = byKey.get(`${toHexAddress(t.traderAddress).toLowerCase()}|${Math.round(Date.parse(t.createdAt) / 1000)}`);
            if (tx) apiFound[t.id] = tx;
          }
        } catch { /* chain scan below */ }
      }
      // Unindexed trades keep no link rather than paying a /rpc/block binary
      // search — the indexer catches up on its next tick.
      return { launchTx: prev?.launchTx ?? "", tradeTxs: { ...known, ...apiFound } };
    }
  });
  // LP-burn proof tx — migration burns all LP shares in one tx at migratedTs
  // (LPShareBurned event); resolving it turns the "LP burned" tag into a link.
  // bondedTs is the fallback stamp for launches migrated before migratedTs
  // existed — the same final-buy tx sets both.
  const burnTx = useQuery({
    queryKey: ["asepad-burn-tx", token],
    enabled: Boolean(contractAddr && d?.lpBurned),
    staleTime: Infinity,
    queryFn: async () => {
      // The burn index records the LPShareBurned tx per launch idx — one AWS
      // read replaces the block binary search this used to run.
      const idx = (launch as { idx?: number | string | null } | undefined)?.idx;
      if (!UNIFIED_API || idx == null) return "";
      const b = await fetch(`${UNIFIED_API}/api/burn/${String(contractAddr).toLowerCase()}/${idx}`, { signal: AbortSignal.timeout(8000) })
        .then((r) => (r.ok ? r.json() : null)).catch(() => null) as { tx?: string } | null;
      return String(b?.tx ?? "");
    }
  });
  const displayUnit: PriceUnit = priceUnit === "USD" && aseUsd && aseUsd > 0 ? "USD" : "ASE";
  const spotAse = d?.price ? Number(safeBig(d.price)) / 1e18 : 0;
  // Price flash: compare the live spot to its previous value - a trade moves
  // the reserve price, so a change IS a trade (up=green buy, down=red sell).
  // More reliable than trusting the trade's createdAt timestamp.
  const [pxFlash, setPxFlash] = useState<{ up: boolean; at: number } | null>(null);
  const prevSpot = useRef(0);
  useEffect(() => {
    const prev = prevSpot.current;
    if (spotAse > 0 && prev > 0 && spotAse !== prev) setPxFlash({ up: spotAse > prev, at: Date.now() });
    prevSpot.current = spotAse;
  }, [spotAse]);
  const pxFlashCls = pxFlash && now - pxFlash.at < 3000 ? (pxFlash.up ? "text-emerald-300" : "text-red-300") : null;
  const displaySpot = displayUnit === "USD" ? spotAse * (aseUsd ?? 0) : spotAse;
  const alternateUnit: PriceUnit = displayUnit === "USD" ? "ASE" : "USD";
  const alternateSpot = alternateUnit === "USD" && aseUsd && aseUsd > 0 ? spotAse * aseUsd : null;
  const walletAseWei = walletAse.balance ? safeBig(walletAse.balance) : null;
  const heldTokens = safeBig(holding?.data?.balance ?? "0");
  const amountWei = useMemo(() => {
    const value = amount.trim();
    if (!/^\d+(\.\d{0,18})?$/.test(value)) return null;
    return safeBig(aseToWei(value));
  }, [amount]);

  // Instant display quote — the bonding curve is the same constant-product
  // math the contract runs (out = afterFee·rout/(rin·10000+afterFee), k kept
  // in the record), so we mirror it locally off the launch record: updates
  // per keystroke, zero RPC. The chain read only fills in when the record
  // lacks curve fields — and the click path re-quotes fresh before signing.
  const localPadQuote = useMemo(() => {
    if (!launch || launch.status !== "BONDING" || amountWei === null || amountWei <= 0n) return null;
    // Mirrors asepad.js _quoteBuy/_quoteSell: x = virtualAseWei + real reserve,
    // y = tokenReserve — the virtual cap carries price even at zero real reserve.
    const realX = safeBig(launch.reserve ?? launch.aseReserve ?? "0");
    const x = safeBig(launch.virtualAseWei ?? "0") + realX;
    const y = safeBig(launch.tokensLeft ?? launch.tokenReserve ?? "0");
    if (x <= 0n || y <= 0n) return null;
    const fee = safeBig(launch.feeBps ?? "0");
    if (tab === "buy") {
      const target = safeBig(launch.targetWei ?? "0");
      if (target > 0n && realX >= target) return { feasible: false, reason: "bonding target reached" } as const;
      const net = amountWei * (10000n - fee) / 10000n;
      if (net <= 0n) return { feasible: false, reason: "amount too small" } as const;
      const out = (y * net) / (x + net);
      if (out <= 0n) return { feasible: false, reason: "zero tokens out" } as const;
      if (out >= y) return { feasible: false, reason: "insufficient token reserve" } as const;
      return {
        feasible: true, tokensOut: out.toString(), aseIn: amountWei.toString(),
        netAseWei: net.toString(), grossAseWei: amountWei.toString(),
        willReachBondingTarget: target > 0n && realX + net >= target,
      };
    }
    const gross = (x * amountWei) / (y + amountWei);
    if (gross <= 0n) return { feasible: false, reason: "zero ASE out" } as const;
    if (gross > realX) return { feasible: false, reason: "insufficient real ASE reserve" } as const;
    const netOut = gross * (10000n - fee) / 10000n;
    return { feasible: true, aseOut: netOut.toString(), netAseOutWei: netOut.toString(), tokensIn: amountWei.toString() };
  }, [launch, amountWei, tab]);

  const quote = useQuery({
    queryKey: ["asepad-quote", token, tab, amountWei?.toString()],
    enabled: Boolean(contractAddr) && localPadQuote === null && amountWei !== null && amountWei > 0n && (tab === "buy" || amountWei <= heldTokens) && launch?.status === "BONDING",
    queryFn: async () => {
      const method = tab === "buy" ? "quoteBuy" : "quoteSell";
      const raw = await viewContract(contractAddr!, method, [token, amountWei!.toString()]);
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw as Record<string, unknown>;
      return tab === "buy" ? parsed : { ...parsed, aseOut: parsed.netAseOutWei };
    },
    placeholderData: keepPreviousData,
    retry: 2,
    retryDelay: 800
  });

  const targetWei = safeBig(launch?.targetWei ?? "0");
  const curveDone = ["BONDED", "MIGRATING", "MIGRATED"].includes(launch?.status ?? "");
  const pct = curveDone ? 100 : targetWei > 0n ? Number((safeBig(launch?.reserve ?? "0") * 10000n) / targetWei) / 100 : 0;


  // price change from candles
  const priceChange = useMemo(() => {
    const cs = candles.data?.candles ?? [];
    if (cs.length < 2) return null;
    const a = cs[0].open, b = cs[cs.length - 1].close;
    return a > 0 ? ((b - a) / a) * 100 : null;
  }, [candles.data]);

  // Chart data in the active unit (ASE → USD scaling when the rate is live).
  const chartFactor = displayUnit === "USD" && aseUsd && aseUsd > 0 ? aseUsd : 1;
  const chartCandles = useMemo(() =>
    (candles.data?.candles ?? []).map((c) => ({
      time: c.time, open: c.open * chartFactor, high: c.high * chartFactor,
      low: c.low * chartFactor, close: c.close * chartFactor, volume: c.volume
    })), [candles.data, chartFactor]);


  // market cap = price × total supply
  const mcap = useMemo(() => {
    if (!launch) return null;
    if (launch.marketCapWei) return Number(safeBig(launch.marketCapWei)) / 1e18;
    if (!d?.price) return null;
    const price = Number(safeBig(d.price)) / 1e18;
    const supply = Number(safeBig(launch.supply)) / 1e18;
    return price * supply;
  }, [launch, d?.price]);
  // UTC-day volume - same metric the trending board ranks by (resets 0:00
  // UTC), computed from the trades the detail query already carries.
  const vol24Wei = useMemo(() => (d?.trades ?? [])
    .filter((t) => Date.parse(t.createdAt) >= new Date().setUTCHours(0, 0, 0, 0))
    .reduce((s, t) => s + safeBig(t.aseWei || "0"), 0n), [d?.trades]);
  const amountExceedsBalance = amountWei !== null && amountWei > 0n && (
    tab === "buy" ? walletAseWei !== null && amountWei > walletAseWei : amountWei > heldTokens
  );
  const amountInvalid = amountWei === null || amountWei <= 0n || amountExceedsBalance;
  const buyQuote = localPadQuote && "tokensOut" in localPadQuote ? localPadQuote as typeof quote.data
    : quote.data && "tokensOut" in quote.data ? quote.data : undefined;
  const sellQuote = localPadQuote && "aseOut" in localPadQuote ? localPadQuote as typeof quote.data
    : quote.data && "aseOut" in quote.data ? quote.data : undefined;
  const padAllowance = safeBig(sellAllowance.data?.allowance ?? "0");
  const needsSellApproval = tab === "sell" && amountWei !== null && !sellAllowance.data?.trusted && amountWei > padAllowance;

  async function finalizeMigration() {
    setErr(null);
    if (!contractAddr) { setErr("AsePad contract is not configured"); return; }
    if (wallet.status !== "connected" || !wallet.address) { wallet.openConnect?.(); return; }
    const readLaunch = async () => {
      const r = await viewContract<Record<string, unknown> | string>(contractAddr, "getLaunch", [token]);
      return typeof r === "string" ? JSON.parse(r) as Record<string, unknown> : r;
    };
    try {
      // The bonding buy migrates in its own transaction - this path only exists
      // for launches that bonded before auto-migration or where it stalled, and
      // each call completes the launch in a single signature.
      for (let step = 0; step < 4; step++) {
        const l = await readLaunch();
        const status = String(l.status || "");
        if (status === "MIGRATED") break;
        const method = status === "BONDED" ? "migrate" : status === "MIGRATING" ? "advanceMigration" : null;
        if (!method) throw new Error(`Unexpected launch status ${status || "?"}`);
        setBusy("Migrating to AseDex…");
        const hash = await sendWalletCall({ to: contractAddr, method, args: [token] });
        await requireWalletTxMined(hash, "migration", 180_000);
      }
      const l = await readLaunch();
      if (String(l.status || "") !== "MIGRATED") throw new Error("Migration did not complete. Try again");
      // The token's dex gate just unlocked - clear it so Create-pool accepts
      // this token without waiting on the gate cache or live event wave.
      dexGateInvalidate(token);
      void Promise.all([
        qc.invalidateQueries({ queryKey: ["asepad-token", token] }),
        qc.invalidateQueries({ queryKey: ["asepad-launches"] }),
        qc.invalidateQueries({ queryKey: ["asedex-gate"] })
      ]);
    } catch (e) { setErr(e instanceof Error ? e.message : "Migration failed"); }
    finally { setBusy(null); }
  }

  async function trade() {
    setErr(null);
    setLastTx(null);
    if (!contractAddr) { setErr("ASEPAD contract not configured"); return; }
    if (!launch) { setErr("Launch not loaded"); return; }
    if (wallet.status !== "connected" || !wallet.address) { wallet.openConnect?.(); return; }
    if (amountWei === null || amountWei <= 0n) { setErr("Enter a valid amount"); return; }
    if (tab === "buy" && walletAseWei !== null && amountWei > walletAseWei) { setErr("Insufficient ASE balance"); return; }
    if (tab === "sell" && amountWei > heldTokens) { setErr(`Insufficient ${launch?.symbol ?? "token"} balance`); return; }
    let slipToleranceBps: bigint;
    try {
      slipToleranceBps = slippageToBps(slippage);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Invalid slippage");
      return;
    }
    try {
      if (tab === "buy") {
        // Fresh quote at click — the debounced display quote can be seconds
        // stale; signing with it produces a minOut that reverts on drift.
        setBusy("Fetching live quote…");
        const rawQ = await viewContract(contractAddr!, "quoteBuy", [token, amountWei.toString()]);
        const q = (typeof rawQ === "string" ? JSON.parse(rawQ) : rawQ) as typeof buyQuote;
        if (!q) throw new Error("Quote failed — try again");
        if (q.feasible === false) throw new Error(q?.reason ?? "No buy quote available");
        setBusy("Waiting for wallet…");
        const est = safeBig(q.tokensOut);
        const minOut = (est * (10000n - slipToleranceBps)) / 10000n;
        const hash = await sendWalletCall({
          to: contractAddr, method: "buy",
          args: [token, minOut.toString()],
          valueWei: amountWei.toString()
        });
        setBusy("Confirming on Asentum…");
        await requireWalletTxMined(hash, "buy", 180_000);
        setLastTx({ kind: "buy", hash });
        // The bonding buy migrates in the same transaction. This kick only
        // covers launches left stuck from before auto-migration shipped - run
        // it in the background (finalizeMigration sets its own busy label) so
        // the button frees the moment the buy receipt lands.
        void (async () => {
          const cur = await asepadGetLaunch(token);
          if (cur?.migration?.status === "BONDED" || cur?.migration?.status === "MIGRATING") {
            await finalizeMigration();
          }
        })().catch(() => { });
      } else {
        setBusy("Fetching live quote…");
        const rawQ = await viewContract(contractAddr!, "quoteSell", [token, amountWei.toString()]);
        const parsed = (typeof rawQ === "string" ? JSON.parse(rawQ) : rawQ) as Record<string, unknown>;
        const q = { ...parsed, aseOut: parsed.netAseOutWei } as typeof sellQuote;
        if (!q || q.aseOut == null) throw new Error("Quote failed — try again");
        if (q.feasible === false) throw new Error(q?.reason ?? "No sell quote available");
        const amt = amountWei;
        const est = safeBig(q.aseOut);
        const minOut = (est * (10000n - slipToleranceBps)) / 10000n;
        if (needsSellApproval) {
          setBusy("Approve AsePad to spend tokens…");
          const approveHash = await sendWalletCall({
            to: token,
            method: "approve",
            args: [contractAddr, amt.toString()]
          });
          await requireWalletTxMined(approveHash, "token approval", 180_000);
        }
        setBusy("Waiting for sell signature…");
        const hash = await sendWalletCall({
          to: contractAddr,
          method: "sell",
          args: [token, amt.toString(), minOut.toString()]
        });
        setBusy("Confirming sell payout…");
        await requireWalletTxMined(hash, "sell", 180_000);
        setLastTx({ kind: "sell", hash });
      }
      setAmount("");
      // Fire-and-forget - the detail/holding refetches walk the shared RPC
      // gate and would pin the busy state for seconds after the receipt.
      void Promise.all([
        qc.invalidateQueries({ queryKey: ["asepad-token", token] }),
        qc.invalidateQueries({ queryKey: ["asepad-holding", token] }),
        qc.invalidateQueries({ queryKey: ["asepad-allowance", token] }),
        qc.invalidateQueries({ queryKey: ["asepad-candles", token] }),
        walletAse.refresh()
      ]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Transaction failed");
    } finally {
      setBusy(null);
    }
  }

  if (detail.isPending) {
    return (
      <div className="mx-auto max-w-7xl px-4 pb-24 pt-16 lg:pb-10 md:pt-20">
        {/* slim top bar - back link + status + live block, same as loaded state */}
        <div className="mb-4 flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-white/45"><ArrowLeft className="h-3.5 w-3.5" />AsePad</span>
          <div className="flex items-center gap-3">
            <Skeleton className="h-6 w-24 rounded-full" />
            <LiveIndicator />
          </div>
        </div>

        {/* same grid as the loaded layout: fused header+chart panel left,
            bonding + activity under it, trade + info pinned right */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Panel className="min-w-0 lg:col-start-1 lg:row-start-1 lg:row-span-2">
            {/* mobile header */}
            <div className="lg:hidden">
              <div className="flex min-h-14 items-center gap-x-2.5 px-4 py-2.5">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-2.5 w-28" />
                </div>
                <Skeleton className="h-5 w-14 rounded-lg" />
              </div>
              <div className="flex items-center gap-x-5 border-t border-white/[0.06] px-4 py-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="space-y-1"><Skeleton className="h-2 w-10" /><Skeleton className="h-3 w-14" /></div>
                ))}
              </div>
            </div>
            {/* desktop header */}
            <div className="hidden items-center gap-x-7 px-4 py-3 lg:flex">
              <div className="flex shrink-0 items-center gap-2.5">
                <Skeleton className="h-11 w-11 rounded-full" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-2.5 w-28" />
                </div>
              </div>
              <div className="flex min-w-0 flex-1 gap-x-7">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="space-y-1"><Skeleton className="h-2.5 w-12" /><Skeleton className="h-3.5 w-16" /></div>
                ))}
              </div>
            </div>
            {/* meta row */}
            <div className="border-t border-white/[0.06] px-4 py-2.5">
              <Skeleton className="h-3.5 w-64 max-w-full" />
            </div>
            {/* bonding curve strip replica */}
            <div className="flex items-center gap-3 border-y border-white/[0.06] px-3 py-1.5">
              <Skeleton className="h-2.5 w-20" />
              <div className="h-1.5 min-w-0 flex-1 rounded-full bg-white/[0.07]" />
              <Skeleton className="h-3 w-10" />
              <Skeleton className="hidden h-3 w-20 sm:block" />
            </div>
            {/* chart — candle replica */}
            <ChartSkeleton className="flex h-[340px] flex-col sm:h-[440px]" />
          </Panel>

          <Panel className="min-w-0 p-3 lg:col-start-1 lg:row-start-3">
            <Skeleton className="h-8 w-52 rounded-full" />
            <div className="mt-3 divide-y divide-white/5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2 px-2 py-2.5">
                  <Skeleton className="h-3.5 flex-1" />
                  <Skeleton className="h-3.5 w-16" />
                  <Skeleton className="h-5 w-14 rounded-md" />
                  <Skeleton className="h-3.5 w-20" />
                </div>
              ))}
            </div>
          </Panel>

          <div className="flex min-w-0 flex-col gap-4 lg:col-start-2 lg:row-start-1 lg:row-span-4">
            <Panel className="min-w-0 p-4">
              <Skeleton className="mb-3 h-11 rounded-full" />
              <Skeleton className="h-3 w-16" />
              <Skeleton className="mt-2 h-12 rounded-xl" />
              <div className="mt-2 flex gap-1.5">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-6 flex-1 rounded-md" />)}
              </div>
              <div className="mt-3 flex items-center justify-between"><Skeleton className="h-3 w-24" /><Skeleton className="h-5 w-44" /></div>
              <Skeleton className="mt-3 h-16 rounded-xl" />
              <Skeleton className="mt-4 h-12 rounded-xl" />
            </Panel>
            <Panel className="min-w-0 p-4">
              <Skeleton className="mb-2.5 h-2.5 w-10" />
              <div className="space-y-2.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex justify-between"><Skeleton className="h-3.5 w-16" /><Skeleton className="h-3.5 w-24" /></div>
                ))}
              </div>
            </Panel>
          </div>
        </div>
      </div>
    );
  }
  if (!launch) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16 text-center">
        <p className="text-lg font-semibold">Token not found</p>
        <p className="mt-2 text-sm text-white/55">This token isn't launched on AsePad.</p>
        <Link prefetch={false} href={siteHref("/asepad")} className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-xs font-semibold text-white/80 transition hover:border-white/30 hover:text-white">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to AsePad
        </Link>
      </div>
    );
  }

  const meta = launch.meta;

  // Contract-verification tick — sits directly beside the token name in both
  // header variants (the "shield tick" slot).
  const tickBadge = (<>
    {verification.data === "verified-pad" ? (
      <button type="button" className="inline-flex h-5 shrink-0 items-center justify-center text-emerald-300 transition hover:text-emerald-200" title="Verified contract · deployed source matches the official AsePad template">
        <ShieldCheck className="h-3.5 w-3.5" />
      </button>
    ) : verification.data === "unverified" ? (
      <button type="button" className="inline-flex h-5 shrink-0 items-center justify-center text-amber-300 transition hover:text-amber-200" title="Custom contract · not the standard AsePad token. Review the source before trading.">
        <ShieldAlert className="h-3.5 w-3.5" />
      </button>
    ) : null}
    {d?.lpBurned ? (
      <a href={burnTx.data ? explorerTxUrl(burnTx.data) : explorerAddressUrl(launch.token)} target="_blank" rel="noreferrer"
        className="inline-flex h-5 shrink-0 items-center justify-center text-orange-400 transition hover:text-orange-300"
        title={burnTx.data ? "Liquidity pool shares permanently burned · view burn transaction" : "Liquidity pool shares permanently burned"}>
        <Flame className="h-3.5 w-3.5" />
      </a>
    ) : null}
  </>);

  // Trending + LP-burn tags — parked in the header's right corner.
  const cornerTags = (<>
    {hotRank >= 0 && hotRank < 20 ? (
      <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-lg border border-orange-400/40 bg-orange-400/10 px-2 text-[10px] font-bold leading-none text-orange-300" title={`#${hotRank + 1} on Trending`}>
        <Flame className="h-3 w-3" /> HOT #{hotRank + 1}
      </span>
    ) : null}
  </>);

  const headStats: [string, React.ReactNode][] = [
    ["Price", <span key="p" className={cn("font-semibold", pxFlashCls)} title={formatTokenPriceLabel(displaySpot, displayUnit, false)}><PricePower text={formatTokenPriceLabel(displaySpot, displayUnit)} /></span>],
    ["Change", priceChange !== null
      ? <span key="c" className={cn("font-semibold", priceChange >= 0 ? "text-emerald-300" : "text-red-300")}>{priceChange >= 0 ? "+" : "-"}{Math.abs(priceChange).toFixed(2)}%</span>
      : "-"],
    ["24h Vol", fmtUsd(Number(vol24Wei) / 1e18, aseUsd) ?? `${fmtAse(vol24Wei.toString(), 2)} ASE`],
    ["MC", mcap ? (fmtUsd(mcap, aseUsd) ?? `${fmtAse(String(safeBig(Math.floor(mcap * 1e18))), 0)} ASE`) : "-"],
    ["Trades", String(launch.tradeCount ?? "0")],
    ["Supply", fmtTokens(launch.supply)]
  ];

  const logoImg = linkUrl(meta?.logoUrl) ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={linkUrl(meta?.logoUrl)} alt="" className="h-full w-full object-cover" />
  ) : (
    <div className="flex h-full w-full items-center justify-center text-[10px] font-black text-zinc-300">
      {(launch.symbol || "?").slice(0, 2)}
    </div>
  );

  return (
    <>
      <div className="mx-auto max-w-7xl px-4 pb-24 pt-16 lg:pb-10 md:pt-20">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: "easeOut" }}>

          {/* slim top bar - back to board + status + live block */}
          <div className="mb-4 flex items-center justify-between gap-3">
            <Link prefetch={false} href={siteHref("/asepad")} className="inline-flex items-center gap-1.5 text-xs font-medium text-white/50 transition hover:text-white">
              <ArrowLeft className="h-3.5 w-3.5" />AsePad
            </Link>
            <div className="flex items-center gap-3">
              <LiveIndicator />
            </div>
          </div>

          <div data-chart-panel className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] [&:fullscreen]:overflow-auto [&:fullscreen]:bg-[#07080d] [&:fullscreen]:p-3">
            {/* left: header + curve + chart + data — contents dissolves into the grid */}
            <div className="contents">
              {/* token header + chart — one seamless panel (futures-style) */}
              <Panel className={cn("order-1 min-w-0 lg:col-start-1 lg:row-start-1 lg:row-span-2", mobileView === "trade" && "max-lg:hidden")}>
                {/* ── mobile header — same flat row as the terminal ── */}
                <div className="lg:hidden">
                  <div className="flex items-center gap-2.5 px-4 py-2.5">
                    <RingedLogo pct={pct} box="h-9 w-9">{logoImg}</RingedLogo>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-sm font-bold tracking-tight">
                        <span className="max-w-[140px] truncate">{launch.name}</span>
                        <span className="shrink-0 font-normal text-white/45">${launch.symbol}</span>
                        {tickBadge}
                      </p>
                      <p className="mt-0.5 flex items-baseline gap-1.5">
                        <span className={cn("font-mono text-xs font-bold", priceChange !== null ? (priceChange >= 0 ? "text-emerald-400" : "text-red-400") : pxFlashCls)} title={formatTokenPriceLabel(displaySpot, displayUnit, false)}>
                          <PricePower text={formatTokenPriceLabel(displaySpot, displayUnit)} />
                        </span>
                        {priceChange !== null ? (
                          <span className={cn("text-[11px] font-semibold", priceChange >= 0 ? "text-emerald-300" : "text-red-300")}>
                            {priceChange >= 0 ? "+" : "-"}{Math.abs(priceChange).toFixed(2)}%
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1 font-mono text-[10px] text-white/40">
                        <a href={explorerAddressUrl(launch.token)} target="_blank" rel="noreferrer" className="transition hover:text-accent" title={launch.token}>{shortenAddress(launch.token, 6, 4)}</a>
                        <CopyBtn text={launch.token} />
                      </p>
                    </div>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      {cornerTags}
                      <StatusBadge status={launch.status} lpBurned={d?.lpBurned} className="px-2 py-0.5 text-[10px]" />
                    </span>
                  </div>
                  <div className="flex items-center gap-x-5 overflow-x-auto border-t border-white/[0.06] px-4 py-2">
                    {([headStats[2], headStats[3], headStats[4], headStats[5]] as [string, React.ReactNode][]).map(([label, val]) => (
                      <div key={label} className="min-w-0 shrink-0">
                        <p className="text-[9px] uppercase tracking-wider text-white/40">{label}</p>
                        <p className="mt-0.5 truncate font-mono text-[11px] text-white/85" title={typeof val === "string" ? val : undefined}>{val}</p>
                      </div>
                    ))}
                    <div className="min-w-0 shrink-0">
                      <p className="text-[9px] uppercase tracking-wider text-white/40">Creator</p>
                      <a href={explorerAddressUrl(launch.creator)} target="_blank" rel="noreferrer" className="mt-0.5 block truncate font-mono text-[11px] text-white/85 transition hover:text-accent" title={launch.creator}>{namedAddr(launch.creator, addrNames, (a) => shortenAddress(a, 6, 4))}</a>
                    </div>
                  </div>
                </div>
                {/* ── desktop header ── */}
                <div className="hidden items-center gap-x-7 px-4 py-3 lg:flex">
                  <div className="flex shrink-0 items-start gap-2.5">
                    <RingedLogo pct={pct} box="mt-0.5 h-11 w-11">{logoImg}</RingedLogo>
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-sm font-bold tracking-tight">
                        <span className="max-w-[200px] truncate">{launch.name}</span>
                        <span className="shrink-0 font-normal text-white/45">${launch.symbol}</span>
                        {tickBadge}
                      </p>
                      <p className="mt-0.5 flex items-baseline gap-2">
                        <span className={cn("font-mono text-xs font-bold", pxFlashCls)} title={formatTokenPriceLabel(displaySpot, displayUnit, false)}>
                          <PricePower text={formatTokenPriceLabel(displaySpot, displayUnit)} />
                        </span>
                        {priceChange !== null ? (
                          <span className={cn("text-[11px] font-semibold", priceChange >= 0 ? "text-emerald-300" : "text-red-300")}>
                            {priceChange >= 0 ? "+" : "-"}{Math.abs(priceChange).toFixed(2)}%
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1 font-mono text-[10px] text-white/40">
                        <a href={explorerAddressUrl(launch.token)} target="_blank" rel="noreferrer" className="transition hover:text-accent" title={launch.token}>{shortenAddress(launch.token)}</a>
                        <CopyBtn text={launch.token} />
                      </p>
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-7 gap-y-1">
                    {headStats.slice(2).map(([label, val]) => (
                      <FutStat key={label} label={label} value={val} title={typeof val === "string" ? val : undefined} />
                    ))}
                    <FutStat label="Creator" title={launch.creator} value={
                      <a href={explorerAddressUrl(launch.creator)} target="_blank" rel="noreferrer" className="font-semibold text-white/85 transition hover:text-accent">{namedAddr(launch.creator, addrNames, (a) => shortenAddress(a, 6, 4))}</a>
                    } />
                  </div>
                  <span className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1">
                    {cornerTags}
                    <StatusBadge status={launch.status} lpBurned={d?.lpBurned} className="px-3 py-1 text-xs" />
                  </span>
                </div>
                {/* meta row — creator, socials, description */}
                <div className="border-t border-white/[0.06] px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {socialUrl("website", meta?.website) ? (
                      <a href={socialUrl("website", meta?.website)} target="_blank" rel="noreferrer" aria-label="Website"
                        className="text-white/55 transition hover:text-white"><Globe className="h-4 w-4" /></a>
                    ) : null}
                    {socialUrl("twitter", meta?.twitter) ? (
                      <a href={socialUrl("twitter", meta?.twitter)} target="_blank" rel="noreferrer" aria-label="X"
                        className="text-white/55 transition hover:text-white">
                        <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
                      </a>
                    ) : null}
                    {socialUrl("telegram", meta?.telegram) ? (
                      <a href={socialUrl("telegram", meta?.telegram)} target="_blank" rel="noreferrer" aria-label="Telegram"
                        className="text-white/55 transition hover:text-white"><Send className="h-4 w-4" /></a>
                    ) : null}
                  </div>
                  {meta?.description ? (
                    <div className="mt-1.5"><TokenDescription text={meta.description} /></div>
                  ) : null}
                </div>
                {/* bonding curve — slim strip directly under the header */}
                <div className="flex items-center gap-3 border-y border-white/[0.06] px-3 py-1.5"
                  title={launch.status === "BONDING" ? `When the curve reaches ${fmtAse(launch.targetWei, 0)} ASE, liquidity migrates to AseDex and LP shares are permanently burned.` : undefined}>
                  <span className="shrink-0 text-[9px] font-bold uppercase tracking-[0.14em] text-white/45">Bonding curve</span>
                  <div className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-zinc-300 to-zinc-500"
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.max(1.5, Math.min(100, pct))}%` }}
                      transition={{ duration: 0.8, ease: "easeOut" }}
                    />
                  </div>
                  <span className="shrink-0 font-mono text-[11px] font-bold text-white">{pct.toFixed(2)}%</span>
                  <span className="hidden shrink-0 font-mono text-[10px] text-white/50 sm:block">{fmtAse(curveDone ? (launch.finalAseReserve ?? launch.targetWei) : launch.reserve, 2)} / {fmtAse(launch.targetWei, 0)} ASE</span>
                  <span className="hidden shrink-0 text-[10px] italic text-white/45 md:block">{bondingMessage(pct)}</span>
                </div>
                <div className="flex h-[340px] flex-col sm:h-[440px]">
                  <TokenChart
                    candles={chartCandles}
                    symbol={`$${launch.symbol}-${displayUnit}`}
                    tfLabel={INTERVALS.find((i) => i.s === interval)?.l ?? "1m"}
                    tfs={INTERVALS} tf={interval} onTf={setChartInterval}
                    formatPx={formatTokenPriceAxis}
                    empty={!chartCandles.length && !candles.isPending}
                    loading={candles.isPending}
                    unitToggle={
                      <div className="flex items-center gap-0.5">
                        {PRICE_UNITS.map((u) => {
                          const off = u === "USD" && !(aseUsd && aseUsd > 0);
                          return (
                            <button key={u} type="button" disabled={off} aria-label={`Price in ${u}`}
                              onClick={() => setPriceUnit(u)}
                              className={cn("rounded px-2 py-1 text-[11px] font-medium transition-colors",
                                displayUnit === u ? "bg-white/10 text-white" : off ? "cursor-not-allowed text-white/25" : "text-white/45 hover:text-white/70")}>{u}</button>
                          );
                        })}
                      </div>
                    }
                  />
                </div>

              </Panel>

              {/* activity / holders — bottom data panel */}
              <Panel className={cn("order-3 min-w-0 p-3 lg:col-start-1 lg:row-start-3", mobileView === "trade" && "max-lg:hidden")}>
                  <SegTabs
                    layoutId="token-activity"
                    options={[{ v: "activity" as const, l: "Activity" }, { v: "holders" as const, l: `Holders${holders.data ? ` (${holders.data.count ?? holders.data.holders.length})` : ""}` }]}
                    value={activityTab}
                    onChange={setActivityTab}
                  />

                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div key={activityTab} className="mt-3"
                      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15, ease: "easeOut" }}>
                      {activityTab === "activity" ? (
                        (d?.trades?.length ?? 0) === 0 ? (
                          <p className="py-8 text-center text-sm text-white/55">No trades yet.</p>
                        ) : (
                          <div className="overflow-x-auto"><div className="min-w-[560px]">
                            <div className="mb-1 grid grid-cols-[1.4fr_1fr_0.7fr_1.2fr_0.6fr_0.4fr] gap-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-white/45">
                              <span>Wallet</span>
                              <span className="text-right">ASE</span>
                              <span className="text-center">Side</span>
                              <span className="text-right">${launch.symbol}</span>
                              <span className="text-right">Age</span>
                              <span className="text-right">Tx</span>
                            </div>
                            <div className="max-h-[380px] divide-y divide-white/5 overflow-y-auto">
                              {d!.trades.map((t: AsepadTrade) => {
                                const isSell = t.kind === "SELL";
                                const isCreator = sameAddress(t.traderAddress, launch.creator);
                                return (
                                  <div key={t.id} className={cn(
                                    "grid grid-cols-[1.4fr_1fr_0.7fr_1.2fr_0.6fr_0.4fr] items-center gap-2 px-2 py-2.5 text-sm transition-colors",
                                    "hover:bg-white/[0.03]",
                                    isSell ? "bg-red-400/[0.02]" : "bg-emerald-400/[0.02]"
                                  )}>
                                    <a
                                      href={explorerAddressUrl(t.traderAddress)}
                                      target="_blank" rel="noreferrer"
                                      className="truncate font-mono text-xs text-white/70 transition hover:text-white"
                                    >
                                      {namedAddr(t.traderAddress, addrNames, shortenAddress)}
                                    </a>
                                    <span className="text-right font-mono text-xs font-semibold text-white/90">
                                      {fmtAse(t.aseWei, 4)} <span className="text-white/50">ASE</span>
                                    </span>
                                    <span className="text-center">
                                      <span className={cn(
                                        "rounded-md px-2 py-0.5 text-[10px] font-bold uppercase",
                                        isSell
                                          ? (isCreator ? "bg-rose-400/15 text-rose-300" : "bg-red-400/15 text-red-300")
                                          : (isCreator ? "bg-violet-400/15 text-violet-300" : "bg-emerald-400/15 text-emerald-300")
                                      )}>
                                        {isSell ? (isCreator ? "Dev sell" : "Sell") : (isCreator ? "Dev buy" : "Buy")}
                                      </span>
                                    </span>
                                    <span className="truncate text-right font-mono text-xs text-white/60">
                                      {fmtTokens(t.tokenAmount)} {launch.symbol}
                                    </span>
                                    <span className="text-right font-mono text-[10px] text-white/45">{timeAgo(t.createdAt)}</span>
                                    {(() => {
                                      const hash = t.txHash || txMap.data?.tradeTxs?.[t.id] || "";
                                      return hash ? (
                                        <a
                                          href={explorerTxUrl(hash)}
                                          target="_blank" rel="noreferrer"
                                          className="text-right text-white/50 transition hover:text-white"
                                          title={`${t.kind} tx ${hash}`}
                                        ><ExternalLink className="ml-auto h-3.5 w-3.5" /></a>
                                      ) : <span className="text-right text-white/15" title="Resolving tx…">·</span>;
                                    })()}
                                  </div>
                                );
                              })}
                            </div>
                          </div></div>
                        )
                      ) : (
                        (holders.data?.holders.length ?? 0) === 0 ? (
                          <p className="py-8 text-center text-sm text-white/55">No holders yet, they appear after the first curve trades.</p>
                        ) : (
                          <div className="overflow-x-auto"><div className="min-w-[420px]">
                            <div className="mb-1 grid grid-cols-[0.4fr_1.6fr_1.2fr_0.7fr] gap-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-white/45">
                              <span>#</span>
                              <span>Wallet</span>
                              <span className="text-right">${launch.symbol}</span>
                              <span className="text-right">Share</span>
                            </div>
                            <div className="max-h-[380px] divide-y divide-white/5 overflow-y-auto">
                              {holders.data!.holders.map((h, i) => (
                                <div key={h.address} className="grid grid-cols-[0.4fr_1.6fr_1.2fr_0.7fr] items-center gap-2 px-2 py-2.5 text-sm transition-colors hover:bg-white/[0.03]">
                                  <span className="text-xs text-white/45">#{i + 1}</span>
                                  <div className="flex min-w-0 items-center gap-2">
                                    <a
                                      href={explorerAddressUrl(h.address)}
                                      target="_blank" rel="noreferrer"
                                      className="truncate font-mono text-xs text-white/70 transition hover:text-white"
                                    >
                                      {(() => { const isCurve = Boolean(contractAddr) && toHexAddress(h.address).toLowerCase() === String(contractAddr).toLowerCase(); return isCurve || h.tag === "bonding curve" ? "BONDING CURVE" : h.tag === "asedex" ? "AseDex" : namedAddr(h.address, addrNames, shortenAddress); })()}
                                    </a>
                                    {(contractAddr && toHexAddress(h.address).toLowerCase() === String(contractAddr).toLowerCase()) || h.tag === "bonding curve" || h.tag === "asedex" ? (
                                      <svg className="h-3 w-3 shrink-0 text-sky-400" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.7-9.3a1 1 0 00-1.4-1.4L9 10.6 7.7 9.3a1 1 0 00-1.4 1.4l2 2a1 1 0 001.4 0l4-4z" clipRule="evenodd"/></svg>
                                    ) : h.tag ? (
                                      <span className={cn(
                                        "inline-flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-0 text-[8px] font-bold uppercase tracking-[0.1em] backdrop-blur-sm",
                                        h.tag === "dev" && "border-violet-400/30 bg-violet-400/10 text-violet-300 shadow-[0_0_10px_-2px] shadow-violet-400/40",
                                        h.tag === "burn" && "border-orange-400/30 bg-orange-400/10 text-orange-300 shadow-[0_0_10px_-2px] shadow-orange-400/40"
                                      )}>
                                        <span className={cn(
                                          "h-1 w-1 rounded-full",
                                          h.tag === "dev" && "bg-violet-400",
                                          h.tag === "burn" && "bg-orange-400"
                                        )} />
                                        {h.tag === "dev" ? "Dev" : "Burn"}
                                      </span>
                                    ) : null}
                                  </div>
                                  <span className="truncate text-right font-mono text-xs text-white/80">{fmtTokens(h.balance)}</span>
                                  <span className="text-right font-mono text-xs text-white/65">{(h.shareBps / 100).toFixed(2)}%</span>
                                </div>
                              ))}
                            </div>
                          </div></div>
                        )
                      )}
                    </motion.div>
                  </AnimatePresence>
              </Panel>
            </div>

            {/* right: trade + info - one column pinned to col 3 so it can't
                backfill a left-side row and stretch it */}
            <div className="order-5 flex min-w-0 flex-col gap-4 self-start lg:col-start-2 lg:row-start-1 lg:row-span-3">
              <Panel className="min-w-0 p-4">
                {verification.data === "unverified" ? (
                  <div className="rounded-xl border border-amber-400/30 bg-gradient-to-br from-amber-400/10 to-transparent p-5 text-center">
                    <ShieldAlert className="mx-auto h-7 w-7 text-amber-300" />
                    <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.25em] text-amber-300/80">Custom contract · trading locked</p>
                    <p className="mt-2 text-xs leading-relaxed text-white/60">
                      This token's deployed source does not match the verified AsePad template, so buys and sells are disabled.
                      Review the contract before interacting with it anywhere.
                    </p>
                    <a href={explorerAddressUrl(launch.token)} target="_blank" rel="noreferrer"
                      className="mt-4 flex h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-amber-400/30 bg-amber-400/10 text-xs font-semibold text-amber-200 transition hover:bg-amber-400/20">
                      Review contract on explorer <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                ) : launch.status !== "BONDING" ? (
                  launch.status === "MIGRATED" ? (
                    <div className="rounded-xl border border-emerald-400/25 bg-gradient-to-br from-emerald-400/10 to-transparent p-5 text-center">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-emerald-300/80">Curve complete · migrated</p>
                      <p className="mt-2 text-lg font-black text-white">Trade ${launch.symbol} on AseDex</p>
                      <p className="mt-1 text-xs text-white/60">
                        Liquidity moved to AseDex{d?.aseDexPoolId ? ` · Pool #${d.aseDexPoolId}` : ""}
                      </p>
                      <Link
                        prefetch={false}
                        href={siteHref(d?.aseDexPoolId ? `/asedex/terminal/asedex/${d.aseDexPoolId}` : "/asedex")}
                        className="mt-4 flex h-11 w-full items-center justify-center rounded-lg bg-emerald-400 text-sm font-bold text-black transition hover:bg-emerald-300"
                      >
                        Buy on AseDex
                      </Link>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-amber-400/30 bg-gradient-to-br from-amber-400/10 to-transparent p-5 text-center">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-amber-300/80">Curve complete · migration pending</p>
                      <p className="mt-2 text-sm text-white/70">The bonding buy starts migration automatically. If it stalled, finish it here.</p>
                      {err ? <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{err}</p> : null}
                      <Button
                        className="mt-4 h-11 w-full"
                        disabled={busy !== null}
                        onClick={() => void finalizeMigration()}
                      >
                        {busy ?? "Migrate to AseDex"}
                      </Button>
                    </div>
                  )
                ) : (
                  <>
                    <div className="mb-3 grid grid-cols-2 gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.03] p-1">
                      {(["buy", "sell"] as const).map((k) => (
                        <button
                          key={k}
                          onClick={() => { setTab(k); setAmount(""); setErr(null); }}
                          className={cn(
                            "rounded-full py-2.5 text-sm font-bold uppercase tracking-wide transition",
                            tab === k
                              ? k === "buy" ? "bg-emerald-400/90 text-black shadow-[0_0_20px_rgba(52,211,153,0.35)]" : "bg-red-400/90 text-black shadow-[0_0_20px_rgba(248,113,113,0.35)]"
                              : "text-white/55 hover:text-white/80"
                          )}
                        >
                          {k}
                        </button>
                      ))}
                    </div>

                    <AnimatePresence mode="popLayout" initial={false}>
                      <motion.div key={tab}
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.08, ease: "easeOut" }}>
                        <div className="mb-1 flex items-center justify-between gap-3">
                          <label className="text-xs text-white/60">{tab === "buy" ? "You pay" : "You sell"}</label>
                          {wallet.status === "connected" ? (
                            tab === "buy" ? (
                              <span className="inline-flex items-center gap-1 text-[11px] text-white/55" title={`${fmtExactWei(walletAseWei ?? 0n)} ASE`}>
                                bal {walletAse.loading && !walletAse.balance ? "…" : `${fmtAseCompact(walletAseWei ?? 0n)}`} <AseLogo size={12} /> ASE
                              </span>
                            ) : (
                              <span className="min-w-0 truncate text-right font-mono text-[11px] text-white/55" title={`${fmtExactWei(heldTokens)} ${launch.symbol}`}>
                                bal {fmtTokens(heldTokens)} {launch.symbol}
                                {heldTokens > 0n ? (
                                  <button type="button" className="ml-1 text-white/60 hover:text-white" onClick={() => setAmount(weiToDecimal(heldTokens))}>MAX</button>
                                ) : null}
                              </span>
                            )
                          ) : null}
                        </div>
                        <div className="relative">
                          <Input
                            inputMode="decimal"
                            placeholder="0.0"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                            className="h-12 rounded-xl border-white/[0.08] bg-white/[0.03] pr-16 text-lg font-semibold placeholder:text-white/35 focus-visible:ring-white/25"
                          />
                          <span className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-xs font-bold">
                            {tab === "buy" ? <><AseLogo size={12} />ASE</> : <>{linkUrl(meta?.logoUrl) ? <img src={linkUrl(meta?.logoUrl)!} alt="" className="h-3 w-3 rounded-md object-cover" /> : null}<span className="max-w-24 truncate">{launch.symbol}</span></>}
                          </span>
                        </div>

                        <div className="mt-2 flex gap-1.5">
                          {(tab === "buy" ? QUICK_BUY : QUICK_SELL).map((v) => (
                            <button
                              key={v}
                              onClick={() => setAmount(tab === "buy" ? v : weiToDecimal((heldTokens * safeBig(v)) / 100n))}
                              className="flex-1 rounded-md border border-white/[0.08] bg-white/[0.04] py-1 text-[11px] font-medium text-white/60 transition hover:border-white/30 hover:text-white"
                            >
                              {tab === "buy" ? `${v} ASE` : `${v}%`}
                            </button>
                          ))}
                        </div>

                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-white/60">
                          <span>Slippage tolerance</span>
                          <div className="flex flex-wrap items-center gap-1">
                            {SLIPPAGE_PRESETS.map((s) => (
                              <button key={s} onClick={() => setSlippage(s)}
                                className={cn("rounded-md px-2 py-1 transition", slippage === s ? "bg-white/10 text-white" : "bg-white/5 text-white/55 hover:text-white/80")}>
                                {s}%
                              </button>
                            ))}
                            <input
                              aria-label="Custom slippage percentage"
                              inputMode="decimal"
                              value={slippage}
                              onChange={(e) => setSlippage(e.target.value)}
                              className="w-16 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-right text-white outline-none focus:border-white/30"
                            />
                            <span>%</span>
                          </div>
                        </div>

                        <div className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
                          <div className="flex justify-between text-xs">
                            <span className="text-white/60">You receive ≈</span>
                            <span className="inline-flex items-center gap-1 font-mono font-semibold">
                              {(!buyQuote && !sellQuote && quote.isFetching) ? "Fetching quote…" : (
                                tab === "buy"
                                  ? buyQuote ? <>{linkUrl(meta?.logoUrl) ? <img src={linkUrl(meta?.logoUrl)!} alt="" className="h-3.5 w-3.5 rounded-md object-cover" /> : null}{fmtTokens(buyQuote.tokensOut)} {launch.symbol}</> : "-"
                                  : sellQuote ? <>{fmtAse(sellQuote.aseOut, 4)} <AseLogo size={12} /> ASE</> : "-"
                              )}
                            </span>
                          </div>
                          <div className="mt-1 flex justify-between text-[11px] text-white/45">
                            <span>Protocol fee</span>
                            <span>{Number(launch.feeBps ?? cfg.data?.config?.feeBps ?? "30") / 100}%</span>
                          </div>
                          {quote.data?.priceImpactBps ? (
                            <div className="mt-1 flex justify-between text-[11px] text-white/45">
                              <span>Price impact</span><span>{(Number(quote.data.priceImpactBps) / 100).toFixed(2)}%</span>
                            </div>
                          ) : null}
                          {tab === "buy" && buyQuote?.willReachBondingTarget ? (
                            <p className="mt-2 rounded-md border border-white/15 bg-white/[0.06] px-2 py-1.5 text-[11px] font-semibold text-white/80">
                              Final buy: the full net ASE enters liquidity. Any amount above {fmtAse(launch.targetWei, 0)} ASE becomes extra AseDex liquidity.
                            </p>
                          ) : null}
                          {quote.isError ? (
                            <p className="mt-2 text-[11px] text-red-300">Quote request failed: {quote.error instanceof Error ? quote.error.message : "RPC error"}</p>
                          ) : null}
                          {quote.data?.feasible === false ? (
                            <p className="mt-2 text-[11px] text-amber-300">{quote.data.reason ?? "Quote unavailable"}</p>
                          ) : null}
                        </div>

                        {amount.trim() && amountWei === null ? (
                          <p className="mt-2 text-right text-[11px] text-amber-300">Use up to 18 decimals.</p>
                        ) : amountExceedsBalance ? (
                          <p className="mt-2 text-right text-[11px] text-amber-300">
                            Insufficient {tab === "buy" ? "ASE" : launch.symbol} balance.
                          </p>
                        ) : null}
                        {err ? <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{err}</p> : null}
                        {lastTx ? (
                          <p className={cn(
                            "mt-3 flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200 transition-all duration-500 ease-out",
                            lastTxVisible ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0"
                          )}>
                            <span className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5" />{lastTx.kind === "buy" ? "Bought" : "Sold"} successfully</span>
                            <a href={explorerTxUrl(lastTx.hash)} target="_blank" rel="noreferrer"
                              className="font-mono text-emerald-300/80 underline-offset-2 hover:underline">
                              {shortenAddress(lastTx.hash, 10, 8)}
                            </a>
                          </p>
                        ) : null}

                        <Button
                          className={cn("mt-4 h-12 w-full gap-2 rounded-xl text-base font-bold",
                            tab === "buy" ? "bg-emerald-400 text-black hover:bg-emerald-300" : "bg-red-400 text-black hover:bg-red-300")}
                          disabled={busy !== null || (wallet.status === "connected" && (amountInvalid || !(buyQuote || sellQuote) || (tab === "buy" ? buyQuote?.feasible === false : sellQuote?.feasible === false)))}
                          onClick={() => void trade()}
                        >
                          {busy ?? (wallet.status === "connected"
                            ? (tab === "buy" ? <><Rocket className="h-4 w-4" />Buy ${launch.symbol}</> : needsSellApproval ? `Approve & sell $${launch.symbol}` : `Sell $${launch.symbol}`)
                            : "Connect wallet")}
                        </Button>
                        {tab === "sell" && needsSellApproval ? (
                          <p className="mt-2 text-center text-[10px] text-white/45">
                            First signature approves AsePad; second settles the sell immediately.
                          </p>
                        ) : null}
                      </motion.div>
                    </AnimatePresence>
                  </>
                )}
              </Panel>

              {/* info */}
              <Panel className={cn("min-w-0 p-4", mobileView === "trade" && "max-lg:hidden")}>
                <p className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.18em] text-white/45">Info</p>
                <div className="space-y-2.5 text-sm">
                  <div className="flex justify-between"><span className="text-white/55">Creator</span><span className="font-mono text-xs">{namedAddr(launch.creator, addrNames, (a) => shortenAddress(a, 6, 4))}</span></div>
                  <div className="flex justify-between"><span className="text-white/55">Contract</span><span className="flex items-center gap-1.5 font-mono text-xs"><a href={explorerAddressUrl(launch.token)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 transition hover:text-white">{shortenAddress(launch.token, 6, 4)}<ExternalLink className="h-3 w-3" /></a><CopyBtn text={launch.token} /></span></div>
                  {txMap.data?.launchTx ? (
                    <div className="flex justify-between"><span className="text-white/55">Launch tx</span><a href={explorerTxUrl(txMap.data.launchTx)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-white/80 transition hover:text-white hover:underline" title={txMap.data.launchTx}>{shortenAddress(txMap.data.launchTx, 8, 6)}<ExternalLink className="h-3 w-3" /></a></div>
                  ) : null}
                  <div className="flex justify-between"><span className="text-white/55">Status</span><span>{launch.status}</span></div>
                  <div className="flex justify-between"><span className="text-white/55">In curve</span><span className="font-mono text-xs">{fmtTokens(launch.tokensLeft)} {launch.symbol}</span></div>
                  <div className="flex justify-between"><span className="text-white/55">Initial price</span><span className="font-mono text-xs"><PricePower text={`${formatTokenPrice(Number(safeBig(launch.initialPriceWei ?? "0")) / 1e18)} ASE`} /></span></div>
                  <div className="flex justify-between"><span className="text-white/55">Curve inventory</span><span className="font-mono text-xs">{fmtTokens(launch.curveSupply ?? launch.supply)} {launch.symbol}</span></div>
                </div>
              </Panel>

              {/* migration - sits under Info in the right column */}
              {launch.status !== "BONDING" && d?.migration ? (
                <Panel className={cn("min-w-0 p-4", mobileView === "trade" && "max-lg:hidden")}>
                  <p className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.18em] text-white/45">Migration</p>
                  <div className="space-y-2.5 text-sm">
                    <div className="flex justify-between gap-3"><span className="text-white/55">Status</span><span className="font-semibold text-white">{d.migration.status === "MIGRATED" ? "Bonding Complete" : d.migration.status === "BONDED" ? "Ready to migrate" : `Migrating · ${d.migration.migrationStage}`}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-white/55">Creator reward</span><span className="font-mono text-xs font-semibold">{fmtAse(d.migration.creatorRewardWei ?? "0", 4)} ASE</span></div>
                    <div className="flex justify-between gap-3"><span className="text-white/55">AseDex liquidity</span><span className="text-right font-mono text-xs font-semibold">{fmtAse(d.migration.liquidityAseWei ?? "0", 4)} ASE + {fmtTokens(d.migration.liquidityTokenWei ?? "0")} {launch.symbol}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-white/55">Final curve price</span><span className="font-mono text-xs font-semibold"><PricePower text={`${formatTokenPrice(Number(safeBig(d.migration.finalPriceWei ?? "0")) / 1e18)} ASE`} /></span></div>
                    <div className="flex justify-between gap-3"><span className="text-white/55">Pool / LP burned</span><span className="font-mono text-xs font-semibold">{d.migration.aseDexPoolId || "pending"} · {fmtAse(d.migration.lpSharesBurned ?? "0", 2)} LP</span></div>
                  </div>
                  {d.migration.status === "BONDED" || d.migration.status === "MIGRATING" ? (
                    <p className="mt-3 text-xs leading-relaxed text-amber-200/80">
                      Migration completes automatically after the final buy. If a stage stalled, use the trade panel to finish it.
                    </p>
                  ) : null}
                </Panel>
              ) : null}
            </div>
          </div>

          {/* ── mobile action bar — app-style Swap | Buy | Sell; in the
              trade view it becomes the chart-return strip ── */}
          <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.08] bg-[#07080d]/95 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl lg:hidden">
            {mobileView === "trade" ? (
              <button onClick={() => setMobileView("chart")}
                className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-left transition active:scale-[0.99]">
                <ChevronDown className="h-3.5 w-3.5 shrink-0 rotate-90 text-white/60" />
                <span className="text-xs font-semibold text-white/85">{launch.symbol}-ASE Chart</span>
                <span className="ml-auto font-mono text-[11px] text-white/75"><PricePower text={formatTokenPriceLabel(displaySpot, displayUnit)} /></span>
                {priceChange !== null ? (
                  <span className={cn("font-mono text-[10px] font-semibold", priceChange >= 0 ? "text-emerald-300" : "text-red-300")}>
                    {priceChange >= 0 ? "+" : "-"}{Math.abs(priceChange).toFixed(2)}%
                  </span>
                ) : null}
              </button>
            ) : (
              <>
                <div className="flex items-center justify-between px-1 pb-1.5 text-[10px] text-white/45">
                  <span>My Bal {fmtTokens(String(heldTokens))} {launch.symbol}</span>
                  {priceChange !== null ? (
                    <span className={priceChange >= 0 ? "text-emerald-300" : "text-red-300"}>24h {priceChange >= 0 ? "+" : "-"}{Math.abs(priceChange).toFixed(2)}%</span>
                  ) : <span />}
                </div>
                <div className="grid grid-cols-[2.5rem_1fr_1fr] gap-2">
                  <button onClick={() => setMobileView("trade")} aria-label="Trade" title="Trade"
                    className="flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-white/70 transition active:scale-[0.97]">
                    <ArrowDownUp className="h-4 w-4" />
                  </button>
                  <button onClick={() => { setTab("buy"); setAmount(""); setErr(null); setMobileView("trade"); }}
                    className="rounded-xl bg-emerald-500 py-3 text-sm font-bold text-black transition active:scale-[0.98]">
                    Buy
                  </button>
                  <button onClick={() => { setTab("sell"); setAmount(""); setErr(null); setMobileView("trade"); }}
                    className="rounded-xl bg-red-500/90 py-3 text-sm font-bold text-white transition active:scale-[0.98]">
                    Sell
                  </button>
                </div>
              </>
            )}
          </div>
        </motion.div>
      </div>
    </>
  );
}
