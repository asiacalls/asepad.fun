"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWalletStore } from "@/stores/wallet";
import { requireWalletTxMined, sendWalletCall, viewContract } from "@/lib/asentum-wallet";
import { aseToWei, asepadGetConfig, asepadGetStats, fmtAse, fmtAseCompact, safeBig, shortenAddress, tokenFactoryAddress } from "@/lib/asepad";
import { toHexAddress } from "@asentrise/utils";
import { apiVerified, apiVerifiedWrite } from "@/lib/ase-api";
import { LOCK_V2 } from "@/lib/lock-shared";
import { ShieldAlert } from "lucide-react";

type Contract = "pad" | "dex" | "factory" | "lock2";
type Unit = "ase" | "bps" | "address" | "usd" | "raw" | "text";
type Field = { key: string; label: string; hint: string; unit: Unit; method: string; contract: Contract; args?: (value: string) => unknown[] };
type ActionInput = { key: string; label: string; unit: Unit; placeholder?: string };
type Action = { key: string; label: string; hint: string; contract: Contract; method: string; inputs: ActionInput[]; danger?: boolean };

const PAD_FIELDS: Field[] = [
  { key: "creationFeeWei", label: "AsePad launch fee", hint: "ASE charged per bonding-curve launch", unit: "ase", method: "setCreationFee", contract: "pad" },
  { key: "feeBps", label: "Curve trade fee", hint: "% of each curve buy/sell → treasury", unit: "bps", method: "setTradeFeeBps", contract: "pad" },
  { key: "targetWei", label: "Bonding target", hint: "Real ASE reserve that triggers migration", unit: "ase", method: "setBondingTarget", contract: "pad" },
  { key: "creatorBps", label: "Creator reward", hint: "% of target paid to creator at migration", unit: "bps", method: "setCreatorRewardBps", contract: "pad" },
  { key: "virtualAseWei", label: "Virtual pricing base", hint: "Pricing-only ASE (≈ $4k cap); locked after first launch", unit: "ase", method: "setVirtualAseWei", contract: "pad" },
  { key: "aseUsdScaled", label: "ASE/USD rate", hint: "Fixed-point USD price used for $ displays", unit: "usd", method: "setAseUsdScaled", contract: "pad" },
  { key: "treasury", label: "AsePad treasury", hint: "Receives launch + curve fees", unit: "address", method: "setTreasury", contract: "pad" },
  { key: "aseDex", label: "AseDex contract", hint: "New launches migrate here; existing launches keep their snapshot", unit: "address", method: "setAseDex", contract: "pad" },
  { key: "padAdmin", label: "AsePad admin", hint: "Transfers full control. Irreversible from this wallet", unit: "address", method: "transferAdmin", contract: "pad" }
];

const DEX_FIELDS: Field[] = [
  { key: "dexFeeBps", label: "AseDex swap fee", hint: "% of each swap, split between LPs and treasury", unit: "bps", method: "setFeeBps", contract: "dex" },
  { key: "dexShareBps", label: "Treasury share of swap fee", hint: "% of the swap fee to treasury; the rest accrues to LPs", unit: "bps", method: "setTreasuryShareBps", contract: "dex" },
  { key: "dexTreasury", label: "AseDex treasury", hint: "Receives the treasury share of swap fees", unit: "address", method: "setTreasury", contract: "dex" },
  { key: "dexAsePad", label: "AsePad contract", hint: "The pad allowed to create pools; locked after first pool", unit: "address", method: "setAsePad", contract: "dex" },
  { key: "dexAdmin", label: "AseDex admin", hint: "Transfers full control. Irreversible from this wallet", unit: "address", method: "transferAdmin", contract: "dex" }
];

