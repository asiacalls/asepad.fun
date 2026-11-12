"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { LiveIndicator } from "@/components/live/live-chain";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useNames, namedAddr } from "@/lib/use-names";
import { ArrowLeftRight, ArrowRight, BadgeCheck, BarChart3, ChevronLeft, ChevronRight, Flame, Globe, LayoutGrid, List, Lock, Rocket, Search, Send, Sparkles, Target, Zap } from "lucide-react";
import {
  asepadGetConfig, asepadGetLaunchesPaged, asepadGetStats, asepadGetTrending, bondingMessage,
  fmtAse, fmtAseCompact, fmtTokens, linkUrl, socialUrl, type AsepadLaunch
} from "@/lib/asepad";
import { StatusBadge } from "@/components/status-badge";
import { shortenAddress } from "@/lib/asepad";
import { toAseAddress } from "@asentrise/utils";
import { cn } from "@/lib/cn";
import { href as siteHref } from "@/lib/site";

// Trending isn't a tab - the HOT tape above the board carries it, fed by a
// background query that always loads the 24h-volume ranking.
const FILTERS = [
  { id: "new", label: "Just Launched", icon: Sparkles },
  { id: "near", label: "Near Bonding", icon: Target },
  { id: "bonding", label: "Bonding", icon: Zap },
  { id: "migrated", label: "Migrated", icon: BadgeCheck }
] as const;

// Active pill tint per tab - matches what the section means.
const TAB_TINT: Record<string, string> = {
  new: "from-zinc-200/90 to-zinc-400/80 shadow-[0_0_16px_-4px_rgba(228,228,231,0.6)]",
  near: "from-amber-400/90 to-orange-500/80 shadow-[0_0_16px_-4px_rgba(251,191,36,0.7)]",
  bonding: "from-violet-500/90 to-fuchsia-500/80 shadow-[0_0_16px_-4px_rgba(139,92,246,0.7)]",
  migrated: "from-emerald-500/90 to-teal-400/80 shadow-[0_0_16px_-4px_rgba(16,185,129,0.7)]"
};

const timeAgo = (tsMs: number) => {
  const s = Math.max(0, Math.floor((Date.now() - tsMs) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30); if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
};
// Under the status badge: launch age for curves, migration time once live.
const stampOf = (l: AsepadLaunch) => {
  const ms = Number(l.status === "MIGRATED" && l.migratedTs ? l.migratedTs : l.createdTs);
  return ms ? timeAgo(ms) : "";
};

const NewTag = () => (
  <span className="relative inline-flex items-center rounded-full bg-emerald-400/15 px-1.5 py-px text-[9px] font-bold text-emerald-300">
    <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/20" />NEW
  </span>
);

const SocialBtns = ({ launch, size = "h-3 w-3" }: { launch: AsepadLaunch; size?: string }) => (<>
  {([
    { url: socialUrl("website", launch.meta?.website), label: "Website", icon: <Globe className={size} /> },
    { url: socialUrl("twitter", launch.meta?.twitter), label: "X", icon: <svg viewBox="0 0 24 24" fill="currentColor" className={size}><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg> },
    { url: socialUrl("telegram", launch.meta?.telegram), label: "Telegram", icon: <Send className={size} /> }
  ] as const).map((s) => s.url ? (
    <button key={s.label} type="button" aria-label={s.label} title={s.url}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(s.url, "_blank", "noopener,noreferrer"); }}
      className="text-white/40 transition hover:text-white"
    >{s.icon}</button>
  ) : null)}
</>);

const Logo = ({ launch, size = "h-11 w-11 text-sm" }: { launch: AsepadLaunch; size?: string }) => (
  linkUrl(launch.meta?.logoUrl) ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={linkUrl(launch.meta?.logoUrl)} alt="" className={cn(size, "shrink-0 rounded-xl border border-white/10 object-cover")} />
  ) : (
    <div className={cn(size, "flex shrink-0 items-center justify-center rounded-xl border border-white/10 bg-zinc-800 font-bold text-zinc-300 shadow-inner")}>
      {(launch.symbol || "?").slice(0, 2)}
    </div>
  )
);

// The trace is one continuous 3-color journey along the ring path: silver for
// the first 30%, blending to emerald by 70%, then amber at 100%. A migrated
// token's ring therefore shows the full silver→emerald→amber gradient; partial
// fills reveal only that much of it. Implemented as a conic-gradient border
// (padding-strip trick) - SVG strokes can't take along-path gradients.
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

