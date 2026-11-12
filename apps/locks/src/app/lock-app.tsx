"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LiveIndicator } from "@/components/live/live-chain";
import { useWalletStore } from "@/stores/wallet";
import { sendWalletCall, requireWalletTxMined, viewContract, viewContractBatch } from "@/lib/asentum-wallet";
import { apiPool, apiResolveBatch, UNIFIED_API } from "@/lib/ase-api";
import { safeBig, shortenAddress } from "@/lib/asepad";
import { toHexAddress, toAseAddress } from "@asentrise/utils";
import { explorerAddressUrl } from "@/lib/explorer";
import { cn } from "@/lib/cn";
import {
  ChevronLeft, ChevronRight, Clock, ExternalLink, Flame, Image as ImageIcon, Loader2, Lock as LockIcon, LockOpen, Search, Send,
  Settings2, ShieldCheck, TimerReset, Wallet as WalletIcon, X
} from "lucide-react";

import {
  LOCK, LOCK_V2, DEX, NATIVE, KIND_LABEL, KIND_CLS, STATE_CLS, Panel,
  asJson, fetchMyLocks, fmtDate, fmtWei, locksFromApi, normToken, timeLeft, toWeiStr,
  type LockRec, type LockRow, type PoolMeta, type TokenMeta
} from "@/lib/lock-shared";

