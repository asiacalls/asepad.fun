"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { LiveIndicator } from "@/components/live/live-chain";
import { useWalletStore } from "@/stores/wallet";
import { apiPool, apiResolve, UNIFIED_API } from "@/lib/ase-api";
import { safeBig, shortenAddress } from "@/lib/asepad";
import { toAseAddress, toHexAddress } from "@asentrise/utils";
import { explorerAddressUrl } from "@/lib/explorer";
import { cn } from "@/lib/cn";
import { ArrowLeft, Check, Clock, Copy, ExternalLink, Flame, Lock as LockIcon, LockOpen, Send, ShieldCheck, Users } from "lucide-react";
import { LOCK, LOCK_V2, DEX, NATIVE, KIND_LABEL, KIND_CLS, STATE_CLS, Panel, asJson, fmtDate, fmtWei, timeLeft, type Bene, type LockRec } from "@/lib/lock-shared";
import { href as siteHref } from "@/lib/site";

type TokInfo = { address: string; symbol: string; name: string; decimals: number; totalSupply: bigint; logoUrl?: string };
type PoolInfo = { token0: string; token1: string; reserve0: bigint; reserve1: bigint; totalShares: bigint };

const ASE_INFO: TokInfo = { address: NATIVE, symbol: "ASE", name: "Asentum", decimals: 18, totalSupply: 0n, logoUrl: "/ase.png" };

async function readTokens(addrs: string[]): Promise<Record<string, TokInfo>> {
  const list = [...new Set(addrs.filter((a) => a && a !== NATIVE))];
  const out: Record<string, TokInfo> = { [NATIVE]: ASE_INFO };
  if (!list.length) return out;
  // AWS resolve first — symbol/name/decimals/supply/logo in one call each;
  // only unindexed tokens pay the six-view chain batch.
  const misses = await Promise.all(list.map(async (a) => {
    const r = await apiResolve(a).catch(() => null);
    const t = r?.token;
    if (!t || !(t.symbol || t.name)) return a;
    let logoUrl: string | undefined = typeof t.logo_url === "string" && /^https?:\/\//i.test(t.logo_url) ? t.logo_url : undefined;
    if (!logoUrl && typeof t.card_json === "string") {
      try { const c = JSON.parse(t.card_json) as { metadata?: { logoUrl?: string }; logoUrl?: string }; logoUrl = c?.metadata?.logoUrl ?? c?.logoUrl; } catch { }
    }
    out[a] = {
      address: a,
      symbol: String(t.symbol ?? t.name ?? "?").trim().slice(0, 16) || "?",
      name: String(t.name ?? "").trim().slice(0, 48),
      decimals: Number(t.decimals ?? 18) || 18,
      totalSupply: safeBig(t.total_supply ?? 0),
      logoUrl
    };
    return null;
  }));
  // No chain fallback — unindexed tokens keep the "?" placeholder until the
  // indexer catches up. Display paths never read the chain.
  return out;
}

const pct = (part: bigint, whole: bigint) => (whole > 0n ? Number((part * 1_000_000n) / whole) / 10_000 : 0);
const vestedAt = (wei: bigint, s: number, e: number, now: number) =>
  now <= s ? 0n : now >= e ? wei : (wei * BigInt(Math.floor(now - s))) / BigInt(Math.max(1, Math.floor(e - s)));

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/[0.05] py-2.5 text-sm last:border-0">
      <span className="shrink-0 text-white/55">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}

