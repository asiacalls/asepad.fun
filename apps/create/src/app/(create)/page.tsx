"use client";

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LiveIndicator } from "@/components/live/live-chain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  asepadGetConfig, asepadTokenSource, asepadGetLaunch, getStandardTokenFeeWei, getTaxTokenFeeWei,
  standardTokenSource, taxTokenSource, isValidAddressInput, tokenFactoryAddress, getCreatedTokenCounts,
  aseToWei, fmtAse, fmtTokens, linkUrl, safeBig, socialUrl, verifyTokenSourceString
} from "@/lib/asepad";
import Link from "next/link";
import { useWalletStore } from "@/stores/wallet";
import {
  deployContractWithWallet,
  requireWalletTxMined,
  sendWalletCall
} from "@/lib/asentum-wallet";
import { explorerAddressUrl } from "@/lib/explorer";
import { userLogNoteCreated } from "@/lib/user-log";
import { toAseAddress, toHexAddress } from "@asentrise/utils";
import { cn } from "@/lib/cn";
import { ArrowRight, Check, Coins, ExternalLink, Globe, Percent, Send, Zap } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { href as siteHref } from "@/lib/site";

type LaunchMode = "standard" | "asepad" | "tax";
const DESCRIPTION_MAX = 280;
// Capitalize the first letter of each word, preserving the rest as typed -
// "valhella token" -> "Valhella Token", "deLorean" -> "DeLorean".
const titleCaseName = (s: string) => s.replace(/(^|\s)(\S)/g, (_m, ws: string, c: string) => ws + c.toUpperCase());

/** "0"-"4" (up to 2dp) → basis points, or null when out of range/invalid. */
const pctToBps = (raw: string): number | null => {
  const v = raw.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  const bps = Math.round(Number(v) * 100);
  return bps >= 0 && bps <= 400 ? bps : null;
};

// Squircle logo tile - same grey fallback as the board's missing-logo tile.
function LogoPreview({ url }: { url: string }) {
  const [brokenFor, setBrokenFor] = useState<string | null>(null);
  const src = linkUrl(url);
  const broken = !src || brokenFor === src;
  return (
    <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-[inherit]">
      {src && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="logo preview" className="h-full w-full object-cover" onError={() => setBrokenFor(src)} />
      ) : (
        <span className={cn("font-bold", src && broken ? "text-[9px] uppercase tracking-wider text-white/40" : "text-xs text-zinc-300")}>
          {src && broken ? "broken" : "logo"}
        </span>
      )}
    </div>
  );
}

// Mode accent tints - each launch mode owns a color so the picker reads at a glance.
const MODE_TINT: Record<LaunchMode, { glow: string; chip: string; check: string }> = {
  asepad: { glow: "from-sky-400/[0.16] via-blue-500/[0.07] to-transparent", chip: "border-sky-300/30 bg-sky-400/10 text-sky-200", check: "border-zinc-200 bg-gradient-to-br from-white to-zinc-300" },
  standard: { glow: "from-zinc-300/[0.14] via-zinc-400/[0.06] to-transparent", chip: "border-white/25 bg-white/[0.08] text-white/85", check: "border-white bg-white" },
  tax: { glow: "from-amber-400/[0.16] via-orange-500/[0.07] to-transparent", chip: "border-amber-300/30 bg-amber-400/10 text-amber-200", check: "border-amber-300 bg-amber-300" }
};

function ModeCard({
  mode, selected, onSelect, icon, title, tagline, points
}: {
  mode: LaunchMode;
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  tagline: string;
  points: string[];
}) {
  const tint = MODE_TINT[mode];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-2xl border p-4 text-left transition-all duration-300 md:p-5",
        selected
          ? "border-white/25 bg-white/[0.05] shadow-[0_12px_40px_-16px_rgba(0,0,0,0.9)]"
          : "border-white/[0.08] bg-white/[0.02] hover:border-white/[0.16] hover:bg-white/[0.04]"
      )}
    >
      {selected ? (
        <motion.span
          aria-hidden
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.35 }}
          className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br", tint.glow)}
        />
      ) : null}
      <span className="relative flex items-center gap-3">
        <span className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-colors",
          selected ? tint.chip : "border-white/10 bg-white/[0.04] text-white/60 group-hover:text-white/80"
        )}>
          {icon}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold leading-tight">{title}</span>
          <span className="mt-0.5 block truncate text-[11px] leading-tight text-white/55">{tagline}</span>
        </span>
      </span>
      <ul className="relative mt-3 space-y-1.5 text-[11px] leading-snug text-white/65">
        {points.map((p) => (
          <li key={p} className="flex gap-2">
            <Check className={cn("mt-0.5 h-3 w-3 shrink-0", selected ? "text-white/85" : "text-white/35")} />
            <span>{p}</span>
          </li>
        ))}
      </ul>
      <motion.span
        key={String(selected)}
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 500, damping: 22 }}
        className={cn(
          "absolute right-4 top-4 flex h-5 w-5 items-center justify-center rounded-full border transition",
          selected ? cn(tint.check, "text-black") : "border-white/15 text-transparent group-hover:border-white/30"
        )}
      >
        <Check className="h-3 w-3" />
      </motion.span>
    </button>
  );
}

