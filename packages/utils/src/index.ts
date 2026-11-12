import type { EcosystemRank } from "@asentrise/types";

export function levelFromXp(xp: number): number {
  return Math.max(1, Math.floor(Math.sqrt(xp / 100)) + 1);
}

export function rankFromXp(xp: number): EcosystemRank {
  if (xp >= 50_000) return "ecosystem_elite";
  if (xp >= 15_000) return "og";
  if (xp >= 5_000) return "contributor";
  if (xp >= 1_000) return "explorer";
  return "beginner";
}

export function rankLabel(rank: EcosystemRank): string {
  const labels: Record<EcosystemRank, string> = {
    beginner: "Beginner",
    explorer: "Explorer",
    contributor: "Contributor",
    og: "OG",
    ecosystem_elite: "Ecosystem Elite"
  };
  return labels[rank];
}

export function shortAddress(address: string, head = 6, tail = 4): string {
  if (address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

export function formatWeiToAse(wei: string | bigint): string {
  const w = typeof wei === "bigint" ? wei : BigInt(wei);
  const whole = w / 1_000_000_000_000_000_000n;
  const frac = w % 1_000_000_000_000_000_000n;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(18, "0").replace(/0+$/, "").slice(0, 4);
  return `${whole}.${fracStr}`;
}

export {
  TOKEN_STUDIO_ARCHETYPES,
  ARC20_CONTRACT_SOURCE_BY_ARCHETYPE,
  getArchetypeMeta,
  getArc20ContractSourceId,
  buildTokenomicsForArchetype,
  archetypeShowsField,
  formatExampleBasicsLine,
  formatExampleTokenomicsLines,
  validateTokenomicsForArchetype,
  buildDeployTokenomicsFromExamples,
  EMPTY_TOKENOMICS,
  type ArchetypeMeta,
  type TokenomicsValidationIssue,
  type ArchetypeBasicsExamples,
  type ArchetypeBasicsDefaults,
  type TokenomicsFieldKey
} from "./token-studio-archetypes";

export {
  isAseAddress,
  isHexAddress,
  isChainAddress,
  toAseAddress,
  toHexAddress,
  sameAddress,
  addressVariants
} from "./ase-address";

export { IMAGE_UPLOAD_MAX_BYTES, IMAGE_DATA_URL_MAX_CHARS } from "./image-upload-limits";

export { humanSupplyToBaseUnits, percentOfBaseUnits } from "./token-amounts";

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
