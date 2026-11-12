import type { TokenArchetype } from "@asentrise/types";

export type TokenomicsFieldKey =
  | "buyTax"
  | "sellTax"
  | "burnPercent"
  | "reflectionPercent"
  | "treasuryWallet"
  | "marketingWallet"
  | "autoLiquidity"
  | "liquidityPercent"
  | "rewardToken"
  | "minHoldPercent"
  | "lpWallet"
  | "dexAddress"
  | "minSwapTokens"
  | "antiWhale"
  | "maxWalletPercent"
  | "maxTxPercent";

export type ArchetypeBasicsExamples = {
  totalSupply: string;
  decimals: number;
  name?: string;
  symbol?: string;
};

export type ArchetypeMeta = {
  id: TokenArchetype;
  label: string;
  description: string;
  /** Real-world analogue (for creator education, not legal advice). */
  marketAnalogue: string;
  highlights: string[];
  /** Fields shown in Token Studio step 2 for this archetype. */
  tokenomicsFields: TokenomicsFieldKey[];
  recommendedFields: TokenomicsFieldKey[];
  /** Shown as hints only — never pre-filled into the form. */
  exampleBasics: ArchetypeBasicsExamples;
  exampleTokenomics: Partial<Record<TokenomicsFieldKey, number | boolean | string>>;
  tokenomicsGuide: string;
  gasUnits: number;
  platformFeeWei: string;
};

/** @deprecated Use `ArchetypeBasicsExamples` */
export type ArchetypeBasicsDefaults = ArchetypeBasicsExamples;

export const EMPTY_TOKENOMICS: Record<TokenomicsFieldKey, number | boolean | string> = {
  buyTax: 0,
  sellTax: 0,
  burnPercent: 0,
  reflectionPercent: 0,
  treasuryWallet: "",
  marketingWallet: "",
  autoLiquidity: false,
  liquidityPercent: 0,
  rewardToken: "",
  minHoldPercent: 0,
  lpWallet: "",
  dexAddress: "",
  minSwapTokens: 0,
  antiWhale: false,
  maxWalletPercent: 0,
  maxTxPercent: 0
};

export const TOKEN_STUDIO_ARCHETYPES: ArchetypeMeta[] = [
  {
    id: "STANDARD",
    label: "Standard Token",
    description:
      "Plain fixed-supply ARC-20 — transfers with no buy/sell tax, burn, or reflection hooks.",
    marketAnalogue:
      "Utility & governance tokens (e.g. UNI, LINK-style ERC-20s): fixed cap, no transfer fee logic.",
    highlights: ["Fixed supply", "0% transfer tax", "Launch & LP separate"],
    tokenomicsFields: [],
    recommendedFields: [],
    exampleBasics: { totalSupply: "1000000000", decimals: 18, name: "Moon Protocol", symbol: "MOON" },
    exampleTokenomics: {},
    tokenomicsGuide:
      "Standard tokens do not apply on-chain tax, burn, or reflection. Allocate team, liquidity, and marketing off-chain or via your launchpad sale — same model as most CEX-listed utility tokens.",
    gasUnits: 180_000,
    platformFeeWei: "1000000000000000000"
  },
];

export function getArchetypeMeta(id: TokenArchetype): ArchetypeMeta {
  return TOKEN_STUDIO_ARCHETYPES.find((a) => a.id === id) ?? TOKEN_STUDIO_ARCHETYPES[0]!;
}

/** Empty tokenomics for form reset (no archetype presets in inputs). */
export function buildTokenomicsForArchetype(
  _id: TokenArchetype
): Record<TokenomicsFieldKey, number | boolean | string> {
  return { ...EMPTY_TOKENOMICS };
}

export function archetypeShowsField(id: TokenArchetype, field: TokenomicsFieldKey): boolean {
  return getArchetypeMeta(id).tokenomicsFields.includes(field);
}

const ASE_ADDRESS_RE = /^(ase1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{38}|0x[0-9a-fA-F]{40})$/;

export type TokenomicsValidationIssue = {
  path: TokenomicsFieldKey;
  message: string;
};