function AddrLink({ hex, you }: { hex: string; you?: boolean }) {
  return (
    <a href={explorerAddressUrl(hex)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-white/80 transition hover:text-white">
      {shortenAddress(toAseAddress(hex), 10, 6)}<ExternalLink className="h-3 w-3 text-white/40" />
      {you ? <span className="ml-1 rounded bg-white/10 px-1 font-sans text-[9px] font-bold text-white/80">you</span> : null}
    </a>
  );
}

function TokenLogo({ t, cls }: { t?: TokInfo; cls?: string }) {
  const [bad, setBad] = useState(false);
  if (t?.logoUrl && !bad)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={t.logoUrl} alt={t.symbol} onError={() => setBad(true)} className={cn("border border-white/10 object-cover", t.address === NATIVE ? "rounded-full" : "rounded-xl", cls)} />;
  return <span className={cn("flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] font-bold text-white/70", cls)}>{(t?.symbol ?? "?").slice(0, 3)}</span>;
}

export function LockDetail({ id, v }: { id: string; v?: "2" }) {
  const wallet = useWalletStore();
  const me = wallet.status === "connected" && wallet.address ? toHexAddress(wallet.address).toLowerCase() : undefined;
  const validId = /^\d+$/.test(id);
  // /lock/v2/<id> (or legacy ?v=2) → v2 contract — v1/v2 share the lock-id
  // space, so the detail page must know which contract to query.
  const lockAddr = v === "2" || (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("v") === "2") ? LOCK_V2 : LOCK;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  const lock = useQuery({
    queryKey: ["aselock-detail", lockAddr, id],
    enabled: validId,
    refetchInterval: 30_000,
    queryFn: async () => {
      // AWS-only — raw_json is the full contract record. When the API itself
      // is unreachable the page stays on its loading/error state rather than
      // reading the chain.
      const api = await fetch(`${UNIFIED_API}/api/locks?id=${lockAddr}:${id}`)
        .then((r) => r.ok ? r.json() : null).catch(() => null) as { locks?: { raw_json?: string | null }[] } | null;
      if (!api) throw new Error("api unreachable");
      const rec = asJson(api.locks?.[0]?.raw_json) as LockRec | null;
      if (rec && rec.owner) { if (!rec.state) rec.state = "LOCKED"; return rec; }
      return null;
    }
  });
  const rec = lock.data ?? null;

  const pool = useQuery({
    queryKey: ["aselock-detail-pool", rec?.poolId],
    enabled: Boolean(rec?.kind === "LP" && rec.poolId && DEX),
    refetchInterval: 60_000,
    queryFn: async (): Promise<PoolInfo | null> => {
      // AWS-only — reserves + lp_supply are indexed; an unindexed pool shows
      // nothing until the indexer catches up.
      const api = await apiPool(DEX, rec!.poolId!).catch(() => null);
      const ap = api?.pool;
      if (!ap?.token0) return null;
      return {
        token0: String(ap.token0).toLowerCase(), token1: String(ap.token1).toLowerCase(),
        reserve0: safeBig(ap.reserve0 ?? "0"), reserve1: safeBig(ap.reserve1 ?? "0"), totalShares: safeBig(ap.lp_supply ?? "0")
      };
    }
  });

  const tokenAddrs = useMemo(() => (rec?.kind === "LP" ? (pool.data ? [pool.data.token0, pool.data.token1] : []) : rec?.token ? [rec.token] : []), [rec, pool.data]);
  const tokens = useQuery({
    queryKey: ["aselock-detail-tokens", tokenAddrs.join(",")],
    enabled: tokenAddrs.length > 0,
    staleTime: 300_000,
    queryFn: () => readTokens(tokenAddrs)
  });
  const T = tokens.data ?? {};

  // ── derived ────────────────────────────────────────────────────────────────
  const isLp = rec?.kind === "LP";
  const isVest = rec?.kind === "VEST" || rec?.kind === "VESTM";
  const amt = safeBig(rec?.amt ?? "0");
  const tok = rec?.token ? T[rec.token] : undefined;
  const p = pool.data;
  const base = p ? (p.token0 === NATIVE ? T[p.token1] : T[p.token0]) : undefined;
  const quote = p ? (p.token0 === NATIVE ? T[p.token0] : T[p.token1]) : undefined;
  const pairLabel = p ? `${base?.symbol ?? "…"}/${quote?.symbol ?? "…"}` : rec?.poolId ? `Pool #${rec.poolId}` : "";
  const lpPct = p ? pct(amt, p.totalShares) : 0;
  const under0 = p && p.totalShares > 0n ? (p.reserve0 * amt) / p.totalShares : 0n;
  const under1 = p && p.totalShares > 0n ? (p.reserve1 * amt) / p.totalShares : 0n;
  const supplyPct = tok ? pct(amt, tok.totalSupply) : 0;

  const created = Number(rec?.createdTs ?? 0);
  const unlockAt = Number(rec?.unlockTs ?? 0);
  const startMs = Number(rec?.startMs ?? 0), endMs = Number(rec?.endMs ?? 0);
  const timeProgress = isVest
    ? (endMs > startMs ? Math.min(100, Math.max(0, ((now - startMs) / (endMs - startMs)) * 100)) : 0)
    : (unlockAt > created ? Math.min(100, Math.max(0, ((now - created) / (unlockAt - created)) * 100)) : 0);
  const unlocked = !isVest && unlockAt > 0 && now >= unlockAt;

  const vestedTotal = isVest ? vestedAt(amt, startMs, endMs, now) : 0n;
  const claimedTotal = rec?.kind === "VEST" ? safeBig(rec.claimedWei ?? "0")
    : rec?.kind === "VESTM" ? (rec.benes ?? []).reduce((s, b) => s + safeBig(b.claimed), 0n) : 0n;
  const stillLockedVest = amt - claimedTotal;

  const mine = Boolean(me && rec && (rec.owner === me || rec.benes?.some((b) => b.addr === me)));

  // ── share ──────────────────────────────────────────────────────────────────
  const [copied, setCopied] = useState(false);
  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/lock/${id}` : `https://asepad.fun/lock/${id}`;
  const assetName = isLp ? `${pairLabel} LP` : tok ? `$${tok.symbol}` : "tokens";
  const shareText = rec
    ? isVest
      ? `${fmtWei(amt.toString(), tok?.decimals ?? 18)} ${assetName} vesting on AseLock until ${new Date(endMs).toLocaleDateString()} · verified on-chain 🔒`
      : `${isLp ? `${lpPct.toFixed(2)}% of the ${pairLabel} liquidity` : `${fmtWei(amt.toString(), tok?.decimals ?? 18)} ${assetName}`} is locked on AseLock until ${new Date(unlockAt).toLocaleDateString()} · verified on-chain 🔒`
    : "";
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { }
  };

  // ── render ─────────────────────────────────────────────────────────────────
  const shell = (body: React.ReactNode) => (
    <PageShell center title="Token Lock" titleImg="/brand/tokenlocktitle.png" titleImgClassName="h-7 md:h-9" right={<LiveIndicator />}>
      <div className="mx-auto max-w-4xl">
        <a href="/" className="mb-4 inline-flex items-center gap-1.5 text-xs text-white/60 transition hover:text-white"><ArrowLeft className="h-3.5 w-3.5" />All locks</a>
        {body}
      </div>
    </PageShell>
  );

  if (!validId) return shell(<Panel className="p-10 text-center text-sm text-white/60">Invalid lock id.</Panel>);
  if (lock.isPending) return shell(
    <Panel className="p-5 md:p-6">
      <div className="flex items-center gap-3.5">
        <div className="h-12 w-12 shrink-0 animate-pulse rounded-xl bg-white/[0.07]" />
        <div className="space-y-1.5">
          <div className="h-4 w-40 animate-pulse rounded bg-white/[0.07]" />
          <div className="h-3 w-28 animate-pulse rounded bg-white/[0.05]" />
        </div>
      </div>
      <div className="mt-5 space-y-2.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex justify-between">
            <div className="h-3 w-20 animate-pulse rounded bg-white/[0.06]" />
            <div className="h-3 w-28 animate-pulse rounded bg-white/[0.06]" />
          </div>
        ))}
      </div>
    </Panel>
  );
  if (!rec) return shell(<Panel className="p-10 text-center text-sm text-white/60">Lock #{id} doesn&apos;t exist on AseLock{lockAddr === LOCK_V2 ? " v2" : ""}.</Panel>);

  return shell(
    <div className="space-y-4">
      {/* ── hero ─────────────────────────────────────────────────────────── */}
      <Panel className="p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3.5">
            {isLp ? (
              <span className="relative flex shrink-0">
                <TokenLogo t={base} cls="h-12 w-12 text-xs" />
                <TokenLogo t={quote} cls="-ml-3 mt-4 h-8 w-8 text-[9px]" />
              </span>
            ) : <TokenLogo t={tok} cls="h-12 w-12 shrink-0 text-xs" />}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={cn("rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide", KIND_CLS[rec.kind])}>{KIND_LABEL[rec.kind]}</span>
                <span className={cn("rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide", STATE_CLS[rec.state])}>
                  {rec.state === "BURNED" ? <Flame className="mr-0.5 inline h-3 w-3" /> : rec.state === "LOCKED" ? <LockIcon className="mr-0.5 inline h-3 w-3" /> : <LockOpen className="mr-0.5 inline h-3 w-3" />}
                  {rec.state.toLowerCase()}
                </span>
                <span className="font-mono text-[11px] text-white/45">#{id}</span>
              </div>
              <h1 className="mt-1 truncate text-xl font-bold md:text-2xl">
                {isLp ? `${pairLabel} liquidity` : tok ? `$${tok.symbol}` : "Token"}
              </h1>
              <p className="truncate text-xs text-white/50">{isLp ? `AseDex pool #${rec.poolId}` : tok?.name || shortenAddress(rec.token ?? "")}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="secondary" onClick={() => void copyLink()}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? "Copied" : "Copy link"}
            </Button>
            <a href={`https://x.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noreferrer"
              className="flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-white/80 transition hover:border-white/25 hover:text-white">
              Share on X
            </a>
            <a href={`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer"
              className="flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-white/80 transition hover:border-white/25 hover:text-white">
              <Send className="h-3.5 w-3.5" />Telegram
            </a>
          </div>
        </div>

        {/* headline numbers */}
        <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-4">
          {(isLp ? [
            ["Locked", `${lpPct.toFixed(2)}%`, "of pool liquidity"],
            ["LP shares", fmtWei(amt.toString(), 18), "locked"],
            [base?.symbol ?? "Token", p ? fmtWei((p.token0 === NATIVE ? under1 : under0).toString(), base?.decimals ?? 18) : "…", "underlying"],
            [quote?.symbol ?? "ASE", p ? fmtWei((p.token0 === NATIVE ? under0 : under1).toString(), quote?.decimals ?? 18) : "…", "underlying"]
          ] : isVest ? [
            ["Total vesting", fmtWei(amt.toString(), tok?.decimals ?? 18), tok ? `$${tok.symbol}` : ""],
            ["Vested", `${pct(vestedTotal, amt).toFixed(1)}%`, fmtWei(vestedTotal.toString(), tok?.decimals ?? 18)],
            ["Claimed", fmtWei(claimedTotal.toString(), tok?.decimals ?? 18), `${pct(claimedTotal, amt).toFixed(1)}%`],
            ["Of supply", tok ? `${supplyPct.toFixed(2)}%` : "…", "total supply"]
          ] : [
            ["Locked", fmtWei(amt.toString(), tok?.decimals ?? 18), tok ? `$${tok.symbol}` : ""],
            ["Of supply", tok ? `${supplyPct.toFixed(2)}%` : "…", "total supply"],
            ["Unlocks", new Date(unlockAt).toLocaleDateString(), unlocked ? "unlocked" : timeLeft(rec.unlockTs)],
            ["Locked since", new Date(created).toLocaleDateString(), ""]
          ] as [string, string, string][]).map(([l, v, s]) => (
            <div key={l} className="rounded-xl border border-white/[0.06] bg-black/20 px-3.5 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/50">{l}</p>
              <p className="mt-1 truncate font-mono text-lg font-bold">{v}</p>
              <p className="truncate text-[11px] text-white/50">{s}</p>
            </div>
          ))}
        </div>

        {/* time progress */}
        {rec.state === "LOCKED" ? (
          <div className="mt-5">
            <div className="mb-1.5 flex justify-between text-[11px] text-white/55">
              <span>{isVest ? `Vesting starts ${fmtDate(rec.startMs)}` : `Locked ${fmtDate(rec.createdTs)}`}</span>
              <span className={cn(unlocked ? "text-emerald-300" : "")}><Clock className="mr-1 inline h-3 w-3" />
                {isVest ? (now >= endMs ? "fully vested" : `fully vested ${fmtDate(rec.endMs)}`) : unlocked ? "unlocked · owner can withdraw" : `${timeLeft(rec.unlockTs)} · ${fmtDate(rec.unlockTs)}`}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
              <div className="h-full rounded-full bg-gradient-to-r from-chrome-400 to-white transition-[width] duration-700" style={{ width: `${timeProgress}%` }} />
            </div>
          </div>
        ) : null}
      </Panel>

      <div className="grid gap-4 md:grid-cols-2">
        {/* ── lock details ─────────────────────────────────────────────── */}
        <Panel className="p-5">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/55">Lock details</p>
          <Row label="Lock ID"><span className="font-mono">#{id}</span></Row>
          <Row label="Type">{KIND_LABEL[rec.kind]}</Row>
          <Row label="Status"><span className="capitalize">{rec.state.toLowerCase()}</span></Row>
          <Row label={rec.kind === "VESTM" ? "Creator" : "Owner"}><AddrLink hex={rec.owner} you={me === rec.owner} /></Row>
          <Row label="Created">{fmtDate(rec.createdTs)}</Row>
          {isVest ? (
            <>
              <Row label="Vesting start">{fmtDate(rec.startMs)}</Row>
              <Row label="Fully vested">{fmtDate(rec.endMs)}</Row>
              <Row label="Still locked"><span className="font-mono">{fmtWei(stillLockedVest.toString(), tok?.decimals ?? 18)}</span></Row>
            </>
          ) : (
            <Row label="Unlock date">{fmtDate(rec.unlockTs)}<span className={cn("block text-[11px]", unlocked ? "text-emerald-300" : "text-white/45")}>{unlocked ? "unlocked" : timeLeft(rec.unlockTs)}</span></Row>
          )}
        </Panel>

        {/* ── asset ────────────────────────────────────────────────────── */}
        <Panel className="p-5">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/55">{isLp ? "Pool" : "Token"}</p>
          {isLp ? (
            <>
              <Row label="Pair">{pairLabel}</Row>
              <Row label="Pool"><a href={siteHref(`/asedex/terminal/asedex/${rec.poolId}`)} className="inline-flex items-center gap-1 text-white/85 transition hover:text-white">AseDex #{rec.poolId}<ExternalLink className="h-3 w-3 text-white/40" /></a></Row>
              <Row label="Locked share">{p ? `${lpPct.toFixed(4)}% of ${fmtWei(p.totalShares.toString(), 18)} shares` : "…"}</Row>
              {base && base.address !== NATIVE ? <Row label={base.symbol}><AddrLink hex={base.address} /></Row> : null}
              {quote && quote.address !== NATIVE ? <Row label={quote.symbol}><AddrLink hex={quote.address} /></Row> : null}
            </>
          ) : (
            <>
              <Row label="Token">{tok ? `${tok.name || tok.symbol} ($${tok.symbol})` : "…"}</Row>
              <Row label="Contract">{rec.token ? <AddrLink hex={rec.token} /> : "-"}</Row>
              <Row label="Total supply">{tok ? fmtWei(tok.totalSupply.toString(), tok.decimals) : "…"}</Row>
              <Row label="Locked">{fmtWei(amt.toString(), tok?.decimals ?? 18)} <span className="text-white/50">({supplyPct.toFixed(2)}%)</span></Row>
            </>
          )}
          <Row label="Lock contract"><AddrLink hex={LOCK} /></Row>
        </Panel>
      </div>

      {/* ── beneficiaries — every wallet's allocation, vested, claimable,
          claimed and remaining, each with its own countdown card. Single-vest
          locks render the owner as the sole beneficiary. ─────────────────── */}
      {isVest ? (() => {
        const benes: Bene[] = rec.kind === "VESTM"
          ? (rec.benes ?? [])
          : [{ addr: rec.owner, wei: rec.amt, claimed: rec.claimedWei ?? "0" }];
        if (!benes.length) return null;
        const dec = tok?.decimals ?? 18;
        const started = now >= startMs, done = now >= endMs;
        return (
          <Panel className="overflow-hidden">
            <p className="flex items-center gap-1.5 border-b border-white/[0.07] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-white/55">
              <Users className="h-3.5 w-3.5" />{benes.length > 1 ? `Beneficiaries (${benes.length})` : "Beneficiary"}
            </p>
            <div className="grid gap-3 p-4 md:grid-cols-2">
              {benes.map((b) => {
                const w = safeBig(b.wei), v = vestedAt(w, startMs, endMs, now), c = safeBig(b.claimed);
                const claimable = v > c ? v - c : 0n;
                const left = w > v ? w - v : 0n;
                const pv = w > 0n ? Number((v * 10000n) / w) / 100 : 0;
                return (
                  <div key={b.addr} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <AddrLink hex={b.addr} you={me === b.addr} />
                      <span className="font-mono text-xs font-semibold text-white/85">{fmtWei(b.wei, dec)} <span className="text-white/45">${tok?.symbol ?? ""}</span></span>
                    </div>
                    <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                      <div className={cn("h-full rounded-full transition-[width] duration-700", pv >= 100 ? "bg-emerald-400" : "bg-gradient-to-r from-chrome-400 to-white")} style={{ width: `${pv}%` }} />
                    </div>
                    <p className={cn("mt-1.5 text-xs font-medium", done ? "text-emerald-300" : "text-white/75")}>
                      {!started
                        ? `starts in ${timeLeft(String(startMs)).replace(/ left$/, "")} · ${fmtDate(rec.startMs)}`
                        : done
                          ? "100% vested"
                          : `${pv.toFixed(1)}% vested · fully in ${timeLeft(String(endMs)).replace(/ left$/, "")}`}
                    </p>
                    {/* Linear vesting unlocks continuously — surface it as a
                        daily unlock rate + the next quarter milestone so the
                        "upcoming unlock" is a real date, not a guess. */}
                    {started && !done && endMs > startMs ? (() => {
                      const perDay = (w * 86400000n) / BigInt(Math.max(1, endMs - startMs));
                      const nextQ = [0.25, 0.5, 0.75, 1].find((q) => now < startMs + (endMs - startMs) * q)!;
                      const qTs = Math.floor(startMs + (endMs - startMs) * nextQ);
                      const qAmt = safeBig((Number(b.wei) * nextQ).toFixed(0)) - c;
                      return (
                        <p className="mt-0.5 text-[11px] font-medium text-white/65">
                          ≈{fmtWei(perDay.toString(), dec)}/day unlocking
                          {qAmt > 0n ? ` · next ${fmtWei(qAmt.toString(), dec)} @ ${Math.round(nextQ * 100)}% · ${timeLeft(String(qTs)).replace(/ left$/, "")}` : ""}
                        </p>
                      );
                    })() : null}
                    <div className="mt-2.5 grid grid-cols-3 gap-1.5 text-center">
                      {([
                        ["Claimable", fmtWei(claimable.toString(), dec), claimable > 0n ? "text-emerald-300" : "text-white/85"],
                        ["Claimed", fmtWei(c.toString(), dec), "text-white/85"],
                        ["Locked", fmtWei(left.toString(), dec), "text-white/85"]
                      ] as [string, string, string][]).map(([l, v2, cls]) => (
                        <div key={l} className="rounded-lg bg-white/[0.05] px-1.5 py-2">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-white/55">{l}</p>
                          <p className={cn("mt-0.5 truncate font-mono text-xs font-bold", cls)}>{v2}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        );
      })() : null}

      {/* ── trust note ─────────────────────────────────────────────────── */}
      <Panel className="flex items-start gap-3 p-4">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
        <p className="text-xs leading-relaxed text-white/60">
          {rec.state === "LOCKED"
            ? isVest
              ? "These tokens are held by the AseLock contract and release linearly to the beneficiaries. Nobody (including the creator) can withdraw them early."
              : `These ${isLp ? "LP shares" : "tokens"} are held by the AseLock contract. Only the owner can withdraw them, and only after the unlock date. Nobody can pull them early.`
            : rec.state === "BURNED" ? "This lock was burned. The assets were destroyed permanently."
            : "This lock has been released to its owner."}
          {" "}Anyone can verify this lock on-chain.
        </p>
      </Panel>

      {mine && rec.state === "LOCKED" ? (
        <p className="text-center text-xs text-white/55">
          You {rec.owner === me ? "own" : "are a beneficiary of"} this lock. Manage it from <a href="/" className="text-white/85 underline-offset-2 hover:underline">My locks</a>.
        </p>
      ) : null}
    </div>
  );
}
