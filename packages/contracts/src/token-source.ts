// Deep import: the self-contained module keeps this builder loadable by plain Node (sim).
import { toAseAddress, toHexAddress } from "@asentrise/utils/dist/ase-address.js";
import { ARC20_BASE_LEGACY_SOURCES, ARC20_BASE_SOURCE, ARC20_PAD_LEGACY_SOURCES, ARC20_PAD_SOURCE, ARC20_TAX_LEGACY_SOURCES, ARC20_TAX_SOURCE } from "./generated/browser-sources.js";

/**
 * Builds the exact token source a creator deploys. Genesis (name, symbol,
 * supply, creator, socials, …) is baked in, so the token needs no init tx,
 * and a readable token card is prepended so explorers show it first.
 */
const GENESIS_PLACEHOLDER = "/*__ASEPAD_GENESIS__*/null";
const HEADER_PLACEHOLDER = "// __ASEPAD_TOKEN_HEADER__";

export type TokenMetadata = { description?: string; logoUrl?: string; website?: string; twitter?: string; telegram?: string };
export type TokenGenesis = { name: string; symbol: string; decimals: string; supply: string; creator: string; metadata: string };

// Header text sits inside `//` comments: strip every JS line terminator
// (incl. U+2028/U+2029) and control char so user input can't escape the comment.
function commentSafe(v: unknown, max = 200): string {
  return String(v ?? "").replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
function asUrl(kind: "website" | "twitter" | "telegram" | "logo", raw?: string): string {
  const v = commentSafe(raw);
  if (!v) return "";
  // Data URIs are kept whole in card metadata (what the frontend reads) —
  // writing them into the source header would truncate at 200 chars and
  // prefix https:// anyway. ipfs:// goes through the pinata gateway.
  if (/^data:/i.test(v)) return "";
  if (/^ipfs:\/\//i.test(v)) return `https://gateway.pinata.cloud/ipfs/${v.slice(7)}`;
  if (/^https?:\/\//i.test(v)) return v;
  const handle = v.replace(/^@/, "");
  if (kind === "twitter" && /^[\w.]+$/.test(handle)) return `https://x.com/${handle}`;
  if (kind === "telegram" && /^[\w.]+$/.test(handle)) return `https://t.me/${handle}`;
  return `https://${v}`;
}
function parseMeta(raw: string): TokenMetadata {
  try {
    const m = JSON.parse(raw || "{}");
    return m && typeof m === "object" && !Array.isArray(m) ? m : {};
  } catch { return {}; }
}

export function tokenSourceHeader(g: TokenGenesis): string {
  const m = parseMeta(g.metadata);
  const rows: [string, string][] = [
    ["About", commentSafe(m.description)],
    ["Website", asUrl("website", m.website)],
    ["X", asUrl("twitter", m.twitter)],
    ["Telegram", asUrl("telegram", m.telegram)],
    ["Logo", asUrl("logo", m.logoUrl)]
  ];
  const bar = "// ═════════════════════════════════════════════════════════════════════";
  return [
    bar,
    `// $${commentSafe(g.symbol, 20)} · ${commentSafe(g.name, 80)}`,
    ...rows.filter(([, v]) => v).map(([k, v]) => `// ${k}: ${v}`),
    `// Creator: ${toAseAddress(g.creator) || toHexAddress(g.creator)}`,
    bar
  ].join("\n");
}

function build(template: string, genesis: Record<string, string>, g: TokenGenesis): string {
  if (!template.includes(GENESIS_PLACEHOLDER) || !template.includes(HEADER_PLACEHOLDER)) {
    throw new Error("Token source template is missing its genesis/header slots");
  }
  // JSON.stringify leaves U+2028/U+2029 raw; escape them so no JS engine can see a line break.
  const literal = JSON.stringify(genesis).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  // Function replacers: `$&`-style patterns in user text must not be interpreted.
  return template.replace(HEADER_PLACEHOLDER, () => tokenSourceHeader(g)).replace(GENESIS_PLACEHOLDER, () => literal);
}

/** AsePad launch token: full supply credited to the bound AsePad at genesis. */
export function buildPadTokenSource(g: TokenGenesis & { pad: string }): string {
  return build(ARC20_PAD_SOURCE, {
    name: g.name, symbol: g.symbol, decimals: g.decimals, supply: g.supply,
    pad: toHexAddress(g.pad), creator: toHexAddress(g.creator), metadata: g.metadata
  }, g);
}

/** Standard ARC-20: full supply credited to the creator at genesis. */
export function buildStandardTokenSource(g: TokenGenesis): string {
  return build(ARC20_BASE_SOURCE, {
    name: g.name, symbol: g.symbol, decimals: g.decimals, supply: g.supply,
    creator: toHexAddress(g.creator), metadata: g.metadata
  }, g);
}

/** Tax ARC-20: fixed supply + genesis-locked buy/sell tax (≤4% per side, no honeypot knob). */
export function buildTaxTokenSource(g: TokenGenesis & {
  dex: string; dex2?: string;
  buyTaxBps: string; sellTaxBps: string; taxWallet?: string;
}): string {
  return build(ARC20_TAX_SOURCE, {
    name: g.name, symbol: g.symbol, decimals: g.decimals, supply: g.supply,
    creator: toHexAddress(g.creator), metadata: g.metadata,
    dex: toHexAddress(g.dex),
    dex2: g.dex2 ? toHexAddress(g.dex2) : "",
    buyTaxBps: g.buyTaxBps, sellTaxBps: g.sellTaxBps,
    taxWallet: g.taxWallet ? toHexAddress(g.taxWallet) : toHexAddress(g.creator)
  }, g);
}

// ── Source verification ──────────────────────────────────────────────────
// A launched token's on-chain source must equal our template except in the
// two stamped regions: the `//` header card and the genesis JSON literal.
// The genesis wildcard only matches a flat JSON object — braces inside it
// may appear solely inside quoted strings — so injected code can't hide in
// the variable regions.
const JSON_OBJECT_RE = "\\{(?:[^\"{}\\\\]|\\\\.|\"(?:[^\"\\\\]|\\\\.)*\")*\\}";
function templateVerifier(template: string): RegExp {
  const hi = template.indexOf(HEADER_PLACEHOLDER);
  const gi = template.indexOf(GENESIS_PLACEHOLDER);
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    "^" + esc(template.slice(0, hi)) +
    "(?://[^\\n]*\\n?)*" +
    esc(template.slice(hi + HEADER_PLACEHOLDER.length, gi)) +
    JSON_OBJECT_RE +
    esc(template.slice(gi + GENESIS_PLACEHOLDER.length)) + "$"
  );
}
// Every retired template version deployed on-chain lives in src/legacy/ so
// legitimately launched tokens keep verifying after template upgrades.
// When a template changes, snapshot the previous version there first.
const PAD_SOURCE_RES = [ARC20_PAD_SOURCE, ...ARC20_PAD_LEGACY_SOURCES].map(templateVerifier);
const BASE_SOURCE_RES = [ARC20_BASE_SOURCE, ...ARC20_BASE_LEGACY_SOURCES].map(templateVerifier);
const TAX_SOURCE_RES = [ARC20_TAX_SOURCE, ...ARC20_TAX_LEGACY_SOURCES].map(templateVerifier);
export type TokenVerification = "verified-pad" | "verified-standard" | "verified-tax" | "unverified";
/** Classify a deployed source string against the canonical AsePad templates. */
export function verifyTokenSourceString(src: string): TokenVerification {
  // Some early deployments went on-chain with CRLF line endings. Normalize
  // before matching: identical code must not fail verification on \r bytes.
  const code = src.replace(/\r\n?/g, "\n");
  if (PAD_SOURCE_RES.some((re) => re.test(code))) return "verified-pad";
  if (BASE_SOURCE_RES.some((re) => re.test(code))) return "verified-standard";
  if (TAX_SOURCE_RES.some((re) => re.test(code))) return "verified-tax";
  return "unverified";
}