/** Client + API validation for step 2 tokenomics (archetype-aware). */
export function validateTokenomicsForArchetype(
  archetype: TokenArchetype,
  data: Partial<Record<TokenomicsFieldKey, unknown>>
): TokenomicsValidationIssue | null {
  const meta = getArchetypeMeta(archetype);
  const num = (key: TokenomicsFieldKey) => {
    const v = data[key];
    if (v === "" || v === undefined || v === null) return undefined;
    const n = Number(v);
    return Number.isNaN(n) ? undefined : n;
  };

  for (const field of ["treasuryWallet", "marketingWallet"] as const) {
    if (!meta.recommendedFields.includes(field)) continue;
    const addr = String(data[field] ?? "").trim();
    if (!ASE_ADDRESS_RE.test(addr)) {
      return { path: field, message: "Enter a valid ase1 wallet address" };
    }
  }

  // Reward token is optional — if set it must be a valid contract address.
  if (meta.tokenomicsFields.includes("rewardToken")) {
    const rt = String(data["rewardToken"] ?? "").trim();
    if (rt !== "" && !ASE_ADDRESS_RE.test(rt)) {
      return { path: "rewardToken", message: "Enter a valid ase1 token contract address" };
    }
  }

  if (data.antiWhale === true) {
    if (num("maxWalletPercent") == null) {
      return { path: "maxWalletPercent", message: "Max wallet % required when anti-whale is on" };
    }
    if (num("maxTxPercent") == null) {
      return { path: "maxTxPercent", message: "Max transaction % required when anti-whale is on" };
    }
  }

  if (data.autoLiquidity === true) {
    const lp = num("liquidityPercent");
    if (lp == null || lp <= 0) {
      return { path: "liquidityPercent", message: "LP % of tax required when auto-LP is on" };
    }
  }

  const buy = num("buyTax");
  const sell = num("sellTax");
  if (meta.recommendedFields.includes("buyTax") && buy == null && sell == null) {
    return { path: "buyTax", message: "Set at least buy or sell tax %" };
  }

  if (meta.recommendedFields.includes("burnPercent") && num("burnPercent") == null) {
    return { path: "burnPercent", message: "Set burn % per transfer" };
  }

  if (meta.recommendedFields.includes("reflectionPercent") && num("reflectionPercent") == null) {
    return { path: "reflectionPercent", message: "Set holder reflection %" };
  }

  return null;
}

/** Example tokenomics with real wallet addresses for deploy smoke tests. */
export function buildDeployTokenomicsFromExamples(
  archetype: TokenArchetype,
  walletAddress: string
): Record<TokenomicsFieldKey, number | boolean | string> {
  const base = buildTokenomicsForArchetype(archetype);
  const ex = getArchetypeMeta(archetype).exampleTokenomics;
  const wallet = walletAddress.toLowerCase();
  for (const [key, value] of Object.entries(ex)) {
    const k = key as TokenomicsFieldKey;
    if (k === "treasuryWallet" || k === "marketingWallet") {
      base[k] = wallet;
    } else if (typeof value === "boolean") {
      base[k] = value;
    } else if (typeof value === "number") {
      base[k] = value;
    } else if (typeof value === "string" && !value.startsWith("ase1…")) {
      base[k] = value;
    }
  }
  return base;
}

const FIELD_LABELS: Record<TokenomicsFieldKey, string> = {
  buyTax: "Buy tax",
  sellTax: "Sell tax",
  burnPercent: "Burn per transfer",
  reflectionPercent: "Holder reflection",
  treasuryWallet: "Treasury wallet",
  marketingWallet: "Marketing wallet",
  autoLiquidity: "Auto-liquidity",
  liquidityPercent: "LP share of tax",
  rewardToken: "Reward token",
  minHoldPercent: "Min hold % for rewards",
  lpWallet: "LP receiver wallet",
  dexAddress: "DEX router address",
  minSwapTokens: "Auto-release threshold",
  antiWhale: "Anti-whale",
  maxWalletPercent: "Max wallet %",
  maxTxPercent: "Max tx %"
};

function formatExampleValue(field: TokenomicsFieldKey, value: number | boolean | string): string {
  if (typeof value === "boolean") return value ? "on" : "off";
  if (typeof value === "number") {

    if (field.includes("Percent") || field.includes("Tax") || field === "burnPercent") return `${value}%`;
    return String(value);
  }
  return value;
}

/** Human-readable example lines for step 2 hint banner. */
export function formatExampleTokenomicsLines(id: TokenArchetype): string[] {
  const meta = getArchetypeMeta(id);
  const lines: string[] = [];
  for (const field of meta.tokenomicsFields) {
    const value = meta.exampleTokenomics[field];
    if (value === undefined || value === "") continue;
    lines.push(`${FIELD_LABELS[field]}: ${formatExampleValue(field, value)}`);
  }
  return lines;
}

/** Human-readable basics example for step 1 hint banner. */
export function formatExampleBasicsLine(id: TokenArchetype): string {
  const ex = getArchetypeMeta(id).exampleBasics;
  const parts = [
    ex.name ? `name “${ex.name}”` : null,
    ex.symbol ? `ticker ${ex.symbol}` : null,
    `supply ${Number(ex.totalSupply).toLocaleString()}`,
    `${ex.decimals} decimals`
  ].filter(Boolean);
  return parts.join(" · ");
}

/** On-chain ARC-20 source file id (matches `packages/contracts/src/sources/*.js`). */
export const ARC20_CONTRACT_SOURCE_BY_ARCHETYPE: Record<TokenArchetype, string> = {
  STANDARD: "arc20-base"
};

export function getArc20ContractSourceId(archetype: TokenArchetype): string {
  return ARC20_CONTRACT_SOURCE_BY_ARCHETYPE[archetype];
}