const FACTORY_FIELDS: Field[] = [
  { key: "standardFee", label: "Standard token fee", hint: "ASE charged to register a standard ARC-20", unit: "ase", method: "setFee", contract: "factory", args: (v) => ["token_deploy:STANDARD", v] },
  { key: "taxFee", label: "Tax token fee", hint: "ASE charged to register a tax ARC-20", unit: "ase", method: "setFee", contract: "factory", args: (v) => ["token_deploy:TAX", v] },
  { key: "factoryTreasury", label: "Factory treasury", hint: "Receives token registration fees", unit: "address", method: "setTreasury", contract: "factory" },
  { key: "factoryAsePad", label: "AsePad contract", hint: "Address tokens must bind to for ASEPAD registration", unit: "address", method: "setAsePad", contract: "factory" },
  { key: "factoryAdmin", label: "Factory admin", hint: "Transfers full control. Irreversible from this wallet", unit: "address", method: "transferAdmin", contract: "factory" }
];

const ACTIONS: Action[] = [
  { key: "retryMigration", label: "Retry stuck migration", hint: "Reconciles a launch stuck in MIGRATING against on-chain AseDex state", contract: "pad", method: "retryMigration", inputs: [{ key: "token", label: "Token address", unit: "address", placeholder: "0x…" }] },
  { key: "dexPoolFee", label: "Per-pool swap fee", hint: "Override the fee bps on a single AseDex pool", contract: "dex", method: "setPoolFeeBps", inputs: [{ key: "poolId", label: "Pool ID", unit: "raw", placeholder: "1" }, { key: "bps", label: "Fee %", unit: "bps", placeholder: "0.30" }] },
  { key: "factorySetFee", label: "Set factory fee", hint: "Fixed ASE fee for any fee key (e.g. token_deploy:STANDARD, token_deploy:TAX)", contract: "factory", method: "setFee", inputs: [{ key: "feeKey", label: "Fee key", unit: "text", placeholder: "token_deploy:TAX" }, { key: "amount", label: "Amount", unit: "ase", placeholder: "10" }] },
  { key: "factoryFeeToggle", label: "Enable/disable a fee", hint: "Toggle a fee key's wei charge on or off", contract: "factory", method: "setWeiFeeEnabled", inputs: [{ key: "feeKey", label: "Fee key", unit: "text", placeholder: "token_deploy:TAX" }, { key: "enabled", label: "1 = on, 0 = off", unit: "raw", placeholder: "1" }] },
  { key: "padRescueAse", label: "Rescue surplus ASE (pad)", hint: "Testnet only: the unallocated surplus can leave", contract: "pad", method: "rescueAse", danger: true, inputs: [{ key: "to", label: "To", unit: "address", placeholder: "0x…" }, { key: "amount", label: "Amount", unit: "ase", placeholder: "0" }] },
  { key: "padRescueAll", label: "Rescue ALL ASE (pad)", hint: "Testnet only: pauses the pad, marks every launch RECOVERED, sweeps all held ASE", contract: "pad", method: "rescueAllAse", danger: true, inputs: [{ key: "to", label: "To", unit: "address", placeholder: "0x…" }] },
  { key: "padRescueToken", label: "Rescue token (pad)", hint: "Testnet only: surplus tokens of migrated/recovered launches only", contract: "pad", method: "rescueToken", danger: true, inputs: [{ key: "token", label: "Token", unit: "address" }, { key: "to", label: "To", unit: "address" }, { key: "amount", label: "Amount (raw units)", unit: "raw" }] },
  { key: "factoryRescueAse", label: "Rescue ASE (factory)", hint: "Withdraw ASE stuck on the factory contract", contract: "factory", method: "rescueAse", danger: true, inputs: [{ key: "to", label: "To", unit: "address" }, { key: "amount", label: "Amount", unit: "ase" }] },
  { key: "factoryRescueToken", label: "Rescue token (factory)", hint: "Withdraw tokens stuck on the factory (active launch tokens protected)", contract: "factory", method: "rescueToken", danger: true, inputs: [{ key: "token", label: "Token", unit: "address" }, { key: "to", label: "To", unit: "address" }, { key: "amount", label: "Amount (raw units)", unit: "raw" }] },
  // ── AseLock v2 — owner + contract ops ──────────────────────────────────
  { key: "l2addDex", label: "v2: allow dex", hint: "addDex — whitelist an LP dex", contract: "lock2", method: "addDex", inputs: [{ key: "dex", label: "Dex contract", unit: "address" }] },
  { key: "l2removeDex", label: "v2: block dex", hint: "removeDex — unwhitelist an LP dex", contract: "lock2", method: "removeDex", inputs: [{ key: "dex", label: "Dex contract", unit: "address" }] },
  { key: "l2addMig", label: "v2: allow migration source", hint: "addMigSource — lock contract allowed to import locks", contract: "lock2", method: "addMigSource", inputs: [{ key: "src", label: "Source lock contract", unit: "address" }] },
  { key: "l2removeMig", label: "v2: block migration source", hint: "removeMigSource", contract: "lock2", method: "removeMigSource", inputs: [{ key: "src", label: "Source lock contract", unit: "address" }] },
  { key: "l2owner", label: "v2: transfer ownership", hint: "transferOwnership — hands over the whole lock contract. Irreversible", contract: "lock2", method: "transferOwnership", danger: true, inputs: [{ key: "to", label: "New owner", unit: "address" }] },
  { key: "l2addNFTs", label: "v2: addNFTs", hint: "Append NFTs to an existing NFT lock", contract: "lock2", method: "addNFTs", inputs: [{ key: "lockId", label: "Lock id", unit: "raw" }, { key: "ids", label: "Token ids (csv)", unit: "text" }] },
  { key: "l2addBenes", label: "v2: addBenes", hint: "Append beneficiaries to a VESTM lock — JSON [[addr,wei],…]", contract: "lock2", method: "addBenes", inputs: [{ key: "lockId", label: "Lock id", unit: "raw" }, { key: "benes", label: "Benes JSON", unit: "text" }] },
  { key: "l2burnLp", label: "v2: burnLp", hint: "Burn LP shares without a lock — permanent", contract: "lock2", method: "burnLp", danger: true, inputs: [{ key: "poolId", label: "Pool id", unit: "raw" }, { key: "amt", label: "Shares (raw)", unit: "raw" }, { key: "dex", label: "Dex", unit: "address" }] },
  { key: "l2burnTokens", label: "v2: burnTokens", hint: "Send tokens to the burn vault — permanent", contract: "lock2", method: "burnTokens", danger: true, inputs: [{ key: "token", label: "Token", unit: "address" }, { key: "amt", label: "Amount (raw)", unit: "raw" }] },
  { key: "l2burnNFTs", label: "v2: burnNFTs", hint: "Send NFTs to the burn vault — permanent", contract: "lock2", method: "burnNFTs", danger: true, inputs: [{ key: "collection", label: "Collection", unit: "address" }, { key: "ids", label: "Token ids (csv)", unit: "text" }] },
  { key: "l2import", label: "v2: importLock", hint: "Import a lock record from a source contract — needs the source's migrateLock first", contract: "lock2", method: "importLock", inputs: [{ key: "owner", label: "Lock owner", unit: "address" }, { key: "srcId", label: "Source lock id", unit: "raw" }, { key: "recJson", label: "Lock record JSON", unit: "text" }] }
];