const RingLogo = ({ launch, pct, box = "h-14 w-14", logo = "h-10 w-10 text-xs" }: { launch: AsepadLaunch; pct: number; box?: string; logo?: string }) => {
  const p = Math.max(1, Math.min(100, pct));
  const endDeg = (p / 100) * 360;
  // Ramp stops up to the fill point, the interpolated tip color, then a hard
  // cut to the faint unfilled track for the remaining degrees. -25deg `from`
  // aligns 0% with where the squircle path starts (top edge, clockwise).
  const stops = RING_STOPS.filter(([s]) => s <= p).map(([s, c]) => `${c} ${(s * 3.6).toFixed(1)}deg`);
  stops.push(`${ringColor(p)} ${endDeg.toFixed(1)}deg`);
  stops.push(`rgba(255,255,255,0.09) ${endDeg.toFixed(1)}deg`, "rgba(255,255,255,0.09) 360deg");
  return (
    <div className={cn("shrink-0 rounded-[26%] p-[1.5px]", box)}
      style={{ background: `conic-gradient(from -25deg at 50% 50%, ${stops.join(", ")})` }}>
      <div className="h-full w-full overflow-hidden rounded-[23%] bg-[#0a0a0c]">
        <Logo launch={launch} size={cn(logo, "h-full w-full")} />
      </div>
    </div>
  );
};

// Bonding progress - plain silver fill; the color story lives on the logo ring.
const ProgressBar = ({ pct, done }: { pct: number; done?: boolean }) => (
  <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
    <div
      className="h-full rounded-full bg-gradient-to-r from-zinc-500 via-zinc-300 to-zinc-400 transition-all"
      style={{ width: `${Math.max(2, pct)}%` }}
    />
  </div>
);

const StatCell = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-lg bg-white/[0.04] px-2 py-1.5">
    <p className="text-[9px] uppercase tracking-wider text-white/45">{label}</p>
    <p className="truncate font-mono text-[11px] font-semibold text-white/85">{value}</p>
  </div>
);

function TokenCard({ launch, fresh }: { launch: AsepadLaunch; fresh?: boolean }) {
  const names = useNames([launch.creator]);
  const pct = Math.min(100, (launch.progressBps ?? 0) / 100);
  const done = pct >= 100;

  return (
    <Link prefetch={false} href={siteHref(`/asepad/token/${toAseAddress(launch.token)}`)}>
      <motion.div
        layout
        initial={fresh ? { opacity: 0, scale: 0.96, y: -12 } : false}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        whileHover={{ y: -5 }}
        transition={{ type: "spring", stiffness: 300, damping: 24 }}
        className="group relative h-full"
      >
        <div className={cn(
          "relative flex h-full flex-col overflow-hidden rounded-[18px] border border-white/[0.08] bg-gradient-to-b from-white/[0.05] to-white/[0.02] p-4 backdrop-blur-sm transition-all duration-300 group-hover:border-white/25 group-hover:shadow-[0_8px_40px_-12px_rgba(255,255,255,0.18)]",
          fresh && "border-emerald-400/50 shadow-[0_0_24px_rgba(52,211,153,0.18)]"
        )}>
          {/* sheen sweep on hover */}
          <div className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/[0.06] to-transparent transition-transform duration-700 group-hover:translate-x-full" />

          <div className="relative mb-3 flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-3">
              <RingLogo launch={launch} pct={pct} />
              <div className="min-w-0">
                <p className="flex min-w-0 flex-wrap items-center gap-1.5 font-semibold leading-tight">
                  <span className="truncate">${launch.symbol || "?"}</span>
                  {fresh ? <NewTag /> : null}
                </p>
                <p className="truncate text-xs text-white/55">{launch.name}</p>
                <p className="mt-0.5 flex items-center gap-1.5"><SocialBtns launch={launch} /></p>
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <StatusBadge status={launch.status} lpBurned={launch.lpBurned} liveLabel="BONDED" />
              <span className="text-[10px] font-medium text-white/45">{stampOf(launch)}</span>
            </div>
          </div>

          <div className="relative mb-1.5 flex items-center justify-between text-[11px]">
            <span className="text-white/55">Bonding curve</span>
            <span className={cn("font-mono font-semibold", done ? "text-emerald-300" : "text-white/80")}>{pct.toFixed(1)}%</span>
          </div>
          <div className="relative"><ProgressBar pct={pct} done={done} /></div>
          <div className="relative mb-3 mt-1 flex items-center justify-between text-[10px] text-white/50">
            <span className="italic">{bondingMessage(pct)}</span>
            <span className="shrink-0 font-mono">{fmtAse(done ? (launch.finalAseReserve ?? launch.targetWei) : launch.reserve, 1)}/{fmtAse(launch.targetWei, 0)} ASE</span>
          </div>

          <div className="relative mt-auto grid grid-cols-3 gap-1.5">
            <StatCell label="Volume" value={fmtAse(launch.volume, 1)} />
            <StatCell label="Supply" value={fmtTokens(launch.supply)} />
            <StatCell label="Creator" value={namedAddr(launch.creator, names, shortenAddress)} />
          </div>
        </div>
      </motion.div>
    </Link>
  );
}