function Field({
  label, hint, error, children, className
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-white/45">{label}</label>
      {children}
      {error
        ? <p className="mt-1.5 text-xs text-red-300/80">{error}</p>
        : hint ? <p className="mt-1.5 text-[11px] leading-relaxed text-white/45">{hint}</p> : null}
    </div>
  );
}

// Glass section header - numbered, matching the asepad board's caption style.
const SectionLabel = ({ step, title, aside }: { step: React.ReactNode; title: string; aside?: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-3">
    <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] text-white/45">
      <span className="bg-gradient-to-r from-sky-300 to-violet-300 bg-clip-text font-mono text-transparent">{step}</span>
      {title}
    </p>
    {aside}
  </div>
);

// Shared glass panel for the form sections.
const Panel = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("rounded-2xl border border-white/[0.08] bg-black/30 p-4 backdrop-blur-md md:p-6", className)}>
    {children}
  </div>
);

const inputCls = "h-11 rounded-xl border-white/[0.08] bg-white/[0.03] placeholder:text-white/35 focus-visible:ring-sky-300/50";

// Live counts - AsePad bonding launches + standard factory tokens.
function CreatedCounts() {
  const q = useQuery({ queryKey: ["created-token-counts"], queryFn: getCreatedTokenCounts, staleTime: 30_000, refetchInterval: 30_000 });
  const cells = [
    { label: "AsePad Launches", sub: "bonding curve", v: q.data?.asepad, icon: <Zap className="h-3.5 w-3.5 text-zinc-300" /> },
    { label: "Self-Custodial", sub: "standard + tax", v: q.data?.standard, icon: <Coins className="h-3.5 w-3.5 text-amber-300" /> }
  ];
  return (
    <div className="mx-auto grid w-full max-w-md grid-cols-2 gap-2">
      {cells.map((c) => (
        <div key={c.label} className="rounded-xl border border-white/[0.08] bg-black/35 px-3.5 py-3 text-center backdrop-blur-md">
          <p className="flex items-center justify-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.18em] text-white/45">
            {c.icon}{c.label}
          </p>
          <p className="mt-1 font-mono text-lg font-bold leading-none text-white/90">{q.isPending ? "…" : c.v ?? "0"}</p>
          <p className="mt-1 text-[9px] uppercase tracking-wider text-white/35">{c.sub}</p>
        </div>
      ))}
    </div>
  );
}

// The preview mirrors the real token card on the asepad board: squircle logo
// inside the (empty) progress trace, tags, silver progress, stat cells.
function PreviewCard({
  mode, name, logoUrl, previewSymbol, previewSocials, description,
  supplyWei, targetWei, buyTaxBps
}: {
  mode: LaunchMode | null;
  name: string;
  logoUrl: string;
  previewSymbol: string;
  previewSocials: { url?: string; icon: React.ReactNode }[];
  description: string;
  supplyWei: bigint;
  targetWei?: string;
  buyTaxBps: number | null;
}) {
  const tag = mode === "asepad" ? "Bonding 0%" : mode === "tax" ? `Tax ${buyTaxBps !== null ? buyTaxBps / 100 : "?"}%` : "Self-custodial";
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-black/35 p-4 backdrop-blur-md">
      <div className="flex items-start gap-3.5">
        <div className="h-14 w-14 shrink-0 rounded-[26%] bg-white/[0.09] p-[1.5px]">
          <div className="h-full w-full overflow-hidden rounded-[23%] bg-zinc-800 text-zinc-300">
            {logoUrl.trim()
              ? <LogoPreview url={logoUrl} />
              : <div className="flex h-full w-full items-center justify-center text-xs font-bold">{previewSymbol.slice(0, 2)}</div>}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 truncate font-semibold leading-tight">
                <span className="truncate">{name.trim() || "Token name"}</span>
                {previewSocials.map((s, i) => s.url ? <span key={i} className="shrink-0 text-white/45">{s.icon}</span> : null)}
              </p>
              <p className="mt-0.5 text-xs text-white/55">${previewSymbol}</p>
            </div>
            {mode ? (
              <span className={cn(
                "shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
                mode === "asepad" ? "border-sky-300/25 bg-sky-400/10 text-sky-300"
                  : mode === "tax" ? "border-amber-300/25 bg-amber-400/10 text-amber-300"
                    : "border-white/15 bg-white/[0.06] text-white/70"
              )}>{tag}</span>
            ) : null}
          </div>
        </div>
      </div>
      {description.trim() ? (
        <p className="mt-3 line-clamp-3 text-xs leading-relaxed text-white/60">{description}</p>
      ) : null}
      {mode === "asepad" ? (
        <>
          <div className="mt-3.5 flex items-center justify-between text-[10px] text-white/50">
            <span>Bonding curve</span>
            <span className="font-mono font-semibold text-white/80">0.0%</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
            <div className="h-full w-[2%] rounded-full bg-gradient-to-r from-zinc-500 via-zinc-300 to-zinc-400" />
          </div>
        </>
      ) : null}
      <div className="mt-3.5 grid grid-cols-2 gap-1.5">
        <div className="rounded-lg bg-white/[0.04] px-2 py-1.5">
          <p className="text-[9px] uppercase tracking-wider text-white/45">{mode === "asepad" ? "Curve fills at" : "Supply"}</p>
          <p className="truncate font-mono text-[11px] font-semibold text-white/85">
            {mode === "asepad" ? `${fmtAse(targetWei, 0)} ASE` : `${fmtTokens(supplyWei) || "1B"} ${previewSymbol}`}
          </p>
        </div>
        <div className="rounded-lg bg-white/[0.04] px-2 py-1.5">
          <p className="text-[9px] uppercase tracking-wider text-white/45">Decimals</p>
          <p className="font-mono text-[11px] font-semibold text-white/85">{mode === "asepad" ? "18" : "custom"}</p>
        </div>
      </div>
    </div>
  );
}

