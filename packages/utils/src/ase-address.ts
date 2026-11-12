/**
 * Asentum native addresses: 20 bytes encoded as classic bech32 with HRP "ase" (e.g. `ase1hwam…g6vkq4`).
 * Wallets/RPC may still hand out the legacy `0x` + 40 hex form of the same 20 bytes.
 */

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const HRP = "ase";
const HEX_RE = /^0x[0-9a-fA-F]{40}$/;
const ASE_RE = /^ase1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{38}$/;

function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= GENERATORS[i]!;
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const codes = [...hrp].map((c) => c.charCodeAt(0));
  return [...codes.map((c) => c >> 5), 0, ...codes.map((c) => c & 31)];
}

function convertBits(data: number[], from: number, to: number, pad: boolean): number[] | null {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const maxv = (1 << to) - 1;
  for (const value of data) {
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) out.push((acc << (to - bits)) & maxv);
  } else if (bits >= from || ((acc << (to - bits)) & maxv)) {
    return null;
  }
  return out;
}

function hexToBytes(hex: string): number[] {
  return hex.slice(2).match(/../g)!.map((b) => parseInt(b, 16));
}

export function isAseAddress(value: string): boolean {
  const lower = value.toLowerCase();
  if (!ASE_RE.test(lower)) return false;
  const data = [...lower.slice(4)].map((c) => CHARSET.indexOf(c));
  return polymod([...hrpExpand(HRP), ...data]) === 1;
}

export function isHexAddress(value: string): boolean {
  return HEX_RE.test(value);
}

/** Any valid Asentum account/contract address (ase1 or legacy 0x). */
export function isChainAddress(value: string): boolean {
  return isAseAddress(value) || isHexAddress(value);
}

/** Canonical `ase1…` form. Returns the input unchanged if it is not a recognizable address. */
export function toAseAddress(value: string): string {
  const trimmed = value.trim();
  if (isAseAddress(trimmed)) return trimmed.toLowerCase();
  if (!isHexAddress(trimmed)) return trimmed;
  const data = convertBits(hexToBytes(trimmed), 8, 5, true)!;
  const mod = polymod([...hrpExpand(HRP), ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = [0, 1, 2, 3, 4, 5].map((i) => (mod >> (5 * (5 - i))) & 31);
  return `${HRP}1${[...data, ...checksum].map((v) => CHARSET[v]).join("")}`;
}

/** Legacy `0x…` lowercase hex form. Returns the input lowercased if it is not a recognizable address. */
export function toHexAddress(value: string): string {
  const trimmed = value.trim();
  if (isHexAddress(trimmed)) return trimmed.toLowerCase();
  if (!isAseAddress(trimmed)) return trimmed.toLowerCase();
  const data = [...trimmed.toLowerCase().slice(4, -6)].map((c) => CHARSET.indexOf(c));
  const bytes = convertBits(data, 5, 8, false)!;
  return `0x${bytes.map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** True when both strings are the same 20-byte address, in either format. */
export function sameAddress(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return toAseAddress(a) === toAseAddress(b.trim()) || a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Both encodings of an address, for DB lookups over legacy rows. */
export function addressVariants(value: string): string[] {
  return [...new Set([toAseAddress(value), toHexAddress(value)])];
}