// Compact one-line launch row - the "list" density and the mobile layout.
// Fixed-width cells keep every column aligned across rows.
function TokenRow({ launch, fresh }: { launch: AsepadLaunch; fresh?: boolean }) {
  const names = useNames([launch.creator]);
  const pct = Math.min(100, (launch.progressBps ?? 0) / 100);
  return (
    <Link prefetch={false} href={siteHref(`/asepad/token/${toAseAddress(launch.token)}`)}>
      <div className={cn(
        "group flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 transition-colors hover:border-white/20 hover:bg-white/[0.04]",
        fresh && "border-emerald-400/50 shadow-[0_0_24px_rgba(52,211,153,0.18)]"
      )}>
        <Logo launch={launch} size="h-8 w-8 text-[11px]" />
        <div className="min-w-0 flex-1 sm:w-44 sm:flex-none">
          <p className="flex items-center gap-1.5 truncate text-xs font-semibold">
            <span className="truncate">${launch.symbol || "?"}</span>
            <span className="inline-flex items-center gap-1.5 sm:hidden"><SocialBtns launch={launch} /></span>
            {fresh ? <NewTag /> : null}
          </p>
          <p className="truncate text-[10px] text-white/50">{launch.name}</p>
        </div>
        <span className="shrink-0 font-mono text-[11px] font-semibold text-white/80 sm:hidden">{pct.toFixed(1)}%</span>
        <div className="hidden w-14 shrink-0 items-center gap-1.5 sm:flex"><SocialBtns launch={launch} /></div>
        <div className="w-20 shrink-0 space-y-1 text-right">
          <StatusBadge status={launch.status} lpBurned={launch.lpBurned} liveLabel="BONDED" />
          <p className="text-[10px] font-medium text-white/45">{stampOf(launch)}</p>
        </div>
        <div className="hidden min-w-0 flex-1 items-center gap-2 sm:flex">
          <ProgressBar pct={pct} done={pct >= 100} />
          <span className="w-10 shrink-0 text-right font-mono text-[10px] text-white/60">{pct.toFixed(1)}%</span>
        </div>
        <span className="hidden w-20 shrink-0 text-right font-mono text-[10px] text-white/60 sm:block">{`${fmtAse(launch.volume, 1)} ASE`}</span>
        <span className="hidden w-24 shrink-0 text-right font-mono text-[10px] text-white/45 lg:block">{namedAddr(launch.creator, names, shortenAddress)}</span>
      </div>
    </Link>
  );
}

const PAGE_SIZE = 12; // 3-col grid → full rows

const VALID_TABS = new Set(FILTERS.map((f) => f.id));
const filterFromUrl = () => {
  if (typeof window === "undefined") return "new";
  const t = new URLSearchParams(window.location.search).get("tab") || "new";
  return VALID_TABS.has(t as (typeof FILTERS)[number]["id"]) ? t : "new";
};

