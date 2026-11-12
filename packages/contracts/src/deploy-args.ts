import type { TokenArchetype } from "@asentrise/types";
import { humanSupplyToBaseUnits } from "@asentrise/utils";
import { ARC20_ARCHETYPE_SOURCES } from "./manifest.js";

export type TokenomicsDeployInput = {
  treasuryWallet?: string;
  marketingWallet?: string;
  lpWallet?: string;
};

export type TokenDeployInput = {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  archetype: TokenArchetype;
  tokenomics?: TokenomicsDeployInput;
  treasuryWallet?: string;
  marketingWallet?: string;
  lpWallet?: string;
};

/** Build `init(...)` args for the archetype contract. */
export function buildArc20InitArgs(input: TokenDeployInput): unknown[] {
  const { name, symbol, decimals, totalSupply } = input;
  const supply = humanSupplyToBaseUnits(totalSupply, decimals);
  return [name, symbol, String(decimals), supply];
}

/** Archetype params object for the factory's `createToken` call. */
export function buildArc20ParamsJson(_input: TokenDeployInput): Record<string, unknown> {
  return {};
}

/** JSON snapshot stored on the ARC-20 factory registry at deploy time. */
export function buildArc20FactoryConfigJson(input: TokenDeployInput): string {
  return JSON.stringify({
    name: input.name,
    symbol: input.symbol,
    decimals: input.decimals,
    totalSupply: input.totalSupply,
    archetype: input.archetype,
    contractSource: ARC20_ARCHETYPE_SOURCES[input.archetype],
    tokenomics: input.tokenomics ?? {},
    initArgs: buildArc20InitArgs(input)
  });
}