function DeployedModal({
  result,
  onClose
}: {
  result: { mode: LaunchMode; token: string; symbol: string };
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ type: "spring", stiffness: 380, damping: 28 }}
        className="w-full max-w-md rounded-2xl border border-sky-300/25 bg-[#0b0d14] p-6 text-center shadow-[0_0_60px_-12px_rgba(56,189,248,0.35)]"
        onClick={(e) => e.stopPropagation()}
      >
        <motion.div
          initial={{ scale: 0 }} animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 400, damping: 18, delay: 0.08 }}
          className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-400/15 text-emerald-300 shadow-[0_0_24px_-4px] shadow-emerald-400/40"
        >
          <Check className="h-7 w-7" strokeWidth={3} />
        </motion.div>
        <h3 className="text-xl font-bold">
          {result.mode === "asepad" ? `${result.symbol} is live on the curve!` : `${result.symbol} deployed!`}
        </h3>
        <p className="mt-2 text-sm text-white/60">
          {result.mode === "asepad"
            ? "Your AsePad bonding-curve launch is open for trading."
            : "The token deployed and the full supply was sent to your wallet."}
        </p>
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2">
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-white/70">{toAseAddress(result.token)}</code>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              void navigator.clipboard?.writeText(toAseAddress(result.token));
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <div className="mt-5 flex flex-col gap-2">
          {result.mode === "asepad" ? (
            <Link prefetch={false} href={siteHref(`/asepad/token/${toAseAddress(result.token)}`)}>
              <Button className="w-full gap-1.5 bg-gradient-to-r from-white via-zinc-200 to-zinc-400 font-semibold text-black hover:brightness-110">Open token page <ArrowRight className="h-4 w-4" /></Button>
            </Link>
          ) : null}
          <a href={explorerAddressUrl(result.token)} target="_blank" rel="noreferrer">
            <Button variant="secondary" className="w-full gap-1.5">View on explorer <ExternalLink className="h-3.5 w-3.5" /></Button>
          </a>
          <Button variant="ghost" className="w-full" onClick={onClose}>Close</Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function CreateTokenPage() {
  const wallet = useWalletStore();
  const [mode, setMode] = useState<LaunchMode | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [deployed, setDeployed] = useState<{ mode: LaunchMode; token: string; symbol: string } | null>(null);
  const [form, setForm] = useState({
    name: "", symbol: "", decimals: "18", logoUrl: "", description: "",
    website: "", twitter: "", telegram: "",
    supply: "1000000000", initialBuy: "",
    buyTax: "1", sellTax: "1", taxWallet: ""
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  // Logo upload — 300 KB input cap, downscaled to 256×256 WebP and stored
  // as a data URI directly in the token card. No hosting step, the logo
  // travels with the launch record and every surface already renders it.
  const logoFileRef = useRef<HTMLInputElement>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoErr, setLogoErr] = useState<string | null>(null);
  const onLogoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setLogoErr(null);
    if (file.size > 300 * 1024) { setLogoErr("Image must be 300 KB or smaller."); return; }
    setLogoBusy(true);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      const ctx = document.createElement("canvas").getContext("2d");
      if (!ctx) { setLogoBusy(false); setLogoErr("Could not process image."); return; }
      // On-chain metadata is capped at 2048 chars total — the logo gets
      // ~1400 (≈1KB of image). Shrink until the data URI fits; static
      // images only, a real GIF can never get this small.
      const s = Math.min(img.width, img.height);
      let uri = "";
      for (const [size, q] of [[96, 0.6], [96, 0.45], [64, 0.5], [64, 0.4], [48, 0.4]] as const) {
        const c = document.createElement("canvas");
        c.width = c.height = size;
        c.getContext("2d")!.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        uri = c.toDataURL("image/webp", q);
        if (uri.length <= 1400) break;
      }
      setLogoBusy(false);
      if (uri.length > 1400) setLogoErr("That image stays too big even at 48px, paste an image URL instead.");
      else setForm((f) => ({ ...f, logoUrl: uri }));
    };
    img.onerror = () => { URL.revokeObjectURL(img.src); setLogoBusy(false); setLogoErr("That file is not a readable image."); };
    img.src = URL.createObjectURL(file);
  };

  // All fees are admin-settable on-chain - always read live: refetch on
  // mount (no stale window) and keep polling while the page is open so a
  // changed fee shows within ~30s without a reload.
  const cfg = useQuery({ queryKey: ["asepad-config"], queryFn: asepadGetConfig, refetchOnMount: "always", refetchInterval: 30_000 });
  const standardFeeQuery = useQuery({ queryKey: ["token-factory-fee"], queryFn: getStandardTokenFeeWei, refetchOnMount: "always", refetchInterval: 30_000 });
  const taxFeeQuery = useQuery({ queryKey: ["token-factory-fee-tax"], queryFn: getTaxTokenFeeWei, refetchOnMount: "always", refetchInterval: 30_000 });

  // AsePad launches always use 1,000,000,000 supply @ 18 decimals; only
  // self-custodial tokens expose the editable supply/decimals fields.
  const decimals = mode === "asepad" ? 18 : /^\d+$/.test(form.decimals.trim()) ? Number(form.decimals.trim()) : NaN;
  const tokenUnit = Number.isInteger(decimals) && decimals >= 0 && decimals <= 38
    ? 10n ** safeBig(decimals)
    : 0n;
  const supplyWei = mode === "asepad"
    ? 1_000_000_000n * tokenUnit
    : /^\d+$/.test(form.supply.trim()) ? safeBig(form.supply.trim()) * tokenUnit : 0n;
  const curveSupplyWei = supplyWei;
  const initialPriceWei = 0n; // derived on-chain from the configured virtual market-cap base
  const initialBuyWei = /^\d+(\.\d{1,18})?$/.test(form.initialBuy.trim()) && form.initialBuy.trim()
    ? safeBig(aseToWei(form.initialBuy))
    : 0n;
  const tradeFeeBps = safeBig(cfg.data?.config?.feeBps ?? "30");
  const initialBuyNetWei = initialBuyWei - ((initialBuyWei * tradeFeeBps) / 10000n);
  const initialBuyTokens = tokenUnit > 0n && initialPriceWei > 0n
    ? (initialBuyNetWei * tokenUnit) / initialPriceWei
    : 0n;
  const creationFee = safeBig(cfg.data?.config?.creationFeeWei ?? "0");
  const standardFee = safeBig(standardFeeQuery.data ?? "0");
  const taxFee = safeBig(taxFeeQuery.data ?? "0");
  const totalCost = mode === "asepad" ? creationFee + initialBuyWei : mode === "standard" ? standardFee : mode === "tax" ? taxFee : 0n;

  // Tax mode - empty wallet input falls back to the connected creator wallet.
  const buyTaxBps = pctToBps(form.buyTax);
  const sellTaxBps = pctToBps(form.sellTax);
  const taxWalletInput = form.taxWallet.trim();
  const taxWalletValid = !taxWalletInput || isValidAddressInput(taxWalletInput);
  const taxValid = buyTaxBps !== null && sellTaxBps !== null && taxWalletValid;

  const basicsValid =
    form.name.trim().length >= 2 &&
    form.symbol.trim().length >= 1 &&
    (mode === "asepad" ||
      (/^\d+$/.test(form.supply.trim()) &&
        safeBig(form.supply.trim() || "0") > 0n &&
        tokenUnit > 0n));

  const asepadValid =
    curveSupplyWei > 0n &&
    (!form.initialBuy.trim() || (/^\d+(\.\d{1,18})?$/.test(form.initialBuy.trim()) && initialBuyWei > 0n));

  const valid = basicsValid &&
    (mode === "standard" || (mode === "asepad" && asepadValid) || (mode === "tax" && taxValid));

  // What's still missing - surfaced at the deploy button + highlighted fields.
  const missing: string[] = [];
  if (mode) {
    if (form.name.trim().length < 2) missing.push("name (2+ chars)");
    if (!form.symbol.trim()) missing.push("ticker");
    if (mode === "standard" || mode === "tax") {
      if (!/^\d+$/.test(form.supply.trim()) || safeBig(form.supply.trim() || "0") <= 0n) missing.push("supply");
      if (tokenUnit === 0n) missing.push("decimals (0-38)");
    }
    if (mode === "tax") {
      if (buyTaxBps === null) missing.push("buy tax (0-4%)");
      if (sellTaxBps === null) missing.push("sell tax (0-4%)");
      if (!taxWalletValid) missing.push("valid tax wallet (ase1… or 0x…)");
    }
    if (form.initialBuy.trim() && !/^\d+(\.\d{1,18})?$/.test(form.initialBuy.trim())) missing.push("valid initial buy");

  }
  const nameBad = Boolean(mode && form.name.trim().length < 2);
  const symbolBad = Boolean(mode && !form.symbol.trim());
  const supplyBad = Boolean((mode === "standard" || mode === "tax") && (!/^\d+$/.test(form.supply.trim()) || safeBig(form.supply.trim() || "0") <= 0n));
  const decimalsBad = Boolean((mode === "standard" || mode === "tax") && tokenUnit === 0n);
  const buyTaxBad = Boolean(mode === "tax" && buyTaxBps === null);
  const sellTaxBad = Boolean(mode === "tax" && sellTaxBps === null);
  const taxWalletBad = Boolean(mode === "tax" && !taxWalletValid);

  function friendlyErr(e: unknown): string {
    const msg = e instanceof Error ? e.message : "Deploy failed";
    if (/failed to fetch|networkerror|fetch failed/i.test(msg)) {
      const step = msg.match(/during ([^:]+)/i)?.[1];
      return `Network error${step ? ` during ${step}` : ""}. The wallet couldn't reach its signing relay or the node. Reconnect the wallet and retry.`;
    }
    return msg;
  }

  async function deployStandard() {
    setErr(null);
    if (wallet.status !== "connected" || !wallet.address) {
      wallet.openConnect?.(); return;
    }
    const factory = tokenFactoryAddress();
    if (!factory) { setErr("ARC-20 factory contract is not configured"); return; }
    try {
      const symbol = form.symbol.toUpperCase();
      const metadata = JSON.stringify({
        description: form.description || undefined,
        logoUrl: form.logoUrl || undefined,
        website: form.website || undefined,
        twitter: form.twitter || undefined,
        telegram: form.telegram || undefined
      });
      // Tx 1/2: prepare - supply is minted to the creator at genesis, no init tx.
      setBusy("Preparing token… (tx 1 of 2)");
      const source = standardTokenSource({
        name: form.name, symbol, decimals: String(decimals), supply: supplyWei.toString(), creator: wallet.address, metadata
      });
      if (verifyTokenSourceString(source) !== "verified-standard") {
        setErr("Generated token source doesn't match the official template. Aborted before deploy.");
        return;
      }
      const dep = await deployContractWithWallet(source, { waitMs: 180_000 });

      setBusy("Activating token… (tx 2 of 2)");
      const fee = await getStandardTokenFeeWei();
      const registerHash = await sendWalletCall({
        to: factory,
        method: "registerToken",
        args: [dep.contractAddress, "STANDARD", wallet.address, JSON.stringify({ name: form.name, symbol, decimals, totalSupply: form.supply, metadata: JSON.parse(metadata) })],
        valueWei: fee
      });
      await requireWalletTxMined(registerHash, "factory registration", 180_000);
      // Journal into the per-user log - the wallet view discovers it instantly.
      try { userLogNoteCreated(toHexAddress(wallet.address), dep.contractAddress); } catch { }
      setDeployed({ mode: "standard", token: dep.contractAddress, symbol });
    } catch (e) {
      setErr(friendlyErr(e));
    } finally {
      setBusy(null);
    }
  }

  async function deployTax() {
    setErr(null);
    if (wallet.status !== "connected" || !wallet.address) {
      wallet.openConnect?.(); return;
    }
    const factory = tokenFactoryAddress();
    if (!factory) { setErr("ARC-20 factory contract is not configured"); return; }
    if (!process.env.NEXT_PUBLIC_CONTRACT_ASEDEX) { setErr("AseDex contract is not configured"); return; }
    if (buyTaxBps === null || sellTaxBps === null) { setErr("Buy/sell tax must be between 0% and 4%."); return; }
    if (!taxWalletValid) { setErr("Tax wallet isn't a valid address (ase1… or 0x…)."); return; }
    try {
      const symbol = form.symbol.toUpperCase();
      const metadata = JSON.stringify({
        description: form.description || undefined,
        logoUrl: form.logoUrl || undefined,
        website: form.website || undefined,
        twitter: form.twitter || undefined,
        telegram: form.telegram || undefined
      });
      // Tx 1/2: prepare - supply minted to the creator, tax config locked at genesis.
      // Empty tax wallet input falls back to the creator's own wallet.
      setBusy("Preparing token… (tx 1 of 2)");
      const source = taxTokenSource({
        name: form.name, symbol, decimals: String(decimals), supply: supplyWei.toString(), creator: wallet.address, metadata,
        buyTaxBps: String(buyTaxBps), sellTaxBps: String(sellTaxBps),
        taxWallet: taxWalletInput || wallet.address
      });
      if (verifyTokenSourceString(source) !== "verified-tax") {
        setErr("Generated token source doesn't match the official template. Aborted before deploy.");
        return;
      }
      const dep = await deployContractWithWallet(source, { waitMs: 180_000 });

      setBusy("Activating token… (tx 2 of 2)");
      const fee = await getTaxTokenFeeWei();
      const registerHash = await sendWalletCall({
        to: factory,
        method: "registerToken",
        args: [dep.contractAddress, "TAX", wallet.address, JSON.stringify({ name: form.name, symbol, decimals, totalSupply: form.supply, buyTaxBps, sellTaxBps, taxWallet: taxWalletInput || wallet.address, metadata: JSON.parse(metadata) })],
        valueWei: fee
      });
      await requireWalletTxMined(registerHash, "factory registration", 180_000);
      try { userLogNoteCreated(toHexAddress(wallet.address), dep.contractAddress); } catch { }
      setDeployed({ mode: "tax", token: dep.contractAddress, symbol });
    } catch (e) {
      setErr(friendlyErr(e));
    } finally {
      setBusy(null);
    }
  }

  async function deployAsepad() {
    setErr(null);
    if (wallet.status !== "connected" || !wallet.address) {
      wallet.openConnect?.(); return;
    }
    const contract = cfg.data?.contract;
    if (!contract) { setErr("ASEPAD contract not configured"); return; }
    try {
      // Socials live in the token contract itself (views + source header) and on the launch record.
      const meta = JSON.stringify({
        description: form.description || undefined,
        logoUrl: form.logoUrl || undefined,
        website: form.website || undefined,
        twitter: form.twitter || undefined,
        telegram: form.telegram || undefined
      });
      // Signature 1/2: deploy - genesis credits the full supply to AsePad, no init/deposit txs.
      setBusy("Deploying token… (sign 1 of 2)");
      const source = asepadTokenSource({
        name: form.name, symbol: form.symbol, decimals: String(decimals), supply: supplyWei.toString(), pad: contract, creator: wallet.address, metadata: meta
      });
      if (verifyTokenSourceString(source) !== "verified-pad") {
        setErr("Generated token source doesn't match the official template. Aborted before deploy.");
        return;
      }
      const { contractAddress: token } = await deployContractWithWallet(source, { waitMs: 180_000 });

      setBusy("Opening bonding curve… (sign 2 of 2)");
      const clHash = await sendWalletCall({
        to: contract,
        method: "createLaunch",
        args: [token, form.name, form.symbol, supplyWei.toString(), curveSupplyWei.toString(), initialPriceWei.toString(), meta],
        valueWei: totalCost.toString()
      });
      await requireWalletTxMined(clHash, "createLaunch", 180_000);

      // Cache warm only - the deployed modal doesn't read it, so the button
      // frees at the receipt instead of waiting on one more RPC round trip.
      void asepadGetLaunch(token);
      try { userLogNoteCreated(toHexAddress(wallet.address), token); } catch { }
      setDeployed({ mode: "asepad", token, symbol: form.symbol || "TOKEN" });
    } catch (e) {
      setErr(friendlyErr(e));
    } finally {
      setBusy(null);
    }
  }

  async function deploy() {
    if (mode === "standard") return deployStandard();
    if (mode === "tax") return deployTax();
    if (mode === "asepad") return deployAsepad();
  }

  const previewSymbol = form.symbol.trim().toUpperCase() || "TKN";
  const previewSocials = [
    { url: socialUrl("website", form.website), icon: <Globe className="h-3.5 w-3.5" /> },
    { url: socialUrl("twitter", form.twitter), icon: <svg viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg> },
    { url: socialUrl("telegram", form.telegram), icon: <Send className="h-3.5 w-3.5" /> }
  ];
  const preview = (
    <PreviewCard
      mode={mode}
      name={form.name}
      logoUrl={form.logoUrl}
      previewSymbol={previewSymbol}
      previewSocials={previewSocials}
      description={form.description}
      supplyWei={supplyWei}
      targetWei={cfg.data?.config?.targetWei}
      buyTaxBps={buyTaxBps}
    />
  );

  return (
    <>
      <div className="mx-auto max-w-7xl px-4 pb-8 pt-16 md:pb-10 md:pt-20">
        <AnimatePresence>{deployed ? <DeployedModal result={deployed} onClose={() => setDeployed(null)} /> : null}</AnimatePresence>

        {/* hero - compact cinematic banner matching the asepad board */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }} className="relative mb-6 overflow-hidden rounded-3xl border border-white/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/asepad-hero.png" alt="" className="absolute inset-0 h-full w-full object-cover object-[center_22%] opacity-60" />
          <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-[#07080d]/70 via-[#07080d]/45 to-[#07080d]/85" />
          <div className="absolute right-4 top-4 z-10 md:right-6 md:top-6"><LiveIndicator /></div>
          <div className="relative flex flex-col items-center px-5 py-7 text-center md:py-9">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/createtokentitle.png" alt="Create Token" className="h-12 w-auto max-w-[80vw] object-contain drop-shadow-[0_0_30px_rgba(125,211,252,0.3)] md:h-14 md:max-w-none" />
            <p className="mt-3 max-w-md text-xs font-medium leading-relaxed text-white/75 md:text-sm">
              Three ways to ship an ARC-20. Pick a mode, fill the details, sign, done.
            </p>
            <div className="mt-5 w-full"><CreatedCounts /></div>
          </div>
        </motion.div>

        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="min-w-0 space-y-6">
            {/* 01 - mode picker */}
            <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.05 }}>
              <SectionLabel step="01" title="Launch mode" />
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <ModeCard
                  mode="asepad"
                  selected={mode === "asepad"}
                  onSelect={() => setMode("asepad")}
                  icon={<Zap className="h-5 w-5" />}
                  title="AsePad launch"
                  tagline="Bonding curve, instant trading"
                  points={[
                    "Fixed 1B supply on the curve",
                    "Buys & sells settle instantly",
                    "Migrates to AseDex, LP burned",
                    "Optional creator initial buy"
                  ]}
                />
                <ModeCard
                  mode="standard"
                  selected={mode === "standard"}
                  onSelect={() => setMode("standard")}
                  icon={<Coins className="h-5 w-5" />}
                  title="Standard token"
                  tagline="Full supply to your wallet"
                  points={[
                    "Configurable supply & decimals",
                    "No taxes, no mint, no burn",
                    "Registered with the factory"
                  ]}
                />
                <ModeCard
                  mode="tax"
                  selected={mode === "tax"}
                  onSelect={() => setMode("tax")}
                  icon={<Percent className="h-5 w-5" />}
                  title="Tax token"
                  tagline="Buy/sell tax for marketing"
                  points={[
                    "Up to 4% per side, locked at deploy",
                    "Tax goes to your marketing wallet",
                    "No honeypot: tax can never change",
                    "Configurable supply & decimals"
                  ]}
                />
              </div>
            </motion.section>

            {/* 02 - token details */}
            <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.1 }}>
              <SectionLabel step="02" title="Token details"
                aside={!mode ? <span className="text-[11px] text-white/40">Select a launch mode first</span> : null} />
              <Panel className={cn("mt-3 transition-opacity", !mode && "pointer-events-none opacity-40")}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Token name" error={nameBad ? "Required, at least 2 characters." : undefined}>
                    <Input placeholder="Moon Protocol" maxLength={80} value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: titleCaseName(e.target.value) }))}
                      className={cn(inputCls, nameBad && "border-red-500/50")} />
                  </Field>
                  <Field label="Ticker" error={symbolBad ? "Required." : undefined}>
                    <Input placeholder="MOON" maxLength={20} value={form.symbol}
                      onChange={(e) => setForm((f) => ({ ...f, symbol: e.target.value.toUpperCase() }))}
                      className={cn(inputCls, symbolBad && "border-red-500/50")} />
                  </Field>
                </div>

                {mode ? (
                  <div className="mt-5 flex items-start gap-4 border-t border-white/[0.06] pt-5">
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-zinc-800 text-zinc-300">
                      <LogoPreview url={form.logoUrl} />
                    </div>
                    <Field label="Logo" className="flex-1" hint="Paste an image URL or upload a file. It stores directly in the token card, nothing can rot on a dead host.">
                      <Input placeholder="https://…/logo.png or upload below" value={form.logoUrl} onChange={set("logoUrl")} className={inputCls} />
                      <div className="mt-2 flex items-center gap-2">
                        <input ref={logoFileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onLogoFile} />
                        <button type="button" onClick={() => logoFileRef.current?.click()}
                          className="rounded-lg border border-white/[0.12] px-2.5 py-1 text-[10px] font-semibold text-white/70 transition hover:border-white/25 hover:text-white">
                          {logoBusy ? "Processing…" : "Upload image"}
                        </button>
                        <span className="text-[10px] text-white/35">PNG, JPG or WebP: compressed to a tiny embed stored on-chain with the token. Use the URL field for a full-res logo.</span>
                      </div>
                      {logoErr ? <p className="mt-1 text-[11px] text-red-300">{logoErr}</p> : null}
                    </Field>
                  </div>
                ) : null}

                {mode === "standard" || mode === "tax" ? (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: "easeOut" }}
                    className="mt-5 grid gap-4 border-t border-white/[0.06] pt-5 sm:grid-cols-2"
                  >
                    <Field label="Decimals" hint="0-38, standard is 18."
                      error={decimalsBad ? "Required, 0 to 38." : undefined}>
                      <Input inputMode="numeric" value={form.decimals} onChange={set("decimals")} className={cn(inputCls, decimalsBad && "border-red-500/50")} />
                    </Field>
                    <Field label="Total supply" hint="Any whole-number supply."
                      error={supplyBad ? "Required, positive whole number." : undefined}>
                      <Input inputMode="numeric" value={form.supply} onChange={set("supply")} className={cn(inputCls, supplyBad && "border-red-500/50")} />
                    </Field>
                  </motion.div>
                ) : null}

                {mode === "tax" ? (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: "easeOut" }}
                    className="mt-5 grid gap-4 border-t border-white/[0.06] pt-5 sm:grid-cols-3"
                  >
                    <Field label="Buy tax %" hint="0-4%, locked forever at deploy."
                      error={buyTaxBad ? "0 to 4, up to 2 decimals." : undefined}>
                      <Input inputMode="decimal" placeholder="1" value={form.buyTax} onChange={set("buyTax")} className={cn(inputCls, buyTaxBad && "border-red-500/50")} />
                    </Field>
                    <Field label="Sell tax %" hint="0-4%, locked forever at deploy."
                      error={sellTaxBad ? "0 to 4, up to 2 decimals." : undefined}>
                      <Input inputMode="decimal" placeholder="1" value={form.sellTax} onChange={set("sellTax")} className={cn(inputCls, sellTaxBad && "border-red-500/50")} />
                    </Field>
                    <Field label="Tax / marketing wallet" hint="Leave empty to use your own wallet."
                      error={taxWalletBad ? "Invalid address: ase1… or 0x…" : undefined}>
                      <Input placeholder="ase1… (optional)" value={form.taxWallet} onChange={set("taxWallet")} className={cn(inputCls, taxWalletBad && "border-red-500/50")} />
                    </Field>
                  </motion.div>
                ) : null}

                {mode === "asepad" || mode === "tax" ? (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: "easeOut" }}
                    className="mt-5 border-t border-white/[0.06] pt-5">
                    <Field label="Description" hint="Shown under the ticker on your token page.">
                      <Textarea rows={3} maxLength={DESCRIPTION_MAX} placeholder="What is this token about?" value={form.description} onChange={set("description")}
                        className="rounded-xl border-white/[0.08] bg-white/[0.03] placeholder:text-white/35 focus-visible:ring-sky-300/50" />
                      <p className="mt-1 text-right text-[10px] text-white/35">{form.description.length}/{DESCRIPTION_MAX}</p>
                    </Field>
                  </motion.div>
                ) : null}

                {mode ? (
                  <div className="mt-5 grid gap-4 border-t border-white/[0.06] pt-5 sm:grid-cols-3">
                    <Field label="Website" hint="doge.xyz or full URL"><Input placeholder="doge.xyz" value={form.website} onChange={set("website")} className={inputCls} /></Field>
                    <Field label="X / Twitter" hint="@handle"><Input placeholder="@handle" value={form.twitter} onChange={set("twitter")} className={inputCls} /></Field>
                    <Field label="Telegram" hint="@handle"><Input placeholder="@handle" value={form.telegram} onChange={set("telegram")} className={inputCls} /></Field>
                  </div>
                ) : null}
              </Panel>
            </motion.section>

            {/* preview - mobile/tablet only; desktop gets the sticky side panel */}
            <motion.section className="lg:hidden" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.15 }}>
              <SectionLabel step="03" title="Preview" />
              <div className="mx-auto mt-3 max-w-sm">{preview}</div>
              <p className="mt-2.5 text-center text-[10px] uppercase tracking-widest text-white/35">How your token card will look</p>
            </motion.section>

            {/* 03/04 - review & deploy */}
            {mode ? (
              <motion.section
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: "easeOut" }}
              >
                <SectionLabel
                  step={<><span className="hidden lg:inline">03</span><span className="lg:hidden">04</span></>}
                  title={mode === "asepad" ? "Launch" : "Review & deploy"}
                  aside={<span className="text-[11px] text-white/40">{mode === "asepad" ? "5 signatures" : "2 transactions"}</span>} />
                <Panel className="mt-3">
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div key={mode}
                      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15, ease: "easeOut" }}
                    >
                      {mode === "asepad" ? (
                        <div className="grid gap-4 sm:grid-cols-2">
                          <Field label="Creator initial buy (ASE)" hint="Optional, bought before public trading opens."
                            error={form.initialBuy.trim() && !/^\d+(\.\d{1,18})?$/.test(form.initialBuy.trim()) ? "Enter a valid ASE amount." : undefined}>
                            <Input inputMode="decimal" placeholder="0" value={form.initialBuy} onChange={set("initialBuy")} className={inputCls} />
                          </Field>
                          <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-xs leading-relaxed text-white/65">
                            Est. receive <span className="font-mono text-white/80">{initialBuyTokens > 0n ? fmtTokens(initialBuyTokens) : "0"} {previewSymbol}</span> after the {Number(cfg.data?.config?.feeBps ?? "30") / 100}% fee.
                            <br />At {fmtAse(cfg.data?.config?.targetWei, 0)} ASE the curve bonds and migrates to AseDex, LP permanently burned.
                          </div>
                        </div>
                      ) : mode === "tax" ? (
                        <p className="text-xs leading-relaxed text-white/65">
                          The full supply is minted to your wallet.{" "}
                          <span className="font-mono text-white/80">{buyTaxBps !== null ? buyTaxBps / 100 : "?"}% buy</span>{" "}
                          and{" "}
                          <span className="font-mono text-white/80">{sellTaxBps !== null ? sellTaxBps / 100 : "?"}% sell</span>{" "}
                          tax applies on dex trades only. Wallet-to-wallet transfers stay free. Tax tokens collect to{" "}
                          {taxWalletInput
                            ? <span className="font-mono text-white/80">your marketing wallet</span>
                            : <span className="font-mono text-white/80">your own wallet</span>}{" "}
                          and the rates can never change. No honeypot.
                        </p>
                      ) : (
                        <p className="text-xs leading-relaxed text-white/65">
                          The full supply is minted to your wallet. Fixed supply, 0% tax, no mint or burn functions.
                        </p>
                      )}
                    </motion.div>
                  </AnimatePresence>

                  {busy ? (
                    <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-sky-300/25 bg-sky-400/[0.07] px-4 py-3 text-sm text-sky-300">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-zinc-300" />
                      {busy} · keep your wallet open.
                    </div>
                  ) : null}
                  {err ? (
                    <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{err}</div>
                  ) : missing.length > 0 ? (
                    <p className="mt-4 text-xs text-amber-300/90">Missing: {missing.join(" · ")}</p>
                  ) : null}

                  {/* cost + deploy */}
                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
                    <div className="text-xs text-white/65">
                      <p>
                        {mode === "asepad" ? "5 signatures" : "2 transactions"} · fee{" "}
                        <span className="font-mono text-white/80">{fmtAse((mode === "asepad" ? creationFee : mode === "tax" ? taxFee : standardFee).toString())} ASE</span>
                        {mode === "asepad" && initialBuyWei > 0n ? <> + buy <span className="font-mono text-white/80">{fmtAse(initialBuyWei.toString())} ASE</span></> : null}
                      </p>
                      <p className="mt-0.5 text-sm font-semibold text-white">Total {fmtAse(totalCost.toString())} ASE + gas</p>
                    </div>
                    <Button size="lg" disabled={busy !== null || (wallet.status === "connected" && !valid)} onClick={() => void deploy()}
                      className="min-w-56 gap-2 bg-gradient-to-r from-white via-zinc-200 to-zinc-400 font-semibold text-black shadow-[0_0_24px_-6px] shadow-white/40 transition hover:shadow-white/60 hover:brightness-110 disabled:from-zinc-600 disabled:to-zinc-700 disabled:text-white/60 disabled:shadow-none">
                      {wallet.status === "connected"
                        ? <>{busy ?? (mode === "asepad" ? "Launch on AsePad" : "Deploy token")}{!busy && <ArrowRight className="h-4 w-4" />}</>
                        : "Connect wallet to deploy"}
                    </Button>
                  </div>
                </Panel>
              </motion.section>
            ) : null}
          </div>

          {/* right: sticky live preview (desktop) */}
          <div className="hidden lg:block">
            <SectionLabel step="◈" title="Live preview" />
            <div className="sticky top-24 mt-3 space-y-3">
              {preview}
              <p className="text-center text-[10px] uppercase tracking-widest text-white/35">How your token card will look</p>
              <div className="rounded-2xl border border-white/[0.08] bg-black/30 px-4 py-3.5 text-center backdrop-blur-md">
                <p className="text-[10px] leading-relaxed text-white/45">
                  AsePad is an independent project on the Asentum testnet. All figures are testnet ASE with no real value.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