// Live tape - the trending board scrolling under the hero: rank + 24h volume.
// Reads whatever the trending list already has cached (session snapshot or
// persisted) - zero RPC.
function LaunchTape({ items }: { items: AsepadLaunch[] }) {
  const chips = items.length ? items.slice(0, 20).map((l, i) => (
    <Link key={l.token} prefetch={false} href={siteHref}(`/asepad/token/${toAseAddress(l.token)}`)}
      className={cn("group/chip relative shrink-0 rounded-md p-px",
        i < 3
          ? "shadow-[0_0_10px_-4px_rgba(249,115,22,0.4)]"
          : "shadow-[0_0_12px_-4px_rgba(249,115,22,0.35)]")}>
      {/* fire - ranks 4+ get a faint warm aura; top-3 burn: a continuous
          flame band along the chip's top edge - a soft ember bed plus nine
          overlapping licks flickering on their own clocks so it reads as one
          live flame, not bouncing blobs */}
      {i < 3 ? (
        <span aria-hidden className="absolute -top-2.5 inset-x-1 h-3.5 overflow-visible">
          {/* ember bed - the shared glow the licks rise from */}
          <motion.span className="absolute bottom-0 inset-x-0 h-2 rounded-full bg-gradient-to-t from-orange-500/60 to-transparent blur-[3px]"
            animate={{ opacity: [0.5, 0.9, 0.65, 1, 0.5] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }} />
          {[
            { l: 5, w: 4, h: 8, d: 0.90 }, { l: 14, w: 5, h: 12, d: 1.15 },
            { l: 24, w: 4, h: 9, d: 0.75 }, { l: 34, w: 6, h: 13, d: 1.05 },
            { l: 45, w: 4, h: 10, d: 0.70 }, { l: 55, w: 6, h: 13, d: 1.20 },
            { l: 66, w: 4, h: 9, d: 0.85 }, { l: 76, w: 5, h: 12, d: 1.00 },
            { l: 87, w: 4, h: 8, d: 0.95 }
          ].map((f, j) => (
            <motion.span key={j}
              className="absolute bottom-0 rounded-[50%] bg-gradient-to-t from-amber-300 via-orange-500 to-red-500/40 blur-[1px] origin-bottom"
              style={{ left: `${f.l}%`, width: f.w, height: f.h }}
              animate={{
                scaleY: [0.45, 1.45, 0.65, 1.25, 0.45],
                scaleX: [1, 0.8, 1.15, 0.9, 1],
                opacity: [0.45, 1, 0.6, 0.95, 0.45],
                x: [0, 1, -1, 0.5, 0]
              }}
              transition={{
                duration: f.d + i * 0.12,
                repeat: Infinity,
                ease: "easeInOut",
                delay: j * 0.11 + i * 0.27
              }} />
          ))}
        </span>
      ) : (
        <span aria-hidden className="absolute -inset-0.5 rounded-md bg-orange-500/15 blur-[5px]" />
      )}
      {/* fire beam - a highlight sweeping around the chip's 1px border,
          staggered per rank so the pulses chase each other down the tape */}
      <span aria-hidden
        className={cn("absolute inset-0 animate-shimmer rounded-md",
          i < 3
            ? "bg-[linear-gradient(110deg,rgba(255,255,255,0.10)_0%,rgba(251,146,60,1)_35%,rgba(248,113,22,1)_50%,rgba(239,68,68,0.95)_62%,rgba(255,255,255,0.10)_100%)] bg-[length:300%_100%]"
            : "bg-[linear-gradient(110deg,rgba(255,255,255,0.12)_0%,rgba(251,146,60,0.75)_40%,rgba(248,113,22,0.85)_50%,rgba(255,255,255,0.12)_100%)] bg-[length:300%_100%]")}
        style={{ animationDelay: `${i * 0.28}s` }} />
      <span className="relative flex items-center gap-2 rounded-[5px] bg-[#0a0a0c] px-3.5 py-1.5 font-mono text-xs text-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] transition-colors group-hover/chip:bg-[#141417] group-hover/chip:text-white">
        {i < 3 ? <Flame className="h-3 w-3 text-orange-300" /> : null}
        <span className={cn("font-bold", i < 3 ? "text-orange-300" : "text-white/40")}>#{i + 1}</span>
        <Logo launch={l} size="h-4 w-4 text-[7px]" />
        <span className="font-semibold text-white/90">${l.symbol || "?"}</span>
      </span>
    </Link>
  )) : Array.from({ length: 8 }).map((_, i) => (
    <span key={i} className="inline-flex h-[30px] w-24 shrink-0 animate-pulse items-center gap-2 rounded-md border border-white/[0.07] bg-white/[0.04] px-3.5">
      <span className="h-2.5 w-2.5 rounded-full bg-white/[0.07]" />
      <span className="h-2 flex-1 rounded bg-white/[0.07]" />
    </span>
  ));
  return (
    <div className="group mb-6 flex items-center gap-2">
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-orange-400/35 bg-orange-400/10 px-3.5 py-1.5 font-mono text-xs font-bold tracking-widest text-orange-300 shadow-[0_0_14px_-3px_rgba(249,115,22,0.6)]">
        <Flame className="h-3.5 w-3.5" />HOT
      </span>
      <div className="min-w-0 flex-1 overflow-hidden py-1.5 [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)]">
        <div className="flex w-max animate-ticker-marquee group-hover:[animation-play-state:paused]">
          {[0, 1].map((half) => <div key={half} className="flex shrink-0 gap-2 pr-2">{chips}</div>)}
        </div>
      </div>
    </div>
  );
}