const toDisplay = (unit: Unit, raw: string | undefined) =>
  unit === "ase" ? (Number(safeBig(raw)) / 1e18).toString()
  : unit === "bps" ? (Number(raw || "0") / 100).toString()
  : unit === "usd" ? (Number(raw || "0") / 1e6).toString()
  : raw || "";

const toWire = (unit: Unit, raw: string) =>
  unit === "ase" ? aseToWei(raw) : unit === "bps" ? String(Math.round(Number(raw) * 100)) : unit === "usd" ? String(Math.round(Number(raw) * 1e6)) : raw;

export default function AdminPage() {
  const wallet = useWalletStore();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [actionDraft, setActionDraft] = useState<Record<string, Record<string, string>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const state = useQuery({
    queryKey: ["asepad", "admin"],
    queryFn: async () => {
      const cfg = await asepadGetConfig();
      const c = cfg.config ?? {};
      const pad = cfg.contract!;
      const dex = String(c.aseDex || "");
      const factory = tokenFactoryAddress();
      const [padAdmin, dexAdmin, factoryAdmin, dexTreasury, dexFeeBps, dexShareBps, dexAsePad, factoryTreasury, factoryAsePad, standardFee, taxFee, standardCount, surplus, stats, lock2Owner] = await Promise.all([
        viewContract<string>(pad, "admin").catch(() => ""),
        dex ? viewContract<string>(dex, "admin").catch(() => "") : Promise.resolve(""),
        factory ? viewContract<string>(factory, "admin").catch(() => "") : Promise.resolve(""),
        dex ? viewContract<string>(dex, "treasury").catch(() => "") : Promise.resolve(""),
        dex ? viewContract<string>(dex, "feeBps").catch(() => "30") : Promise.resolve("30"),
        dex ? viewContract<string>(dex, "treasuryShareBps").catch(() => "6667") : Promise.resolve("6667"),
        dex ? viewContract<string>(dex, "asePad").catch(() => "") : Promise.resolve(""),
        factory ? viewContract<string>(factory, "treasury").catch(() => "") : Promise.resolve(""),
        factory ? viewContract<string>(factory, "asepad").catch(() => "") : Promise.resolve(""),
        factory ? viewContract<string>(factory, "getFeeWei", ["token_deploy:STANDARD"]).catch(() => "0") : Promise.resolve("0"),
        factory ? viewContract<string>(factory, "getFeeWei", ["token_deploy:TAX"]).catch(() => "0") : Promise.resolve("0"),
        factory ? viewContract<string>(factory, "tokenCount").catch(() => "0") : Promise.resolve("0"),
        viewContract<string>(pad, "surplusAseWei").catch(() => "0"),
        asepadGetStats().catch(() => null),
        viewContract<string>(LOCK_V2, "owner").catch(() => "")
      ]);
      return {
        cfg, pad, dex, factory, stats,
        admins: { pad: String(padAdmin), dex: String(dexAdmin), factory: String(factoryAdmin), lock2: String(lock2Owner) },
        surplus: String(surplus || "0"),
        standardCount: String(standardCount || "0"),
        values: {
          ...c,
          padAdmin: String(padAdmin), dexAdmin: String(dexAdmin), factoryAdmin: String(factoryAdmin),
          dexTreasury: String(dexTreasury), dexFeeBps: String(dexFeeBps), dexShareBps: String(dexShareBps), dexAsePad: String(dexAsePad),
          factoryTreasury: String(factoryTreasury), factoryAsePad: String(factoryAsePad), standardFee: String(standardFee), taxFee: String(taxFee)
        } as Record<string, string | boolean | undefined>
      };
    }
  });

  const data = state.data;
  const me = wallet.address ? toHexAddress(wallet.address).toLowerCase() : "";
  const isAdminOf = (contract: Contract) => Boolean(data && me && data.admins[contract]?.toLowerCase() === me);
  const isAdmin = isAdminOf("pad") || isAdminOf("dex") || isAdminOf("factory") || isAdminOf("lock2");
  const value = (f: Field) => draft[f.key] ?? toDisplay(f.unit, data?.values[f.key] as string | undefined);

  async function run(label: string, to: string, method: string, args: unknown[]) {
    setBusy(label); setMessage(null);
    try {
      await requireWalletTxMined(await sendWalletCall({ to, method, args }), label, 180_000);
      setMessage({ ok: true, text: `${label} confirmed on-chain` });
      setDraft({});
      setActionDraft({});
      void qc.invalidateQueries({ queryKey: ["asepad"] });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Transaction failed" });
    } finally { setBusy(null); }
  }

  const contractAddr = (c: Contract) => !data ? "" : c === "pad" ? data.pad : c === "dex" ? data.dex : c === "lock2" ? LOCK_V2 : data.factory;

  function save(f: Field) {
    const raw = value(f).trim();
    const v = toWire(f.unit, raw);
    const to = contractAddr(f.contract);
    if (!to) { setMessage({ ok: false, text: `${f.contract} contract not configured` }); return; }
    void run(f.label, to, f.method, f.args ? f.args(v) : [v]);
  }

  function runAction(a: Action) {
    const vals = actionDraft[a.key] ?? {};
    if (a.inputs.some((i) => !(vals[i.key] ?? "").trim())) {
      setMessage({ ok: false, text: `${a.label}: fill in every field` }); return;
    }
    const args = a.inputs.map((i) => i.unit === "raw" ? (i.key === "enabled" ? vals[i.key].trim() === "1" : vals[i.key].trim()) : toWire(i.unit, vals[i.key].trim()));
    const to = contractAddr(a.contract);
    if (!to) { setMessage({ ok: false, text: `${a.contract} contract not configured` }); return; }
    void run(a.label, to, a.method, args);
  }

  // ── Blue ticks — the admin wallet signs the factory's on-chain
  // "official:<token>" flag (admin-gated on-chain), then /api/verified mirrors
  // chain truth into the DB. No API key: the wallet IS the authority.
  const [tickAddr, setTickAddr] = useState("");
  const [tickTag, setTickTag] = useState("");
  const tickHex = (() => { try { return tickAddr.trim() ? toHexAddress(tickAddr.trim()).toLowerCase() : ""; } catch { return ""; } })();
  const verified = useQuery({
    queryKey: ["asepad", "verified-tokens"],
    queryFn: async () => (await apiVerified())?.tokens ?? []
  });
  const tickList = (verified.data ?? []).map((t) => t.address);
  const tickTicked = tickHex ? tickList.includes(tickHex) : false;

  async function grantTick(grant: boolean, addr = tickHex) {
    if (!addr || !data?.factory) return;
    setBusy("Blue tick"); setMessage(null);
    try {
      await requireWalletTxMined(await sendWalletCall({ to: data.factory, method: "setWeiFeeEnabled", args: [`official:${addr}`, grant] }), grant ? "Grant blue tick" : "Remove blue tick", 180_000);
      // Mirror the on-chain flag into the API DB (server re-reads the flag —
      // the endpoint can only write what the chain says).
      await apiVerifiedWrite(addr, me || undefined, tickTag.trim() || undefined).catch(() => null);
      setMessage({ ok: true, text: grant ? `${shortenAddress(addr)} now carries the blue tick` : `Blue tick removed from ${shortenAddress(addr)}` });
      if (!grant && addr === tickHex) setTickAddr("");
      void qc.invalidateQueries({ queryKey: ["asepad", "verified-tokens"] });
      void qc.invalidateQueries({ queryKey: ["asedex-official-tokens"] });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Transaction failed" });
    } finally { setBusy(null); }
  }

  const paused = data?.values.paused === true;

  const fieldRow = (f: Field) => (
    <div key={f.key} className="flex flex-wrap items-center gap-3 px-5 py-4">
      <div className="min-w-[220px] flex-1"><p className="font-medium">{f.label}</p><p className="text-xs text-white/60">{f.hint}</p></div>
      <Input className="w-64 font-mono text-xs" value={value(f)} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))} disabled={!isAdminOf(f.contract)} />
      <span className="w-10 text-xs text-white/60">{f.unit === "ase" ? "ASE" : f.unit === "bps" ? "%" : f.unit === "usd" ? "USD" : ""}</span>
      <Button size="sm" disabled={Boolean(busy) || !isAdminOf(f.contract)} onClick={() => save(f)}>{busy === f.label ? "…" : "Save"}</Button>
    </div>
  );

  const section = (title: string, admin: string, fields: Field[]) => (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/55">{title} <span className="ml-1 font-mono normal-case tracking-normal text-white/40">{shortenAddress(admin)}</span></p>
      <Card><CardContent className="divide-y divide-white/[0.06] p-0">{fields.map(fieldRow)}</CardContent></Card>
    </div>
  );

  return (
    <PageShell title="Admin" subtitle="On-chain AsePad / AseDex settings, signed by the admin wallet">
      {message && <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${message.ok ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200" : "border-red-500/30 bg-red-500/10 text-red-200"}`}>{message.text}</div>}
      {!wallet.address ? (
        <Card><CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <ShieldAlert className="h-8 w-8 text-white/40" />
          <p className="text-sm text-white/60">Connect the admin wallet to manage contracts.</p>
          <Button onClick={wallet.openConnect}>Connect admin wallet</Button>
        </CardContent></Card>
      ) : !data ? (
        <p className="text-sm text-white/70">Loading on-chain config…</p>
      ) : !isAdmin ? (
        <Card><CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <ShieldAlert className="h-8 w-8 text-red-400/70" />
          <p className="text-sm font-semibold text-red-200">Access denied</p>
          <p className="text-sm text-white/60">The connected wallet ({shortenAddress(me)}) is not an admin on AsePad, AseDex or the token factory.</p>
          <p className="text-xs text-white/45">Recognized admins: pad {shortenAddress(data.admins.pad)} · dex {shortenAddress(data.admins.dex)} · factory {shortenAddress(data.admins.factory)} · lock v2 {shortenAddress(data.admins.lock2)}</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
            <Card><CardContent className="p-4"><p className="text-[10px] uppercase text-white/60">Launches</p><p className="mt-1 text-xl font-bold">{data.stats?.launches ?? "-"}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-[10px] uppercase text-white/60">Registered tokens</p><p className="mt-1 text-xl font-bold">{data.standardCount}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-[10px] uppercase text-white/60">Real ASE TVL</p><p className="mt-1 text-xl font-bold">{data.stats ? fmtAseCompact(data.stats.tvlWei) : "-"}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-[10px] uppercase text-white/60">Total volume</p><p className="mt-1 text-xl font-bold">{data.stats ? fmtAseCompact(data.stats.volumeWei) : "-"}</p></CardContent></Card>
            <Card><CardContent className="flex items-center justify-between p-4"><div><p className="text-[10px] uppercase text-white/60">Status</p><p className={`mt-1 text-xl font-bold ${paused ? "text-amber-300" : "text-emerald-300"}`}>{paused ? "PAUSED" : "LIVE"}</p></div><Button size="sm" variant="secondary" disabled={Boolean(busy) || !isAdminOf("pad")} onClick={() => void run(paused ? "Unpause" : "Pause", data.pad, paused ? "unpause" : "pause", [])}>{paused ? "Unpause" : "Pause"}</Button></CardContent></Card>
          </div>

          {section("AsePad: bonding curve", data.pad, PAD_FIELDS)}
          {section("AseDex: exchange", data.dex, DEX_FIELDS)}
          {section("Token factory: ARC-20", data.factory, FACTORY_FIELDS)}

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/55">Token blue ticks <span className="ml-1 font-mono normal-case tracking-normal text-white/40">factory admin</span></p>
            <Card><CardContent className="p-0">
              <div className="flex flex-wrap items-center gap-3 px-5 py-4">
                <div className="min-w-[220px] flex-1">
                  <p className="font-medium">Grant / remove blue tick</p>
                  <p className="text-xs text-white/60">Marks a token as verified — the blue tick badge shows across AsePad/AseDex for every visitor. Stored in the API database.</p>
                </div>
                <Input className="w-72 font-mono text-xs" placeholder="token CA — ase1… or 0x…" value={tickAddr} onChange={(e) => setTickAddr(e.target.value)} disabled={!isAdminOf("factory")} />
                <Input className="w-44 font-mono text-xs" placeholder="tag — default: Verified by AsePad" value={tickTag} onChange={(e) => setTickTag(e.target.value)} disabled={!isAdminOf("factory")} />
                <span className="w-20 text-[10px] font-semibold">
                  {tickHex ? (verified.isFetching ? <span className="text-white/45">checking…</span>
                    : tickTicked ? <span className="text-sky-300">TICKED</span> : <span className="text-white/45">not ticked</span>)
                    : tickAddr.trim() ? <span className="text-red-300">bad address</span> : null}
                </span>
                <Button size="sm" disabled={Boolean(busy) || !isAdminOf("factory") || !tickHex} onClick={() => void grantTick(true)}>{busy === "Blue tick" ? "…" : "Give tick"}</Button>
                <Button size="sm" variant="secondary" disabled={Boolean(busy) || !isAdminOf("factory") || !tickHex} onClick={() => void grantTick(false)}>Remove</Button>
              </div>
              {tickList.length ? (
                <div className="flex flex-wrap gap-2 border-t border-white/[0.06] px-5 py-3">
                  {tickList.map((a) => (
                    <span key={a} className="inline-flex items-center gap-1.5 rounded-full border border-sky-400/30 bg-sky-400/10 px-2.5 py-1 font-mono text-[10px] text-sky-200">
                      {shortenAddress(a)}
                      <button onClick={() => void grantTick(false, a)} className="text-sky-300/70 transition hover:text-sky-100" title="Remove tick">✕</button>
                    </span>
                  ))}
                </div>
              ) : null}
            </CardContent></Card>
            <p className="mt-2 text-xs text-white/45">The list above is the database's live registry — reads and writes both go through <span className="font-mono">/api/verified</span>; a removed tick restores the migrated shield on pad tokens.</p>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/55">Actions &amp; recovery</p>
            <Card><CardContent className="divide-y divide-white/[0.06] p-0">
              {ACTIONS.map((a) => {
                const vals = actionDraft[a.key] ?? {};
                return (
                  <div key={a.key} className="flex flex-wrap items-center gap-3 px-5 py-4">
                    <div className="min-w-[220px] flex-1">
                      <p className="font-medium">{a.label}{a.danger ? <span className="ml-2 rounded-full border border-red-400/30 bg-red-400/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-red-300">danger</span> : null}</p>
                      <p className="text-xs text-white/60">{a.hint}</p>
                    </div>
                    {a.inputs.map((i) => (
                      <Input key={i.key} className="w-44 font-mono text-xs" placeholder={i.placeholder ?? i.label}
                        value={vals[i.key] ?? ""} disabled={!isAdminOf(a.contract)}
                        onChange={(e) => setActionDraft((d) => ({ ...d, [a.key]: { ...(d[a.key] ?? {}), [i.key]: e.target.value } }))} />
                    ))}
                    <Button size="sm" variant={a.danger ? "secondary" : "default"} disabled={Boolean(busy) || !isAdminOf(a.contract)} onClick={() => runAction(a)}>{busy === a.label ? "…" : "Run"}</Button>
                  </div>
                );
              })}
            </CardContent></Card>
            <p className="mt-2 text-xs text-white/55">Pad surplus ASE available for rescue: <span className="font-mono text-white/70">{fmtAse(data.surplus, 4)}</span>. Contracts: AsePad {shortenAddress(data.pad)} · AseDex {shortenAddress(data.dex)} · Factory {shortenAddress(data.factory)}.</p>
          </div>
        </div>
      )}
    </PageShell>
  );
}
