// Shared AseDex pad-gate cache — the token page clears a token's entry when
// its migration finalizes in-app so the next gate read refetches instead of
// holding a stale "locked" answer for the TTL.
import { toHexAddress } from "@asentrise/utils";

export type DexGate = { locked: boolean; migrating: boolean; status: string };
export const gateCache = new Map<string, { t: number; ttl: number; p: Promise<DexGate> }>();

export function dexGateInvalidate(token: string) {
  gateCache.delete(token.toLowerCase());
  try { gateCache.delete(toHexAddress(token).toLowerCase()); } catch { }
}