export default function AsepadPage() {
  const qc = useQueryClient();
  // Tab lives in the URL (?tab=) - card → token page → Back restores the
  // section you were on instead of dropping to Just Launched. State init is
  // "new" for SSR/hydration; the mount effect applies the real URL value.
  const [filter, setFilterState] = useState<string>("new");
  const setFilter = (f: string) => {
    setFilterState(f);
    try {
      const url = new URL(window.location.href);
      if (f === "new") url.searchParams.delete("tab"); else url.searchParams.set("tab", f);
      window.history.pushState(null, "", url);
    } catch { }
  };
  useEffect(() => {
    const sync = () => setFilterState(filterFromUrl());
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  const [q, setQ] = useState("");
  // Debounce the query key - every keystroke used to rescan every launch,
  // which is why search felt like it never settled.
  const [search, setSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearch(q), 350);
    return () => clearTimeout(t);
  }, [q]);
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [filter, search]);
  // Grid/list toggle is desktop-only - mobile always renders the list rows.
  const [launchView, setLaunchView] = useState<"grid" | "list">("grid");
  const stats = useQuery({ queryKey: ["asepad-stats"], queryFn: asepadGetStats, staleTime: 0, placeholderData: keepPreviousData });
  // Bonding target for the hero copy - read from the contract config so an
  // owner-side setTarget change flows straight into the text.
  const cfg = useQuery({ queryKey: ["asepad-config"], queryFn: asepadGetConfig, staleTime: 60_000 });
  const targetAse = cfg.data?.config?.targetWei ? fmtAse(cfg.data.config.targetWei, 0) : null;
  // Server-paged board: each fetch returns one PAGE_SIZE slice plus the real
  // filtered total — the full ~17k-launch directory never lands in memory.
  // Filter + search + page all live in the key so every view queries AWS.
  const list = useQuery({
    queryKey: ["asepad-launches", filter, search, page],
    queryFn: () => asepadGetLaunchesPaged(
      filter, search, page, PAGE_SIZE,
      qc.getQueryData<{ config?: { targetWei?: string } }>(["asepad-config"])?.config?.targetWei ?? "0"
    ),
    staleTime: 15_000,
    refetchInterval: 20_000,
    placeholderData: keepPreviousData
  });
  // Tokens that appeared after the first load are highlighted as NEW for 30s.
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Record<string, number>>({});
  useEffect(() => {
    const launches = list.data?.launches;
    if (!launches) return;
    if (seen.current === null) {
      seen.current = new Set(launches.map((l) => l.token));
      return;
    }
    const added = launches.filter((l) => !seen.current!.has(l.token));
    if (!added.length) return;
    const now = Date.now();
    added.forEach((l) => seen.current!.add(l.token));
    setFresh((prev) => ({ ...prev, ...Object.fromEntries(added.map((l) => [l.token, now])) }));
  }, [list.data]);
  useEffect(() => {
    if (!Object.keys(fresh).length) return;
    const timer = setTimeout(() => {
      const cutoff = Date.now() - 30_000;
      setFresh((prev) => Object.fromEntries(Object.entries(prev).filter(([, ts]) => ts > cutoff)));
    }, 5_000);
    return () => clearTimeout(timer);
  }, [fresh]);

  // The NEW marker is a Just-Launched-only signal - a token newly appearing in
  // Migrated or Near Bonding isn't "new", it just entered that bucket.
  const newTab = filter === "new" && !search;
  const pageItems = list.data?.launches ?? [];
  const totalPages = Math.max(1, Math.ceil((list.data?.total ?? 0) / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const EMPTY: Record<string, { title: string; hint: string }> = {
    new: { title: "No tokens here yet.", hint: "No launches yet. Create the first token to open a curve." },
    near: { title: "No curves near bonding.", hint: "Launches getting close to graduating land here." },
    bonding: { title: "No active bonding curves.", hint: "Bonding curves live here. Brand-new launches sit under Just Launched." },
    migrated: { title: "No migrated tokens yet.", hint: "Graduated launches move liquidity to AseDex and land here." }
  };
  const empty = search
    ? { title: "No matches.", hint: `Nothing found for "${search}". Try a ticker, name, 0x or ase1 address.` }
    : EMPTY[filter] ?? EMPTY.new!;

  // Tape feed: the trending board loads in the background on every visit -
  // the tape IS the trending section now, so it always fetches + streams.
  const tape = useQuery({
    queryKey: ["asepad-launches", "trending", ""],
    queryFn: () => asepadGetTrending(
      qc.getQueryData<{ config?: { targetWei?: string } }>(["asepad-config"])?.config?.targetWei ?? "0"
    ),
    staleTime: 15_000,
    refetchInterval: 20_000
  });
  const tapeItems = tape.data ?? [];

  const searchBox = (className: string) => (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/35" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search name, $ticker, 0x or ase1…"
        className="h-9 w-full rounded-full border border-white/10 bg-white/[0.04] pl-8 pr-3 text-xs text-white/85 outline-none transition placeholder:text-white/35 focus:border-white/30 focus:bg-white/[0.06]"
      />
    </div>
  );

  const heroStats = [
    { label: "Tokens Launched", icon: Rocket, v: stats.data?.launches },
    { label: "Migrated", icon: BadgeCheck, v: stats.data?.migrated },
    { label: "ASE TVL", icon: Lock, v: stats.data ? `${fmtAseCompact(stats.data.tvlWei)} ASE` : undefined },
    { label: "Curve Volume", icon: Zap, v: stats.data ? `${fmtAseCompact(stats.data.curveVolumeWei)} ASE` : undefined },
    { label: "AseDex Volume", icon: ArrowLeftRight, v: stats.data ? `${fmtAseCompact(stats.data.dexVolumeWei)} ASE` : undefined },
    { label: "Total Volume", icon: BarChart3, v: stats.data ? `${fmtAseCompact(stats.data.volumeWei)} ASE` : undefined }
  ];

  return (
    <>
      <div className="mx-auto max-w-7xl px-4 pb-8 pt-16 md:pb-10 md:pt-20">
        {/* hero - cinematic brand banner with the protocol stats baked in */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }} className="relative mb-4 overflow-hidden rounded-3xl border border-white/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/asepad-hero.png" alt="" className="absolute inset-0 h-full w-full object-cover object-[center_22%] opacity-80" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/25 to-black" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/55 via-transparent to-black/40" />
          <div className="absolute right-4 top-4 z-10 md:right-6 md:top-6"><LiveIndicator /></div>
          <div className="relative flex flex-col items-center px-5 pb-6 pt-10 text-center md:px-9 md:pb-7 md:pt-14">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/asepadtitle.png" alt="AsePad" className="mb-4 h-12 w-auto max-w-[80vw] object-contain drop-shadow-[0_0_24px_rgba(255,255,255,0.3)] md:h-16 md:max-w-none" />
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-[9px] font-bold uppercase tracking-[0.18em] text-white/70 backdrop-blur">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              Fair launches · Bonding curves · Asentum
            </div>
            <h2 className="font-brand text-[26px] font-bold leading-[1.15] tracking-tight md:text-4xl">
              <span className="text-chrome-gradient text-neon">Launch a token.</span>
              <br />
              <span className="bg-gradient-to-r from-white via-zinc-300 to-zinc-400 bg-clip-text text-transparent">The curve does the rest.</span>
            </h2>
            <p className="mt-3 max-w-xl text-xs font-medium leading-relaxed text-white/85 md:text-sm">
              No presales, no insiders. Every launch trades on a transparent bonding curve, and
              once it fills{targetAse ? ` to ${targetAse} ASE` : ""}, liquidity migrates to AseDex and locks forever.
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <Link prefetch={false} href={siteHref("/create")}>
                <Button className="gap-2 bg-gradient-to-r from-white via-zinc-200 to-zinc-400 font-semibold text-black shadow-[0_0_24px_-6px] shadow-white/40 transition hover:shadow-white/60 hover:brightness-110">
                  <Rocket className="h-4 w-4" />Launch a token<ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link prefetch={false} href={siteHref("/docs")}>
                <Button variant="secondary" className="border-white/15 bg-white/[0.05] text-white/80 backdrop-blur hover:bg-white/[0.1] hover:text-white">How it works</Button>
              </Link>
            </div>

            {/* stats strip - glass tiles inside the banner */}
            <div className="mt-7 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {heroStats.map((s) => (
                <div key={s.label} className="rounded-xl border border-white/[0.08] bg-black/35 px-3.5 py-3 text-center backdrop-blur-md">
                  <p className="flex items-center justify-center gap-1.5 text-[9px] font-semibold uppercase tracking-widest text-white/50">
                    <s.icon className="h-3 w-3 text-white/60" />{s.label}
                  </p>
                  {s.v != null
                    ? <p className="mt-1.5 bg-gradient-to-r from-white to-white/70 bg-clip-text font-mono text-base font-bold text-transparent md:text-lg">{s.v}</p>
                    : <Skeleton className="mt-2 h-6 w-16 bg-white/10" />}
                </div>
              ))}
            </div>
            <p className="mt-5 text-center text-[10px] leading-relaxed text-white/60">All figures are testnet ASE with no real value. TVL counts ASE reserves sitting in active curves and AseDex pools; virtual pricing reserves are excluded. Curve volume counts successful gross buys plus sells.</p>
          </div>
        </motion.div>

        {/* live launch tape */}
        <LaunchTape items={tapeItems} />

        {/* controls - segmented tabs left, search + view toggle right */}
        <div className="mb-2 flex items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-full border border-white/[0.07] bg-white/[0.03] p-1">
            {FILTERS.map((f) => {
              const active = filter === f.id;
              return (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={cn(
                    "relative inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors md:text-xs",
                    active ? "text-white" : "text-white/55 hover:text-white/85"
                  )}
                >
                  {active ? <motion.span layoutId="asepad-tab" className={cn("absolute inset-0 rounded-full bg-gradient-to-r", TAB_TINT[f.id] ?? TAB_TINT.new)} transition={{ type: "spring", stiffness: 400, damping: 30 }} /> : null}
                  <f.icon className="relative h-3.5 w-3.5" />
                  <span className="relative">{f.label}</span>
                </button>
              );
            })}
          </div>
          <span className="hidden items-center gap-0.5 rounded-full border border-white/[0.07] bg-white/[0.03] p-1 md:inline-flex">
            {([["grid", LayoutGrid], ["list", List]] as const).map(([m, Icon]) => (
              <button key={m} type="button" aria-label={`${m} view`} onClick={() => setLaunchView(m)}
                className={cn("rounded-full p-1.5 transition-colors", launchView === m ? "bg-white/10 text-white" : "text-white/40 hover:text-white/75")}>
                <Icon className="h-3.5 w-3.5" />
              </button>
            ))}
          </span>
          {searchBox("hidden w-60 md:block")}
        </div>
        {searchBox("mb-4 w-full md:hidden")}

        {/* section caption */}
        <div className="mb-5 flex items-center justify-between px-1">
          <p className="text-[10px] uppercase tracking-widest text-white/40">
            {FILTERS.find((f) => f.id === filter)?.label}{search ? ` · "${search}"` : ""}
          </p>
          <p className="font-mono text-[10px] text-white/40">
            {(list.data?.total ?? 0) > 0 ? `${list.data!.total} token${list.data!.total === 1 ? "" : "s"}` : "…"} · live
          </p>
        </div>

        {/* Skeleton while nothing shaped yet: no data at all (isPending) OR a
            FIRST sweep still streaming with no match for this filter yet.
            isFetched stays true across refetches - an empty filter refreshing
            keeps its empty state instead of flickering into skeletons. */}
        {list.isPending ? (
          <>
            <div className={cn("gap-4 sm:grid-cols-2 lg:grid-cols-3", launchView === "grid" ? "hidden md:grid" : "hidden")}>
              {Array.from({ length: 6 }).map((_, i) => (
                /* card-shaped: logo+name, status badge, bonding bar, 3 stat cells */
                <div key={i} className="flex h-52 flex-col rounded-[18px] border border-white/[0.08] bg-white/[0.02] p-4">
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-11 w-11 rounded-full" />
                      <div className="space-y-1.5"><Skeleton className="h-3.5 w-20" /><Skeleton className="h-2.5 w-28" /></div>
                    </div>
                    <Skeleton className="h-5 w-16 rounded-full" />
                  </div>
                  <Skeleton className="h-2.5 w-24" />
                  <Skeleton className="mt-1.5 h-2 rounded-full" />
                  <div className="mt-auto grid grid-cols-3 gap-1.5">
                    <Skeleton className="h-9 rounded-lg" /><Skeleton className="h-9 rounded-lg" /><Skeleton className="h-9 rounded-lg" />
                  </div>
                </div>
              ))}
            </div>
            <div className={cn("flex-col gap-2", launchView === "list" ? "flex" : "flex md:hidden")}>
              {Array.from({ length: 6 }).map((_, i) => (
                /* row-shaped: logo + two lines + status pill, same height/padding as TokenRow */
                <div key={i} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                  <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
                  <div className="min-w-0 flex-1 space-y-1.5"><Skeleton className="h-3 w-24" /><Skeleton className="h-2.5 w-32 max-w-full" /></div>
                  <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
                </div>
              ))}
            </div>
          </>
        ) : pageItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] py-16 text-center">
            <p className="font-brand text-lg font-semibold">{empty.title}</p>
            <p className="mt-1 text-sm text-white/60">{empty.hint}</p>
            {!search ? (
              <Link prefetch={false} href={siteHref("/create")} className="mt-5 inline-block">
                <Button>Launch the first token</Button>
              </Link>
            ) : null}
          </div>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={`${filter}-${launchView}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.16, ease: "easeOut" }}>
              {/* grid cards - desktop only, and only in grid mode */}
              <div className={cn("gap-4 sm:grid-cols-2 lg:grid-cols-3", launchView === "grid" ? "hidden md:grid" : "hidden")}>
                <AnimatePresence initial={false}>
                  {pageItems.map((l) => <TokenCard key={l.token} launch={l} fresh={newTab && Boolean(fresh[l.token])} />)}
                </AnimatePresence>
              </div>
              {/* list rows - always on mobile, desktop when list mode picked */}
              <div className={cn("flex flex-col gap-1.5", launchView !== "list" && "md:hidden")}>
                {/* column titles - widths mirror TokenRow cells at each breakpoint */}
                <div className="flex items-center gap-3 px-3 pb-1 text-[9px] font-semibold uppercase tracking-wider text-white/40">
                  <span className="w-8 shrink-0" />
                  <span className="min-w-0 flex-1 sm:w-44 sm:flex-none">Token</span>
                  <span className="shrink-0 sm:hidden">Bond.</span>
                  <span className="hidden w-14 shrink-0 sm:block">Links</span>
                  <span className="w-20 shrink-0">Status</span>
                  <span className="hidden min-w-0 flex-1 sm:block">Bonding</span>
                  <span className="hidden w-20 shrink-0 text-right sm:block">Volume</span>
                  <span className="hidden w-24 shrink-0 text-right lg:block">Creator</span>
                </div>
                <AnimatePresence initial={false}>
                  {pageItems.map((l) => <TokenRow key={l.token} launch={l} fresh={newTab && Boolean(fresh[l.token])} />)}
                </AnimatePresence>
              </div>
              {/* pager - windowed: ‹ 1 … 6 7 8 … 40 ›, compact on mobile */}
              {totalPages > 1 ? (
                <div className="mt-6 flex items-center justify-center gap-1.5">
                  <button
                    type="button"
                    aria-label="Previous page"
                    disabled={safePage <= 1}
                    onClick={() => setPage(safePage - 1)}
                    className="inline-flex h-8 items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2.5 text-[11px] font-medium text-white/60 transition-colors hover:border-white/25 disabled:opacity-40 disabled:hover:border-white/10"
                  ><ChevronLeft className="h-3.5 w-3.5" /><span className="hidden sm:inline">Prev</span></button>
                  {(() => {
                    // First + last + a ±1 window around current; "…" marks gaps.
                    // Never renders more than ~7 items regardless of page count.
                    const items: (number | "…")[] = [];
                    const window = new Set<number>([1, totalPages, safePage - 1, safePage, safePage + 1]);
                    let prev = 0;
                    for (const n of [...window].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b)) {
                      if (prev && n - prev > 1) items.push("…");
                      items.push(n);
                      prev = n;
                    }
                    return items.map((it, i) => it === "…" ? (
                      <span key={`gap-${i}`} className="px-0.5 text-[11px] text-white/35">…</span>
                    ) : (
                      <button
                        key={it}
                        type="button"
                        onClick={() => setPage(it)}
                        className={cn(
                          "h-8 min-w-8 rounded-full border px-2 text-[11px] font-medium transition-colors",
                          it === safePage
                            ? "border-white/30 bg-white/10 text-white"
                            : "border-white/10 bg-white/[0.03] text-white/60 hover:border-white/25"
                        )}
                      >{it}</button>
                    ));
                  })()}
                  <button
                    type="button"
                    aria-label="Next page"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage(safePage + 1)}
                    className="inline-flex h-8 items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2.5 text-[11px] font-medium text-white/60 transition-colors hover:border-white/25 disabled:opacity-40 disabled:hover:border-white/10"
                  ><span className="hidden sm:inline">Next</span><ChevronRight className="h-3.5 w-3.5" /></button>
                </div>
              ) : null}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </>
  );
}