export function LockApp() {
  const wallet = useWalletStore();
  const qc = useQueryClient();
  const ownerHex = wallet.status === "connected" && wallet.address ? toHexAddress(wallet.address).toLowerCase() : undefined;
  const [tab, setTab] = useState<"create" | "all" | "mine">("all");
  const [kindFilter, setKindFilter] = useState<"all" | "TOKEN" | "VEST" | "LP" | "UNLOCKED">("all");
  const [lockQ, setLockQ] = useState("");
  const [kind, setKind] = useState<"LP" | "TOKEN" | "VEST" | "NFT">("LP");
  // One status at a time, scoped to where it was triggered ("create" form or
  // "row:<id>") so progress + results render next to that button, not up top.
  const [status, setStatus] = useState<{ scope: string; kind: "busy" | "ok" | "err"; text: string } | null>(null);
  const busy = status?.kind === "busy" ? status.text : null;
  const busyIn = (scope: string) => (status?.kind === "busy" && status.scope === scope ? status.text : null);
  const setErr = (text: string | null, scope = "create") => setStatus(text ? { scope, kind: "err", text } : null);

  // create form state
  const [poolId, setPoolId] = useState("");
  const [lpAmt, setLpAmt] = useState("");
  const [token, setToken] = useState("");
  const [tokAmt, setTokAmt] = useState("");
  const [unlockAt, setUnlockAt] = useState("");
  const [vestStart, setVestStart] = useState("");
  const [vestEnd, setVestEnd] = useState("");
  const [multi, setMulti] = useState(false);
  const [benesText, setBenesText] = useState("");
  // LP lock dex — v2 lock's `dex` arg must match the pool's venue.
  const LP_DEXES = [["AseDex", DEX], ["AurasDex v1", "0x63f640a9b98b6f28e06cb5cc0fce5d72b6c0eabd"], ["AurasDex v2", "0xcc1c9029cfe92004bca76c013cef2fdaa75351a2"]] as const;
  const [lpDex, setLpDex] = useState<string>(DEX);
  const [nftCollection, setNftCollection] = useState("");
  const [nftIds, setNftIds] = useState("");
  const [actAmt, setActAmt] = useState("");
  const [actTs, setActTs] = useState("");

  const tokenHex = token.trim() ? normToken(token) : null;

  // ── all locks: server-paged (10/page). kind/search/ended filtering happens
  // in SQL — the page in RAM is exactly what the user sees.
  const LOCK_PAGE = 10;
  const [lockPage, setLockPage] = useState(1);
  const [qDeb, setQDeb] = useState("");
  useEffect(() => { const t = setTimeout(() => setQDeb(lockQ.trim()), 300); return () => clearTimeout(t); }, [lockQ]);
  useEffect(() => { setLockPage(1); }, [kindFilter, qDeb, tab]);
  const allLocks = useQuery({
    queryKey: ["aselock-all", lockPage, kindFilter, qDeb],
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
    queryFn: async (): Promise<{ rows: LockRow[]; total: number }> => {
      const p = new URLSearchParams({ limit: String(LOCK_PAGE), offset: String((lockPage - 1) * LOCK_PAGE) });
      if (kindFilter === "UNLOCKED") p.set("ended", "1");
      else if (kindFilter !== "all") p.set("kind", kindFilter);
      if (qDeb) p.set("q", qDeb);
      const d = await fetch(`${UNIFIED_API}/api/locks?${p}`).then((r) => (r.ok ? r.json() : null)).catch(() => null) as
        { locks?: { lock_id: string; raw_json: string | null }[]; total?: number } | null;
      return { rows: locksFromApi(d?.locks), total: Number(d?.total ?? 0) };
    }
  });
  // Counts for the stats strip + filter badges — aggregate endpoint, no full table.
  const lockSummary = useQuery({
    queryKey: ["aselock-summary"],
    refetchInterval: 30_000,
    queryFn: async () => fetch(`${UNIFIED_API}/api/locks?summary=1`).then((r) => (r.ok ? r.json() : null)).catch(() => null) as
      Promise<{ total: number; byKind: Record<string, number>; active: number; ended: number } | null>
  });

  const myLocks = useQuery({
    queryKey: ["aselock-mine", ownerHex],
    enabled: Boolean(ownerHex),
    queryFn: async (): Promise<LockRow[]> => {
      // AWS-first: /api/locks?wallet serves v1+v2 rows with raw_json — zero
      // chain reads. Only when the API itself is unreachable do we fall back
      // to locksOf + getLock.
      // AWS-only: /api/locks?wallet serves v1+v2 rows with raw_json. When the
      // API is unreachable we keep the last painted rows — never fall back to
      // a locksOf + getLock chain sweep on a display path.
      const fromApi = await fetchMyLocks(ownerHex!);
      return fromApi ?? myLocks.data ?? [];
    },
    refetchInterval: 20_000
  });

  // ── enrichment: token meta + pool pairs ────────────────────────────────────
  const listRows = tab === "mine" ? (myLocks.data ?? []) : (allLocks.data?.rows ?? []);
  const tokenAddrs = useMemo(() => {
    const s = new Set<string>();
    for (const r of listRows) if (r.rec.token) s.add(r.rec.token);
    if (tokenHex) s.add(tokenHex);
    return [...s];
  }, [listRows, tokenHex]);
  const poolIds = useMemo(() => {
    const s = new Set<string>();
    for (const r of listRows) if (r.rec.poolId) s.add(r.rec.poolId);
    if (/^\d+$/.test(poolId.trim())) s.add(poolId.trim());
    return [...s];
  }, [listRows, poolId]);

  const tokenMeta = useQuery({
    queryKey: ["aselock-tokenmeta", tokenAddrs.sort().join(",")],
    enabled: tokenAddrs.length > 0,
    queryFn: async (): Promise<Record<string, TokenMeta>> => {
      // AWS resolve per token — symbol/decimals in one bound call each. Only
      // tokens the indexer doesn't know fall back to the chain batch.
      const out: Record<string, TokenMeta> = {};
      const resolves = (await apiResolveBatch(tokenAddrs).catch(() => null))?.resolves ?? {};
      tokenAddrs.forEach((a) => {
        const t = resolves[a]?.token;
        if (t && (t.symbol || t.name)) {
          out[a] = { symbol: String(t.symbol ?? t.name ?? "?").trim().slice(0, 16) || "?", decimals: Number(t.decimals ?? 18) || 18 };
        }
      });
      // No chain fallback — unindexed tokens keep the "?" placeholder until
      // the indexer catches up. Display paths never read the chain.
      return out;
    },
    staleTime: 300_000
  });
  const poolMeta = useQuery({
    queryKey: ["aselock-poolmeta", poolIds.sort().join(",")],
    enabled: poolIds.length > 0 && Boolean(DEX),
    queryFn: async (): Promise<Record<string, PoolMeta>> => {
      // AWS pool row per id — token0/token1 straight from the indexer.
      const out: Record<string, PoolMeta> = {};
      await Promise.all(poolIds.map(async (id) => {
        const d = await apiPool(DEX, id).catch(() => null);
        const p = d?.pool;
        if (p?.token0) out[id] = { token0: String(p.token0), token1: String(p.token1) };
      }));
      // No getPool chain fallback — a pool the API doesn't know yet paints as
      // "Pool #id" until the indexer indexes it.
      return out;
    },
    staleTime: 60_000
  });
  // pool pair token symbols (depends on poolMeta)
  const pairTokens = useMemo(() => {
    const s = new Set<string>();
    for (const p of Object.values(poolMeta.data ?? {})) { s.add(p.token0.toLowerCase()); s.add(p.token1.toLowerCase()); }
    s.delete(NATIVE);
    return [...s];
  }, [poolMeta.data]);
  const pairMeta = useQuery({
    queryKey: ["aselock-pairmeta", pairTokens.sort().join(",")],
    enabled: pairTokens.length > 0,
    queryFn: async (): Promise<Record<string, TokenMeta>> => {
      const out: Record<string, TokenMeta> = {};
      const resolves = (await apiResolveBatch(pairTokens).catch(() => null))?.resolves ?? {};
      pairTokens.filter((a) => {
        const t = resolves[a]?.token;
        if (t && (t.symbol || t.name)) {
          out[a] = { symbol: String(t.symbol ?? t.name ?? "?").trim().slice(0, 16) || "?", decimals: Number(t.decimals ?? 18) || 18 };
          return false;
        }
        return true;
      });
      return out;
    },
    staleTime: 300_000
  });
  const pairLabel = (pid?: string) => {
    if (!pid) return "-";
    const p = poolMeta.data?.[pid];
    if (!p) return `Pool #${pid}`;
    const s = (a: string) => a.toLowerCase() === NATIVE ? "ASE" : (pairMeta.data?.[a.toLowerCase()]?.symbol ?? shortenAddress(a, 4, 3));
    return `${s(p.token0)}/${s(p.token1)} · Pool #${pid}`;
  };

  // LP form helpers: user's share balance + lock-contract allowance on the pool
  const poolIdOk = /^\d+$/.test(poolId.trim());
  const lpPool = poolIdOk ? poolId.trim() : "";
  const lpInfo = useQuery({
    queryKey: ["aselock-lp", lpPool, lpDex, ownerHex],
    enabled: Boolean(lpPool && ownerHex && lpDex),
    queryFn: async () => {
      const [bal, allow, pool] = await viewContractBatch<string>([
        { to: lpDex, method: "sharesOf", args: [lpPool, ownerHex] },
        { to: lpDex, method: "shareAllowance", args: [lpPool, ownerHex, LOCK_V2] },
        { to: lpDex, method: "getPool", args: [lpPool] }
      ]);
      let exists = false;
      exists = Boolean(asJson(pool)?.token0);
      return { bal: safeBig(bal || "0"), allow: safeBig(allow || "0"), exists };
    },
    refetchInterval: 15_000
  });

  // token form helpers
  const tokInfo = useQuery({
    queryKey: ["aselock-tok", tokenHex, ownerHex],
    enabled: Boolean(tokenHex && ownerHex),
    queryFn: async () => {
      const [bal, allow] = await viewContractBatch<string>([
        { to: tokenHex!, method: "balanceOf", args: [ownerHex] },
        { to: tokenHex!, method: "allowance", args: [ownerHex, LOCK_V2] }
      ]);
      return { bal: safeBig(bal || "0"), allow: safeBig(allow || "0") };
    },
    refetchInterval: 15_000
  });
  const tokDec = tokenHex ? (tokenMeta.data?.[tokenHex]?.decimals ?? 18) : 18;
  const tokSym = tokenHex ? (tokenMeta.data?.[tokenHex]?.symbol ?? "token") : "token";

  // vesting claimable — every lock where this wallet is the owner or a
  // beneficiary (bene-only locks live under All locks, not My locks)
  const myVestIds = (myLocks.data ?? []).filter((r) => (r.rec.kind === "VEST" || r.rec.kind === "VESTM") && r.rec.state === "LOCKED"
    && (r.rec.owner === ownerHex || r.rec.benes?.some((b) => b.addr === ownerHex)));
  // Claimable is pure clock math on the lock record the API already served —
  // vested(schedule) minus claimed. Zero RPC: the 30s now-tick keeps it fresh.
  const [vestNow, setVestNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setVestNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const vestInfo = useMemo(() => {
    const out: Record<string, string> = {};
    const vestedAt = (wei: string, s?: string, e?: string) => {
      const start = Number(s ?? 0), end = Number(e ?? 0), w = safeBig(wei);
      if (!end || end <= start) return 0n;
      return vestNow <= start ? 0n : vestNow >= end ? w : (w * BigInt(Math.floor(vestNow - start))) / BigInt(Math.floor(end - start));
    };
    for (const r of myVestIds) {
      try {
        if (Array.isArray(r.rec.benes) && r.rec.benes.length) {
          const me = r.rec.benes.find((b) => b.addr === ownerHex);
          if (me) {
            const claimable = vestedAt(me.wei, r.rec.startMs, r.rec.endMs) - safeBig(me.claimed);
            if (claimable > 0n) out[r.id] = claimable.toString();
          }
        } else {
          const claimable = vestedAt(r.rec.amt, r.rec.startMs, r.rec.endMs) - safeBig(r.rec.claimedWei);
          if (claimable > 0n) out[r.id] = claimable.toString();
        }
      } catch { }
    }
    return out;
  }, [myVestIds, ownerHex, vestNow]);

  // Query keys are "aselock-all", "aselock-mine", … — match the prefix.
  const refresh = () => { void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").startsWith("aselock") }); };
  // `tx(label, call)` = wallet prompt → on-chain confirm, with the button text
  // tracking each stage. Returns the mined hash.
  const run = async (scope: string, label: string, fn: (tx: (stage: string, call: () => Promise<string>) => Promise<string>) => Promise<unknown>) => {
    const step = (text: string) => setStatus({ scope, kind: "busy", text });
    const tx = async (stage: string, call: () => Promise<string>) => {
      step(`Confirm ${stage} in wallet…`);
      const hash = await call();
      step(`${stage[0]!.toUpperCase()}${stage.slice(1)} · confirming…`);
      await requireWalletTxMined(hash, stage);
      return hash;
    };
    try {
      await fn(tx);
      setStatus({ scope, kind: "ok", text: `${label} confirmed` });
      refresh();
      return true;
    } catch (e) {
      setStatus({ scope, kind: "err", text: e instanceof Error ? e.message : String(e) });
      return false;
    }
  };
  // Newest lock id owned by this wallet — used to open the lock page right
  // after creating it.
  const newestLockId = async () => {
    const ids = ((asJson(await viewContract<unknown>(LOCK_V2, "locksOf", [ownerHex])) ?? []) as unknown[]).map((x) => Number(x)).filter((n) => n > 0);
    return ids.length ? Math.max(...ids) : null;
  };
  const afterCreate = async (ok: boolean) => {
    if (!ok) return;
    setStatus({ scope: "create", kind: "busy", text: "Lock created. Opening…" });
    const id = await newestLockId().catch(() => null);
    if (id) window.location.href = `/lock/${id}`;
    else setStatus({ scope: "create", kind: "ok", text: "Lock created. Find it under My locks" });
  };

  // ── create actions ─────────────────────────────────────────────────────────
  const lpAmtWei = toWeiStr(lpAmt, 18);
  const unlockMs = unlockAt ? new Date(unlockAt).getTime() : 0;
  const lpValid = lpPool && lpAmtWei && safeBig(lpAmtWei) > 0n && unlockMs > Date.now();
  const lpNeedApprove = lpValid && safeBig(lpAmtWei) > (lpInfo.data?.allow ?? 0n);

  const tokAmtWei = toWeiStr(tokAmt, tokDec);
  const tokValid = tokenHex && tokAmtWei && safeBig(tokAmtWei) > 0n && unlockMs > Date.now();
  const tokNeedApprove = tokValid && safeBig(tokAmtWei) > (tokInfo.data?.allow ?? 0n);

  const vestS = vestStart ? new Date(vestStart).getTime() : 0;
  const vestE = vestEnd ? new Date(vestEnd).getTime() : 0;
  const parsedBenes = useMemo(() => {
    if (!multi) return null;
    const out: [string, string][] = [];
    for (const line of benesText.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      const [a, w] = t.split(/[,\s]+/).map((x) => x.trim());
      const hex = a ? normToken(a) : null;
      const wei = w ? toWeiStr(w, tokDec) : null;
      if (!hex || !wei || safeBig(wei) <= 0n) return { bad: t } as const;
      out.push([hex, wei]);
    }
    return out.length ? out : null;
  }, [multi, benesText, tokDec]);
  const beneRows: [string, string][] | null = parsedBenes && !("bad" in parsedBenes) ? parsedBenes : null;
  const vestTotalWei = multi
    ? (beneRows ? beneRows.reduce((s, b) => s + safeBig(b[1]), 0n).toString() : null)
    : tokAmtWei;
  const vestValid = tokenHex && vestTotalWei && safeBig(vestTotalWei) > 0n && vestE > vestS && vestS > 0 && (!multi || Boolean(beneRows));
  const vestNeedApprove = vestValid && safeBig(vestTotalWei) > (tokInfo.data?.allow ?? 0n);

  // All new locks deploy to v2 — v1 rows stay watch/claim only.
  const lockLp = async () => afterCreate(await run("create", "Lock LP", async (tx) => {
    if (lpNeedApprove) await tx("LP approval", () => sendWalletCall({ to: lpDex, method: "approveShares", args: [lpPool, LOCK_V2, lpAmtWei] }));
    await tx("lock", () => sendWalletCall({ to: LOCK_V2, method: "lock", args: [lpPool, lpAmtWei, String(unlockMs), lpDex] }));
  }));
  const lockTok = async () => afterCreate(await run("create", "Lock tokens", async (tx) => {
    if (tokNeedApprove) await tx(`${tokSym} approval`, () => sendWalletCall({ to: tokenHex!, method: "approve", args: [LOCK_V2, tokAmtWei] }));
    await tx("lock", () => sendWalletCall({ to: LOCK_V2, method: "lockToken", args: [tokenHex, tokAmtWei, String(unlockMs)] }));
  }));
  const lockVest = async () => afterCreate(await run("create", "Create vesting", async (tx) => {
    if (vestNeedApprove) await tx(`${tokSym} approval`, () => sendWalletCall({ to: tokenHex!, method: "approve", args: [LOCK_V2, vestTotalWei] }));
    await tx("vesting lock", () => multi && beneRows
      ? sendWalletCall({ to: LOCK_V2, method: "lockVestingMulti", args: [tokenHex, JSON.stringify(beneRows), String(vestS), String(vestE)] })
      : sendWalletCall({ to: LOCK_V2, method: "lockVesting", args: [tokenHex, tokAmtWei, String(vestS), String(vestE)] }));
  }));
  // v2-only: NFT escrow (collection + comma token ids + unlock date).
  const lockNft = async () => afterCreate(await run("create", "Lock NFTs", async (tx) => {
    const ids = nftIds.split(/[,\s]+/).map((x) => x.trim()).filter((x) => /^\d+$/.test(x));
    if (!nftCollection || !ids.length) throw new Error("collection address + token ids required");
    await tx("NFT approval", () => sendWalletCall({ to: nftCollection, method: "setApprovalForAll", args: [LOCK_V2, "1"] }));
    await tx("lock", () => sendWalletCall({ to: LOCK_V2, method: "lockNFT", args: [nftCollection, ids.join(","), String(unlockMs)] }));
  }));

  // ── lock row actions ───────────────────────────────────────────────────────
  const rowScope = (r: LockRow) => `row:${r.lock}:${r.id}`;
  const ofRow = (r: LockRow) => r.lock ?? LOCK;
  const unlock = (r: LockRow) => run(rowScope(r), `Unlock #${r.id}`, (tx) => tx("unlock", () => sendWalletCall({ to: ofRow(r), method: "unlock", args: [r.id] })));
  const burnLock = (r: LockRow) => run(rowScope(r), `Burn lock #${r.id}`, (tx) => tx("burn", () => sendWalletCall({ to: ofRow(r), method: "burn", args: [r.id] })));
  const claim = (r: LockRow) => run(rowScope(r), `Claim #${r.id}`, (tx) => tx("claim", () => sendWalletCall({ to: ofRow(r), method: "claimVested", args: [r.id] })));
  const transfer = (r: LockRow, t: string) => run(rowScope(r), `Transfer lock #${r.id}`, (tx) => tx("transfer", () =>
    sendWalletCall({ to: ofRow(r), method: r.rec.kind === "VESTM" ? "transferBeni" : "transferLock", args: [r.id, t] })));
  // v2 extras — extend / relock / top-up / migrate (shown only on v2 rows).
  const extendLock = (r: LockRow, newTs: number) => run(rowScope(r), `Extend #${r.id}`, (tx) => tx("extend", () => sendWalletCall({ to: ofRow(r), method: "extendLock", args: [r.id, String(newTs)] })));
  const relock = (r: LockRow, newTs: number) => run(rowScope(r), `Relock #${r.id}`, (tx) => tx("relock", () => sendWalletCall({ to: ofRow(r), method: "relock", args: [r.id, String(newTs)] })));
  const addToLock = (r: LockRow, amtWei: string) => run(rowScope(r), `Add to #${r.id}`, (tx) => tx("top up", () => sendWalletCall({ to: ofRow(r), method: "addToLock", args: [r.id, amtWei] })));
  const migrateLock = (r: LockRow, target: string) => run(rowScope(r), `Migrate #${r.id}`, (tx) => tx("migrate", () => sendWalletCall({ to: ofRow(r), method: "migrateLock", args: [r.id, target] })));
  // Transfer + burn are irreversible — the row's Manage button opens a modal:
  // first an option picker, then a guided step (address input / warning)
  // before the tx fires from the modal's Confirm.
  const [confirm, setConfirm] = useState<{ type: "menu" | "transfer" | "burn" | "extend" | "relock" | "topup" | "migrate"; row: LockRow; to?: string } | null>(null);
  const [manageErr, setManageErr] = useState<string | null>(null);
  const openManage = (r: LockRow) => { setStatus(null); setManageErr(null); setConfirm({ type: "menu", row: r }); };
  const closeManage = () => { setConfirm(null); setManageErr(null); };
  const doConfirm = () => {
    if (!confirm || confirm.type === "menu") return;
    const c = confirm;
    if (c.type === "transfer") {
      const t = normToken(c.to ?? "");
      if (!t) { setManageErr("Enter a valid ase1… or 0x… destination address"); return; }
      const from = c.row.rec.kind === "VESTM" ? ownerHex : c.row.rec.owner;
      if (t === from) { setManageErr("Destination is the current owner"); return; }
      closeManage();
      void transfer(c.row, t);
    } else if (c.type === "extend" || c.type === "relock") {
      const ts = c.to ? new Date(c.to).getTime() : 0;
      if (!ts || ts <= Date.now()) { setManageErr("Pick a future unlock date"); return; }
      closeManage();
      void (c.type === "extend" ? extendLock(c.row, ts) : relock(c.row, ts));
    } else if (c.type === "topup") {
      const dec = c.row.rec.token ? (tokenMeta.data?.[c.row.rec.token]?.decimals ?? 18) : 18;
      const w = toWeiStr(c.to ?? "", dec);
      if (!w || safeBig(w) <= 0n) { setManageErr("Enter an amount to add"); return; }
      closeManage();
      void addToLock(c.row, w);
    } else if (c.type === "migrate") {
      const t = normToken(c.to ?? "");
      if (!t) { setManageErr("Enter the target lock contract address"); return; }
      closeManage();
      void migrateLock(c.row, t);
    } else {
      closeManage();
      void burnLock(c.row);
    }
  };
  // Inline status line under the button/row that triggered it.
  const StatusLine = ({ scope, className }: { scope: string; className?: string }) =>
    status && status.scope === scope && status.kind !== "busy" ? (
      <p className={cn("rounded-lg border px-3 py-2 text-xs",
        status.kind === "err" ? "border-red-500/30 bg-red-500/10 text-red-200" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200", className)}>
        {status.text}
      </p>
    ) : null;

  const assetLabel = (r: LockRow): { main: string; sub: string } => {
    const k = r.rec.kind;
    if (k === "LP") return { main: pairLabel(r.rec.poolId), sub: `${fmtWei(r.rec.amt, 18)} LP shares` };
    const sym = r.rec.token ? (tokenMeta.data?.[r.rec.token]?.symbol ?? shortenAddress(r.rec.token, 4, 3)) : "?";
    const dec = r.rec.token ? (tokenMeta.data?.[r.rec.token]?.decimals ?? 18) : 18;
    if (k === "TOKEN") return { main: `${fmtWei(r.rec.amt, dec)} $${sym}`, sub: shortenAddress(r.rec.token ?? "") };
    const claimed = r.rec.kind === "VEST" ? safeBig(r.rec.claimedWei || "0") : (r.rec.benes ?? []).reduce((s, b) => s + safeBig(b.claimed), 0n);
    return { main: `${fmtWei(r.rec.amt, dec)} $${sym}`, sub: claimed > 0n ? `vesting · ${fmtWei(claimed.toString(), dec)} claimed` : "vesting schedule" };
  };

  const LockRowView = ({ r, manage }: { r: LockRow; manage: boolean }) => {
    const mine = ownerHex && r.rec.owner === ownerHex;
    const a = assetLabel(r);
    const isVest = r.rec.kind === "VEST" || r.rec.kind === "VESTM";
    const unlockable = !isVest && r.rec.state === "LOCKED" && mine && Number(r.rec.unlockTs ?? 0) <= Date.now();
    const claimable = isVest && r.rec.state === "LOCKED" && safeBig(vestInfo[r.id] || "0") > 0n;
    const isBene = Boolean(ownerHex && r.rec.benes?.some((b) => b.addr === ownerHex));
    // Owner management (unlock / transfer / burn) lives in My locks. A
    // beneficiary who isn't the owner only ever sees the lock in All locks,
    // so their claim + slot-transfer stay available there.
    const isBeneOnly = Boolean(isBene && !mine);
    const canAct = r.rec.state === "LOCKED" && (manage ? Boolean(mine || isBeneOnly) : isBeneOnly);
    const canTransfer = r.rec.state === "LOCKED" && ((manage && mine && !isVest) || (r.rec.kind === "VESTM" && isBene));
    const canBurnLock = r.rec.state === "LOCKED" && manage && mine && r.rec.kind === "LP";
    return (
      <div
        role="link"
        tabIndex={0}
        // Whole row opens /lock/<id>; buttons, inputs and links inside keep
        // their own behaviour. Full navigation: only the "_" shell is prebuilt.
        onClick={(e) => { if (!(e.target as HTMLElement).closest("button,a,input,textarea")) window.location.href = r.lock === LOCK_V2 ? `/lock/v2/${r.id}` : `/lock/${r.id}`; }}
        onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) window.location.href = r.lock === LOCK_V2 ? `/lock/v2/${r.id}` : `/lock/${r.id}`; }}
        // Mobile: stacked card — asset row, then owner | state, unlock date,
        // actions full width. md+: one table row.
        className="grid cursor-pointer grid-cols-2 items-center gap-x-3 gap-y-2 border-b border-white/[0.04] px-3 py-3 text-sm transition hover:bg-white/[0.03] sm:px-4 md:grid-cols-[1.2fr_1fr_1fr_0.9fr_auto] md:gap-y-0">
        <div className="col-span-2 min-w-0 md:col-span-1">
          <p className="flex min-w-0 items-center gap-1.5">
            <span className={cn("shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide", KIND_CLS[r.rec.kind])}>{KIND_LABEL[r.rec.kind]}</span>
            <span className="truncate font-semibold text-white/90">{a.main}</span>
          </p>
          <p className="mt-0.5 truncate font-mono text-[10px] text-white/45">{a.sub} · lock #{r.id}{r.lock === LOCK_V2 ? " · v2" : ""}</p>
        </div>
        <div className="min-w-0 font-mono text-[11px] text-white/60">
          <a href={explorerAddressUrl(r.rec.owner)} target="_blank" rel="noreferrer" className="transition hover:text-white">
            {shortenAddress(toAseAddress(r.rec.owner), 8, 5)}
          </a>
          {mine ? <span className="ml-1 rounded bg-white/10 px-1 text-[9px] font-sans font-bold text-white/80">you</span> : null}
          <p className="mt-0.5 text-[10px] text-white/40">created {fmtDate(r.rec.createdTs)}</p>
        </div>
        <div className="col-span-2 font-mono text-[11px] text-white/60 max-md:flex max-md:flex-wrap max-md:items-center max-md:gap-x-2 md:col-span-1">
          {isVest ? (
            (() => {
              const s = Number(r.rec.startMs ?? 0), e = Number(r.rec.endMs ?? 0), now = Date.now();
              const pctV = s > 0 && e > s ? Math.min(100, Math.max(0, ((now - s) / (e - s)) * 100)) : 0;
              const dec = r.rec.token ? (tokenMeta.data?.[r.rec.token]?.decimals ?? 18) : 18;
              const perDay = e > s && now >= s && now < e ? (safeBig(r.rec.amt) * 86400000n) / BigInt(e - s) : 0n;
              return (
                <div className="min-w-0">
                  <p className="text-white/70">{fmtDate(r.rec.startMs)} <span className="text-white/40">→ {fmtDate(r.rec.endMs)}</span></p>
                  <div className="mt-1 h-1 w-28 max-w-full overflow-hidden rounded-full bg-white/[0.08]">
                    <div className={cn("h-full rounded-full", pctV >= 100 ? "bg-emerald-400" : "bg-sky-400/80")} style={{ width: `${pctV}%` }} />
                  </div>
                  <p className={cn("mt-0.5 text-[11px] font-medium", pctV >= 100 ? "text-emerald-300" : "text-white/60")}>
                    {now < s
                      ? `starts in ${timeLeft(String(s)).replace(/ left$/, "")}`
                      : pctV >= 100
                        ? "100% vested"
                        : `${pctV.toFixed(1)}% vested · ≈${fmtWei(perDay.toString(), dec)}/day · full in ${timeLeft(String(e)).replace(/ left$/, "")}`}
                  </p>
                </div>
              );
            })()
          ) : (
            <>
              <p>{fmtDate(r.rec.unlockTs)}</p>
              <p className={cn("text-[10px]", unlockable ? "text-emerald-300" : "text-white/40")}><Clock className="mr-0.5 inline h-3 w-3" />{timeLeft(r.rec.unlockTs)}</p>
            </>
          )}
        </div>
        <div className="max-md:row-start-2 max-md:col-start-2 max-md:text-right">
          <span className={cn("rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide", STATE_CLS[r.rec.state])}>
            {r.rec.state === "BURNED" ? <Flame className="mr-0.5 inline h-3 w-3" /> : null}{r.rec.state.toLowerCase()}
          </span>
        </div>
        <div className={cn("col-span-2 flex flex-wrap items-center justify-end gap-1 md:col-span-1",
          !canAct && !busyIn(rowScope(r)) && "max-md:hidden")}>
          {busyIn(rowScope(r)) ? (
            <span className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] px-2.5 py-1.5 text-[11px] font-medium text-white/80">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />{busyIn(rowScope(r))}
            </span>
          ) : canAct ? (
            <>
              {unlockable ? <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => void unlock(r)}><LockOpen className="h-3 w-3" />Unlock</Button> : null}
              {claimable ? <Button size="sm" disabled={Boolean(busy)} onClick={() => void claim(r)}>Claim {fmtWei(vestInfo[r.id] || "0", r.rec.token ? (tokenMeta.data?.[r.rec.token]?.decimals ?? 18) : 18)}</Button> : null}
              {canTransfer || canBurnLock ? (
                <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => openManage(r)}><Settings2 className="h-3 w-3" />Manage</Button>
              ) : null}
            </>
          ) : <span className="font-mono text-[10px] text-white/30">—</span>}
        </div>
        {StatusLine({ scope: rowScope(r), className: "col-span-full" })}
      </div>
    );
  };

  const kindOf = (r: LockRow) => (r.rec.kind === "VESTM" ? "VEST" : r.rec.kind);
  // Search: lock id ("12" or "#12"), token/owner address (ase1… or 0x…),
  // token symbol, or LP pool id.
  const matchesQ = (r: LockRow) => {
    const q = lockQ.trim().toLowerCase().replace(/^#/, "");
    if (!q) return true;
    if (/^\d+$/.test(q)) return r.id === q || r.rec.poolId === q;
    const hex = normToken(q);
    if (hex) return r.rec.token === hex || r.rec.owner === hex || Boolean(r.rec.benes?.some((b) => b.addr === hex));
    const sym = r.rec.token ? tokenMeta.data?.[r.rec.token]?.symbol?.toLowerCase() : undefined;
    return Boolean(sym?.includes(q.replace(/^\$/, "")) || pairLabel(r.rec.poolId).toLowerCase().includes(q));
  };
  // "Ended" = the lock period is over whether the owner claimed or not —
  // vesting rows end at their schedule's endMs, everything else at unlockTs.
  // BURNED rows are terminal destruction, not "unlocked".
  const lockEnded = (r: (typeof listRows)[number]) => {
    const end = safeBig((r.rec.kind === "VEST" || r.rec.kind === "VESTM" ? r.rec.endMs : r.rec.unlockTs) || "0");
    return r.rec.state !== "BURNED" && end > 0n && end <= BigInt(Date.now());
  };
  // "All" rows arrive already filtered + paged by the API; "mine" keeps its
  // client-side filtering over the wallet's own (small, bounded) list.
  const isMine = tab === "mine";
  const locks = isMine
    ? listRows.filter((r) => (kindFilter === "all" || (kindFilter === "UNLOCKED" ? lockEnded(r) : kindOf(r) === kindFilter)) && matchesQ(r))
    : (allLocks.data?.rows ?? []);
  const lockTotal = isMine ? locks.length : (allLocks.data?.total ?? 0);
  const lockPages = Math.max(1, Math.ceil(lockTotal / LOCK_PAGE));
  const lockPageCur = Math.min(lockPage, lockPages);
  const locksPaged = isMine ? locks.slice((lockPageCur - 1) * LOCK_PAGE, lockPageCur * LOCK_PAGE) : locks;
  const kindCount = (k: "TOKEN" | "VEST" | "LP") => {
    const b = lockSummary.data?.byKind ?? {};
    return k === "VEST" ? (b.VEST ?? 0) + (b.VESTM ?? 0) : (b[k] ?? 0);
  };
  const activeCount = lockSummary.data?.active ?? 0;

  return (
    <PageShell center title="Token Lock" titleImg="/brand/tokenlocktitle.png" titleImgClassName="h-7 md:h-9" subtitle="Time-lock AseDex LP shares, ARC-20 tokens and vesting schedules. All verifiable on-chain." right={<LiveIndicator />}>
      {/* stats strip */}
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {([
          ["Locks created", String(lockSummary.data?.total ?? "…"), "on AseLock"],
          ["Active locks", String(activeCount), "still time-locked"],
          ["Your locks", ownerHex ? String(myLocks.data?.length ?? "…") : "—", ownerHex ? "this wallet" : "connect wallet"],
          ["Contract", shortenAddress(LOCK, 6, 4), "verified on-chain"]
        ] as [string, string, string][]).map(([l, v, s]) => (
          <Panel key={l} className="px-3.5 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/45">{l}</p>
            <p className="mt-1 font-mono text-lg font-bold text-white/90">{v}</p>
            <p className="text-[10px] text-white/50">{s}</p>
          </Panel>
        ))}
      </div>

      {/* tabs */}
      <div className="mb-4 flex w-full items-center gap-1 rounded-xl border border-white/[0.07] bg-white/[0.02] p-1 sm:w-fit">
        {([["all", `All locks${lockSummary.data?.total ? ` (${lockSummary.data.total})` : ""}`], ["mine", `My locks${myLocks.data?.length ? ` (${myLocks.data.length})` : ""}`], ["create", "Create lock"]] as const).map(([v, l]) => (
          <button key={v} onClick={() => setTab(v)}
            className={cn("flex-1 whitespace-nowrap rounded-lg px-2 py-1.5 text-[11px] font-semibold transition sm:flex-none sm:px-4 sm:text-xs", tab === v ? "bg-white/10 text-white" : "text-white/65 hover:text-white/75")}>{l}</button>
        ))}
      </div>


      {tab === "create" ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* lock kind picker */}
          <div className="lg:col-span-3">
            <div className="flex w-full items-center gap-1 rounded-xl border border-white/[0.07] bg-white/[0.02] p-1 sm:w-fit">
              {([["LP", "LP shares"], ["TOKEN", "Tokens"], ["VEST", "Vesting"], ["NFT", "NFTs"]] as const).map(([v, l]) => (
                <button key={v} onClick={() => setKind(v)}
                  className={cn("flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1.5 text-[11px] font-semibold transition sm:flex-none sm:px-4 sm:text-xs", kind === v ? "bg-white/10 text-white" : "text-white/65 hover:text-white/75")}>
                  {v === "LP" ? <ShieldCheck className="h-3.5 w-3.5" /> : v === "TOKEN" ? <LockIcon className="h-3.5 w-3.5" /> : v === "NFT" ? <ImageIcon className="h-3.5 w-3.5" /> : <TimerReset className="h-3.5 w-3.5" />}{l}
                </button>
              ))}
            </div>
          </div>

          {kind === "LP" ? (
            <Panel className="p-4 md:p-5 lg:col-span-3">
              <p className="text-sm font-semibold">Lock AseDex LP shares</p>
              <p className="mt-1 text-xs text-white/55">Lock your liquidity-pool shares until a date you choose. The pool pair and amounts stay verifiable on-chain.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="text-[11px] text-white/60">Venue</label>
                  <select value={lpDex} onChange={(e) => setLpDex(e.target.value)} className="mt-1 h-11 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-white outline-none [color-scheme:dark] focus:border-white/25">
                    {LP_DEXES.map(([l, a]) => <option key={a} value={a}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-white/60">Pool ID</label>
                  <Input inputMode="numeric" placeholder="e.g. 851" value={poolId} onChange={(e) => setPoolId(e.target.value)} className="mt-1 h-11" />
                  {lpPool ? <p className="mt-1 text-[10px] text-white/50">{lpInfo.data && !lpInfo.data.exists ? "Pool not found on this venue" : pairLabel(lpPool)}</p> : null}
                </div>
                <div>
                  <label className="flex items-center justify-between text-[11px] text-white/60">
                    Shares to lock
                    {ownerHex && lpInfo.data ? <button type="button" className="text-white/80 hover:underline" onClick={() => lpInfo.data && setLpAmt(fmtWei(lpInfo.data.bal.toString(), 18))}>bal {fmtWei(lpInfo.data.bal.toString(), 18)}</button> : null}
                  </label>
                  <Input inputMode="decimal" placeholder="0.0" value={lpAmt} onChange={(e) => setLpAmt(e.target.value)} className="mt-1 h-11" />
                </div>
                <div>
                  <label className="text-[11px] text-white/60">Unlock date</label>
                  <Input type="datetime-local" value={unlockAt} onChange={(e) => setUnlockAt(e.target.value)} className="mt-1 h-11 [color-scheme:dark]" />
                  <div className="mt-1.5 flex gap-1">
                    {[30, 90, 180, 365].map((d) => (
                      <button key={d} type="button" onClick={() => setUnlockAt(new Date(Date.now() + d * 86400000).toISOString().slice(0, 16))}
                        className="rounded-md bg-white/[0.05] px-2 py-1 text-[10px] font-medium text-white/70 transition hover:text-white">{d}d</button>
                    ))}
                  </div>
                </div>
              </div>
              <Button className="mt-4 h-11 w-full" disabled={Boolean(busy) || (Boolean(ownerHex) && (!lpValid || Boolean(lpInfo.data && safeBig(lpAmtWei || "0") > lpInfo.data.bal)))}
                onClick={() => (ownerHex ? void lockLp() : wallet.openConnect?.())}>
                {busyIn("create") ? <><Loader2 className="h-4 w-4 animate-spin" />{busyIn("create")}</> : (ownerHex ? (lpInfo.data && safeBig(lpAmtWei || "0") > lpInfo.data.bal ? "Insufficient LP shares" : lpNeedApprove ? "Approve + lock LP" : "Lock LP shares") : "Connect wallet")}
              </Button>
              {lpNeedApprove ? <p className="mt-1.5 text-center text-[10px] text-white/45">2 transactions: approve LP shares, then lock</p> : null}
              {StatusLine({ scope: "create", className: "mt-2" })}
            </Panel>
          ) : null}

          {kind === "TOKEN" ? (
            <Panel className="p-4 md:p-5 lg:col-span-3">
              <p className="text-sm font-semibold">Lock tokens</p>
              <p className="mt-1 text-xs text-white/55">Escrow any ARC-20 until a set date: team allocations, treasury, airdrop reserves.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-[11px] text-white/60">Token contract (ase1… or 0x…)</label>
                  <Input placeholder="ase1…" value={token} onChange={(e) => setToken(e.target.value)} className="mt-1 h-11 font-mono" />
                  {tokenHex ? <p className="mt-1 text-[10px] text-white/50">${tokSym} · {tokDec} decimals{ownerHex && tokInfo.data ? ` · bal ${fmtWei(tokInfo.data.bal.toString(), tokDec)}` : ""}</p>
                    : token.trim() ? <p className="mt-1 text-[10px] text-amber-300">Invalid token address</p> : null}
                </div>
                <div>
                  <label className="flex items-center justify-between text-[11px] text-white/60">
                    Amount
                    {ownerHex && tokInfo.data ? <button type="button" className="text-white/80 hover:underline" onClick={() => tokInfo.data && setTokAmt(fmtWei(tokInfo.data.bal.toString(), tokDec))}>MAX</button> : null}
                  </label>
                  <Input inputMode="decimal" placeholder="0.0" value={tokAmt} onChange={(e) => setTokAmt(e.target.value)} className="mt-1 h-11" />
                </div>
                <div>
                  <label className="text-[11px] text-white/60">Unlock date</label>
                  <Input type="datetime-local" value={unlockAt} onChange={(e) => setUnlockAt(e.target.value)} className="mt-1 h-11 [color-scheme:dark]" />
                  <div className="mt-1.5 flex gap-1">
                    {[30, 90, 180, 365].map((d) => (
                      <button key={d} type="button" onClick={() => setUnlockAt(new Date(Date.now() + d * 86400000).toISOString().slice(0, 16))}
                        className="rounded-md bg-white/[0.05] px-2 py-1 text-[10px] font-medium text-white/70 transition hover:text-white">{d}d</button>
                    ))}
                  </div>
                </div>
              </div>
              <Button className="mt-4 h-11 w-full" disabled={Boolean(busy) || (Boolean(ownerHex) && (!tokValid || Boolean(tokInfo.data && safeBig(tokAmtWei || "0") > tokInfo.data.bal)))}
                onClick={() => (ownerHex ? void lockTok() : wallet.openConnect?.())}>
                {busyIn("create") ? <><Loader2 className="h-4 w-4 animate-spin" />{busyIn("create")}</> : (ownerHex ? (tokInfo.data && safeBig(tokAmtWei || "0") > tokInfo.data.bal ? `Insufficient ${tokSym}` : tokNeedApprove ? "Approve + lock" : "Lock tokens") : "Connect wallet")}
              </Button>
              {tokNeedApprove ? <p className="mt-1.5 text-center text-[10px] text-white/45">2 transactions: approve {tokSym}, then lock</p> : null}
              {StatusLine({ scope: "create", className: "mt-2" })}
            </Panel>
          ) : null}

          {kind === "VEST" ? (
            <Panel className="p-4 md:p-5 lg:col-span-3">
              <p className="text-sm font-semibold">Vesting lock</p>
              <p className="mt-1 text-xs text-white/55">Tokens release linearly between start and end. Beneficiaries claim what has vested, whenever they want.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-[11px] text-white/60">Token contract (ase1… or 0x…)</label>
                  <Input placeholder="ase1…" value={token} onChange={(e) => setToken(e.target.value)} className="mt-1 h-11 font-mono" />
                  {tokenHex ? <p className="mt-1 text-[10px] text-white/50">${tokSym} · {tokDec} decimals{ownerHex && tokInfo.data ? ` · bal ${fmtWei(tokInfo.data.bal.toString(), tokDec)}` : ""}</p> : null}
                </div>
                <div>
                  <label className="flex items-center justify-between text-[11px] text-white/60">
                    {multi ? "Total amount (sum of beneficiaries)" : "Amount"}
                    {ownerHex && tokInfo.data ? <button type="button" className="text-white/80 hover:underline" onClick={() => tokInfo.data && setTokAmt(fmtWei(tokInfo.data.bal.toString(), tokDec))}>MAX</button> : null}
                  </label>
                  <Input inputMode="decimal" placeholder="0.0" value={tokAmt} onChange={(e) => setTokAmt(e.target.value)} disabled={multi} className="mt-1 h-11 disabled:opacity-50" />
                  <label className="mt-1.5 flex cursor-pointer items-center gap-1.5 text-[10px] text-white/55">
                    <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} className="accent-white" />
                    Multiple beneficiaries (team split)
                  </label>
                </div>
                {multi ? (
                  <div className="sm:col-span-2">
                    <label className="text-[11px] text-white/60">Beneficiaries, one per line: <span className="font-mono">address,amount</span></label>
                    <textarea rows={3} value={benesText} onChange={(e) => setBenesText(e.target.value)}
                      placeholder={"ase1abc…,500000\nase1def…,250000"}
                      className="mt-1 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-xs text-white outline-none placeholder:text-white/35 focus:border-white/25" />
                    {parsedBenes && "bad" in parsedBenes ? <p className="mt-1 text-[10px] text-red-300">Bad line: {parsedBenes.bad}</p>
                      : beneRows ? <p className="mt-1 text-[10px] text-emerald-300">{beneRows.length} beneficiaries · total {fmtWei(vestTotalWei || "0", tokDec)} {tokSym}</p> : null}
                  </div>
                ) : null}
                <div>
                  <label className="text-[11px] text-white/60">Vesting starts</label>
                  <Input type="datetime-local" value={vestStart} onChange={(e) => setVestStart(e.target.value)} className="mt-1 h-11 [color-scheme:dark]" />
                </div>
                <div>
                  <label className="text-[11px] text-white/60">Fully vested</label>
                  <Input type="datetime-local" value={vestEnd} onChange={(e) => setVestEnd(e.target.value)} className="mt-1 h-11 [color-scheme:dark]" />
                  <div className="mt-1.5 flex gap-1">
                    {[180, 365, 730].map((d) => (
                      <button key={d} type="button" onClick={() => { setVestStart(new Date(Date.now()).toISOString().slice(0, 16)); setVestEnd(new Date(Date.now() + d * 86400000).toISOString().slice(0, 16)); }}
                        className="rounded-md bg-white/[0.05] px-2 py-1 text-[10px] font-medium text-white/70 transition hover:text-white">{d}d</button>
                    ))}
                  </div>
                </div>
              </div>
              <Button className="mt-4 h-11 w-full" disabled={Boolean(busy) || (Boolean(ownerHex) && (!vestValid || Boolean(tokInfo.data && vestTotalWei && safeBig(vestTotalWei) > tokInfo.data.bal)))}
                onClick={() => (ownerHex ? void lockVest() : wallet.openConnect?.())}>
                {busyIn("create") ? <><Loader2 className="h-4 w-4 animate-spin" />{busyIn("create")}</> : (ownerHex ? (tokInfo.data && vestTotalWei && safeBig(vestTotalWei) > tokInfo.data.bal ? `Insufficient ${tokSym}` : vestNeedApprove ? "Approve + create vesting" : "Create vesting lock") : "Connect wallet")}
              </Button>
              {vestNeedApprove ? <p className="mt-1.5 text-center text-[10px] text-white/45">2 transactions: approve {tokSym}, then create</p> : null}
              {StatusLine({ scope: "create", className: "mt-2" })}
            </Panel>
          ) : null}

          {kind === "NFT" ? (
            <Panel className="lg:col-span-3 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-[11px] text-white/60">NFT collection</label>
                  <Input placeholder="ase1… collection contract" value={nftCollection} onChange={(e) => setNftCollection(e.target.value)} className="mt-1 h-11 font-mono" />
                </div>
                <div>
                  <label className="text-[11px] text-white/60">Token ids (comma/space separated)</label>
                  <Input placeholder="1, 2, 3" value={nftIds} onChange={(e) => setNftIds(e.target.value)} className="mt-1 h-11 font-mono" />
                </div>
                <div>
                  <label className="text-[11px] text-white/60">Unlock date</label>
                  <Input type="datetime-local" value={unlockAt} onChange={(e) => setUnlockAt(e.target.value)} className="mt-1 h-11 [color-scheme:dark]" />
                </div>
              </div>
              <Button className="mt-4 h-11 w-full" disabled={Boolean(busy) || (Boolean(ownerHex) && (!nftCollection.trim() || !nftIds.trim() || unlockMs <= Date.now()))}
                onClick={() => (ownerHex ? void lockNft() : wallet.openConnect?.())}>
                {busyIn("create") ? <><Loader2 className="h-4 w-4 animate-spin" />{busyIn("create")}</> : (ownerHex ? "Approve + lock NFTs" : "Connect wallet")}
              </Button>
              <p className="mt-1.5 text-center text-[10px] text-white/45">2 transactions: setApprovalForAll, then lockNFT — deploys to AseLock v2.</p>
              {StatusLine({ scope: "create", className: "mt-2" })}
            </Panel>
          ) : null}
        </div>
      ) : (
        <Panel className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.07] px-3 py-2.5 sm:px-4">
            <div className="flex w-full gap-1 overflow-x-auto rounded-lg bg-white/[0.05] p-0.5 sm:w-auto [&::-webkit-scrollbar]:hidden">
              {([["all", "All"], ["TOKEN", "Token locks"], ["VEST", "Vesting locks"], ["LP", "LP locks"], ["UNLOCKED", "Unlocked"]] as const).map(([v, l]) => (
                <button key={v} onClick={() => setKindFilter(v)}
                  className={cn("shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-[11px] font-medium transition sm:px-3", kindFilter === v ? "bg-white/10 text-white" : "text-white/65 hover:text-white/70")}>
                  {l}{v !== "all" ? <span className="ml-1 font-mono text-white/45">{v === "UNLOCKED" ? (lockSummary.data?.ended ?? "") : kindCount(v as "TOKEN" | "VEST" | "LP") || ""}</span> : null}
                </button>
              ))}
            </div>
            <div className="relative min-w-0 flex-1 sm:max-w-64">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/50" />
              <Input value={lockQ} onChange={(e) => setLockQ(e.target.value)} placeholder="Lock ID, token, owner or ticker"
                className="h-8 w-full min-w-0 pl-8 pr-7 text-xs" />
              {lockQ ? (
                <button onClick={() => setLockQ("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 transition hover:text-white/70">
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            <a href={explorerAddressUrl(LOCK)} target="_blank" rel="noreferrer" className="hidden items-center gap-1 font-mono text-[10px] text-white/50 transition hover:text-white sm:flex">
              {shortenAddress(LOCK, 8, 6)}<ExternalLink className="h-3 w-3" />
            </a>
          </div>
          {tab === "mine" && !ownerHex ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <WalletIcon className="h-6 w-6 text-white/40" />
              <p className="text-sm text-white/70">Connect a wallet to see your locks</p>
              <Button size="sm" onClick={() => wallet.openConnect?.()}>Connect wallet</Button>
            </div>
          ) : (tab === "mine" ? myLocks.isPending : allLocks.isPending) ? (
            <div className="divide-y divide-white/[0.04]">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                  <div className="h-8 w-8 shrink-0 animate-pulse rounded-lg bg-white/[0.07]" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="h-3 w-28 animate-pulse rounded bg-white/[0.07]" />
                    <div className="h-2.5 w-44 max-w-full animate-pulse rounded bg-white/[0.05]" />
                  </div>
                  <div className="h-5 w-16 shrink-0 animate-pulse rounded-full bg-white/[0.07]" />
                </div>
              ))}
            </div>
          ) : locks.length ? (
            <>
              {locksPaged.map((r) => <Fragment key={r.id}>{LockRowView({ r, manage: tab === "mine" })}</Fragment>)}
              {lockPages > 1 ? (
                <div className="flex items-center justify-between border-t border-white/[0.05] px-4 py-2">
                  <span className="text-[11px] text-white/45">{locks.length.toLocaleString()} locks · page {lockPageCur} of {lockPages}</span>
                  <div className="flex items-center gap-1">
                    <button type="button" disabled={lockPageCur <= 1} onClick={() => setLockPage(lockPageCur - 1)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 text-white/60 transition hover:bg-white/5 hover:text-white disabled:opacity-30"><ChevronLeft className="h-3.5 w-3.5" /></button>
                    <button type="button" disabled={lockPageCur >= lockPages} onClick={() => setLockPage(lockPageCur + 1)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 text-white/60 transition hover:bg-white/5 hover:text-white disabled:opacity-30"><ChevronRight className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <p className="p-8 text-center text-sm text-white/55">{lockQ.trim() && listRows.length ? `No locks match "${lockQ.trim()}".` : kindFilter !== "all" && listRows.length ? "No locks of this type yet." : tab === "mine" ? "No locks on this wallet yet." : "No locks created yet. Be the first."}</p>
          )}
          {locks.some((r) => r.rec.benes?.some((b) => b.addr === ownerHex) && r.rec.owner !== ownerHex) ? (
            <p className="border-t border-white/[0.06] px-4 py-2 text-[10px] text-white/45">Locks where you're a beneficiary but not the owner appear under All locks. Claim from there.</p>
          ) : null}
        </Panel>
      )}

      <p className="mt-5 text-center text-[11px] text-white/45">
        Locks are enforced by the AseLock contract, not by the site. Anyone can verify a lock on-chain.
        Burning a lock destroys the assets forever.
      </p>

      {confirm && typeof document !== "undefined" ? createPortal((() => {
        const r = confirm.row;
        const a = assetLabel(r);
        const isLp = r.rec.kind === "LP";
        const isBeni = r.rec.kind === "VESTM";
        const isVest = isBeni || r.rec.kind === "VEST";
        const what = isLp ? "LP shares" : "tokens";
        // Which management paths this lock supports for the connected wallet.
        const canTransfer = r.rec.state === "LOCKED" && (isBeni ? Boolean(ownerHex && r.rec.benes?.some((b) => b.addr === ownerHex)) : !isVest && r.rec.owner === ownerHex);
        const canBurn = r.rec.state === "LOCKED" && isLp && r.rec.owner === ownerHex;
        const step = confirm.type === "menu" && !(canTransfer && canBurn) ? (canTransfer ? "transfer" : canBurn ? "burn" : "menu") : confirm.type;
        const isBurn = step === "burn";
        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true"
            onKeyDown={(e) => { if (e.key === "Escape") closeManage(); }}>
            <button aria-label="Cancel" onClick={closeManage} className="absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm" />
            <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#0b0d14] p-5 shadow-2xl shadow-black/60">
              <div className="flex items-start gap-3">
                <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border",
                  step === "menu" ? "border-white/15 bg-white/[0.06] text-white/80"
                    : isBurn ? "border-red-500/30 bg-red-500/10 text-red-300" : "border-amber-500/30 bg-amber-500/10 text-amber-300")}>
                  {step === "menu" ? <Settings2 className="h-5 w-5" /> : isBurn ? <Flame className="h-5 w-5" /> : <Send className="h-5 w-5" />}
                </span>
                <div className="min-w-0">
                  <p className="text-base font-semibold">
                    {step === "menu" ? "Manage lock" : isBurn ? `Burn all locked ${what}?` : isBeni ? "Transfer your vesting slot?" : `Transfer locked ${isLp ? "LP" : "token"} ownership?`}
                  </p>
                  <p className="mt-0.5 text-xs text-white/55">Lock #{r.id} · {KIND_LABEL[r.rec.kind]}</p>
                </div>
              </div>

              <div className="mt-4 space-y-2 rounded-xl border border-white/[0.07] bg-white/[0.03] p-3 text-xs">
                <div className="flex justify-between gap-3"><span className="text-white/55">Asset</span><span className="truncate text-right font-semibold">{a.main}</span></div>
                <div className="flex justify-between gap-3"><span className="text-white/55">Amount</span><span className="truncate text-right font-mono">{a.sub}</span></div>
              </div>

              {step === "menu" ? (
                <div className="mt-4 space-y-2">
                  {canTransfer ? (
                    <button onClick={() => { setManageErr(null); setConfirm({ ...confirm, type: "transfer" }); }}
                      className="group flex w-full items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 text-left transition hover:border-amber-500/40 hover:bg-amber-500/[0.06]">
                      <Send className="h-4 w-4 shrink-0 text-amber-300" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">{isBeni ? "Transfer vesting slot" : "Transfer ownership"}</span>
                        <span className="block text-[11px] text-white/55">{isBeni ? "Move your beneficiary slot to another wallet" : "Give this lock to a different wallet"}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-white/35 transition group-hover:translate-x-0.5 group-hover:text-amber-300" />
                    </button>
                  ) : null}
                  {canBurn ? (
                    <button onClick={() => { setManageErr(null); setConfirm({ ...confirm, type: "burn" }); }}
                      className="group flex w-full items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 text-left transition hover:border-red-500/40 hover:bg-red-500/[0.06]">
                      <Flame className="h-4 w-4 shrink-0 text-red-300" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">Burn lock</span>
                        <span className="block text-[11px] text-white/55">Destroy all locked {what} forever</span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-white/35 transition group-hover:translate-x-0.5 group-hover:text-red-300" />
                    </button>
                  ) : null}
                  {r.lock === LOCK_V2 && r.rec.state === "LOCKED" && r.rec.owner === ownerHex ? (
                    <>
                      {([
                        ["extend", Clock, "Extend lock", "Push the unlock date further out"],
                        ["topup", ShieldCheck, "Top up", "Add more of the locked asset"],
                        ["migrate", Send, "Migrate lock", "Move this lock to another lock contract"],
                      ] as const).map(([v, Icon, t, sub]) => (
                        <button key={v} onClick={() => { setManageErr(null); setConfirm({ ...confirm, type: v, to: "" }); }}
                          className="group flex w-full items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 text-left transition hover:border-sky-500/40 hover:bg-sky-500/[0.06]">
                          <Icon className="h-4 w-4 shrink-0 text-sky-300" />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold">{t}</span>
                            <span className="block text-[11px] text-white/55">{sub}</span>
                          </span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-white/35 transition group-hover:translate-x-0.5 group-hover:text-sky-300" />
                        </button>
                      ))}
                    </>
                  ) : null}
                  {r.lock === LOCK_V2 && r.rec.state === "RELEASED" && r.rec.owner === ownerHex ? (
                    <button onClick={() => { setManageErr(null); setConfirm({ ...confirm, type: "relock", to: "" }); }}
                      className="group flex w-full items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 text-left transition hover:border-sky-500/40 hover:bg-sky-500/[0.06]">
                      <TimerReset className="h-4 w-4 shrink-0 text-sky-300" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">Relock</span>
                        <span className="block text-[11px] text-white/55">Put the released asset under a new unlock date</span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-white/35 transition group-hover:translate-x-0.5 group-hover:text-sky-300" />
                    </button>
                  ) : null}
                  {!canTransfer && !canBurn && !(r.lock === LOCK_V2 && r.rec.owner === ownerHex) ? <p className="text-xs text-white/55">No actions available on this lock.</p> : null}
                  <Button variant="secondary" className="h-10 w-full" onClick={closeManage}>Close</Button>
                </div>
              ) : (
                <>
                  {step === "transfer" ? (
                    <div className="mt-4">
                      <label className="text-[11px] text-white/60">Destination address</label>
                      <Input value={confirm.to ?? ""} onChange={(e) => { setManageErr(null); setConfirm({ ...confirm, to: e.target.value }); }}
                        placeholder="ase1… or 0x…" className="mt-1 h-10 font-mono text-xs" autoFocus />
                      {confirm.to && normToken(confirm.to) ? (
                        <p className="mt-1 break-all font-mono text-[10px] text-white/50">→ {toAseAddress(normToken(confirm.to)!)}</p>
                      ) : null}
                    </div>
                  ) : step === "extend" || step === "relock" ? (
                    <div className="mt-4">
                      <label className="text-[11px] text-white/60">{step === "extend" ? "New unlock date" : "Relock until"}</label>
                      <Input type="datetime-local" value={confirm.to ?? ""} onChange={(e) => { setManageErr(null); setConfirm({ ...confirm, to: e.target.value }); }}
                        className="mt-1 h-10 text-xs [color-scheme:dark]" autoFocus />
                    </div>
                  ) : step === "topup" ? (
                    <div className="mt-4">
                      <label className="text-[11px] text-white/60">Amount to add</label>
                      <Input inputMode="decimal" value={confirm.to ?? ""} onChange={(e) => { setManageErr(null); setConfirm({ ...confirm, to: e.target.value }); }}
                        placeholder="0.0" className="mt-1 h-10 font-mono text-xs" autoFocus />
                    </div>
                  ) : step === "migrate" ? (
                    <div className="mt-4">
                      <label className="text-[11px] text-white/60">Target lock contract</label>
                      <Input value={confirm.to ?? ""} onChange={(e) => { setManageErr(null); setConfirm({ ...confirm, to: e.target.value }); }}
                        placeholder="0x… lock contract" className="mt-1 h-10 font-mono text-xs" autoFocus />
                    </div>
                  ) : (
                    <div className="mt-4 flex justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] p-3 text-xs">
                      <span className="text-white/55">Sent to</span><span className="font-mono text-red-300" title="0x0000000000000000000000000000000000000000">0x0000…0000 (zero address)</span>
                    </div>
                  )}

                  <p className={cn("mt-3 rounded-lg border px-3 py-2 text-[11px] leading-relaxed",
                    isBurn ? "border-red-500/25 bg-red-500/[0.07] text-red-200" : "border-amber-500/25 bg-amber-500/[0.07] text-amber-100")}>
                    {isBurn
                      ? `This permanently destroys 100% of the ${what} in this lock. ${isLp ? "The liquidity behind them stays in the pool forever and can never be withdrawn." : "They leave circulation for good."} This cannot be undone.`
                      : isBeni
                        ? "Your entire beneficiary slot (every unclaimed and future vesting payout) moves to this address. You lose all claims on it. This cannot be undone."
                        : `Ownership of the whole lock (100% of the ${what}) moves to this address. Only the new owner can unlock, burn or transfer it. Double-check the address. This cannot be undone.`}
                  </p>
                  {manageErr ? <p className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">{manageErr}</p> : null}

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <Button variant="secondary" className="h-10" autoFocus
                      onClick={() => canTransfer && canBurn ? setConfirm({ ...confirm, type: "menu" }) : closeManage()}>
                      {canTransfer && canBurn ? "Back" : "Cancel"}
                    </Button>
                    <Button className={cn("h-10", isBurn && "bg-red-500/90 text-white hover:bg-red-500")} onClick={doConfirm}>
                      {isBurn ? "Yes, burn all LP" : "Yes, transfer"}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })(), document.body) : null}
    </PageShell>
  );
}
