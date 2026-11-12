"use client";

import { safeBig } from "@/lib/asepad";
import { toHexAddress } from "@asentrise/utils";
import { cn } from "@/lib/cn";
import { apiLocks } from "@/lib/ase-api";

// Shared by the /lock list and the /lock/<id> detail page.
export const LOCK = (process.env.NEXT_PUBLIC_CONTRACT_LOCK || "0xf3ae3ad546263cb8fe761dc22209c7b8f434244d").toLowerCase();
// AseLock v2 — new locks deploy here; v1 stays live for existing locks (watch/claim).
export const LOCK_V2 = (process.env.NEXT_PUBLIC_CONTRACT_LOCK_V2 || "0x73622dfbb0f43c033d634996a1ea3787f1516232").toLowerCase();
export const DEX = (process.env.NEXT_PUBLIC_CONTRACT_ASEDEX || process.env.CONTRACT_ASEDEX || "").toLowerCase();
export const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

// ── lock record shapes (mirrors contracts/futures-lp-lock.js storage) ─────────
export type Bene = { addr: string; wei: string; claimed: string };
export type LockRec = {
  kind: "LP" | "TOKEN" | "VEST" | "VESTM";
  owner: string;
  poolId?: string;
  token?: string;
  amt: string;
  unlockTs?: string;   // ms
  startMs?: string;
  endMs?: string;
  claimedWei?: string;
  benes?: Bene[];
  createdTs: string;
  state: "LOCKED" | "RELEASED" | "BURNED";
};
export type LockRow = { id: string; rec: LockRec; lock?: string };
export type TokenMeta = { symbol: string; decimals: number };
export type PoolMeta = { token0: string; token1: string };

export const KIND_LABEL: Record<LockRec["kind"], string> = { LP: "LP lock", TOKEN: "Token lock", VEST: "Vesting", VESTM: "Vesting ×N" };
export const KIND_CLS: Record<LockRec["kind"], string> = {
  LP: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  TOKEN: "border-chrome-400/30 bg-white/[0.06] text-chrome-200",
  VEST: "border-violet-400/30 bg-violet-400/10 text-violet-300",
  VESTM: "border-violet-400/30 bg-violet-400/10 text-violet-300"
};
export const STATE_CLS: Record<LockRec["state"], string> = {
  LOCKED: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  RELEASED: "border-white/15 bg-white/[0.05] text-white/60",
  BURNED: "border-orange-400/30 bg-orange-400/10 text-orange-300"
};

// "12.345" + decimals → wei string (no float math — pure string slicing)
export function toWeiStr(amount: string, decimals: number): string | null {
  const t = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const [i, f = ""] = t.split(".");
  const frac = (f + "0".repeat(decimals)).slice(0, decimals);
  const wei = BigInt(i) * 10n ** BigInt(decimals) + BigInt(frac || "0");
  return wei.toString();
}
export const fmtWei = (wei: string, decimals: number) => {
  try {
    const v = safeBig(wei);
    const base = 10n ** BigInt(decimals);
    const whole = v / base, rem = v % base;
    const frac = rem.toString().padStart(decimals, "0").slice(0, 4).replace(/0+$/, "");
    const num = `${whole.toLocaleString()}${frac ? "." + frac : ""}`;
    return num;
  } catch { return "0"; }
};
export const fmtDate = (ms?: string) => (ms ? new Date(Number(ms)).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "-");
export const timeLeft = (ms?: string) => {
  if (!ms) return "-";
  const d = Number(ms) - Date.now();
  if (d <= 0) return "unlocked";
  const days = Math.floor(d / 86400000), hrs = Math.floor((d % 86400000) / 3600000);
  return days > 0 ? `${days}d ${hrs}h left` : `${hrs}h ${Math.floor((d % 3600000) / 60000)}m left`;
};
// View results arrive as JSON strings (sometimes double-encoded) or already
// parsed — normalize to a value.
export const asJson = (v: unknown): any => {
  let x = v;
  for (let i = 0; i < 2 && typeof x === "string"; i++) { try { x = JSON.parse(x); } catch { break; } }
  return x ?? null;
};
export const normToken = (v: string) => { try { const h = toHexAddress(v.trim()); return /^0x[0-9a-f]{40}$/.test(h) ? h.toLowerCase() : null; } catch { return null; } };

// Full lock sweep — shared by /lock (list/detail) and AseDex lock badges via
// the ["aselock-all"] query key. `next` holds the LAST assigned lock id
// (lock #1 exists when next = "1"); one spare id covers a mid-read create.
export const locksFromApi = (locks: { lock_id: string; raw_json: string | null }[] | undefined): LockRow[] => {
  const out: LockRow[] = [];
  for (const l of locks ?? []) {
    try {
      const rec = (l.raw_json ? JSON.parse(l.raw_json) : null) as LockRec | null;
      // Indexed lock_id is "<contract>:<id>" (v1/v2 share numeric ids);
      // pre-migration rows are bare ids → v1.
      const ci = l.lock_id.indexOf(":");
      const lock = ci > 0 ? l.lock_id.slice(0, ci).toLowerCase() : LOCK;
      const lid = ci > 0 ? l.lock_id.slice(ci + 1) : l.lock_id;
      if (rec && rec.owner) { if (!rec.state) rec.state = "LOCKED"; out.push({ id: lid, rec, lock }); }
    } catch { /* skip malformed */ }
  }
  return out.reverse();
};

export async function fetchAllLocks(): Promise<LockRow[]> {
  // DB fast path — one API read replaces the whole getLock sweep. raw_json
  // carries the full contract record, so the row shape stays identical.
  const api = await apiLocks().catch(() => null);
  const out = locksFromApi(api?.locks);
  // No chain fallback — a dark ops shard keeps the last snapshot, it never
  // triggers an exportState + getLock sweep.
  return out;
}

export async function fetchMyLocks(ownerHex: string): Promise<LockRow[] | null> {
  // Same AWS row source, wallet-scoped. null = API unreachable (caller may
  // fall back to chain); an empty list is a real answer, not a failure.
  const api = await apiLocks(undefined, ownerHex).catch(() => null);
  return api ? locksFromApi(api.locks) : null;
}

export const Panel = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("rounded-2xl border border-white/[0.08] bg-black/30 backdrop-blur-md", className)}>{children}</div>
);
