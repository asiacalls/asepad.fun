import { AsentumContract } from "@asentum/sdk";
import type { AsentumNetworkConfig } from "@asentrise/config";
import type { TokenArchetype } from "@asentrise/types";
import { toAseAddress, toHexAddress } from "@asentrise/utils";
import { createAsentumClient } from "../client.js";

export type Arc20FactoryTokenRecord = {
  id: string;
  token: string;
  archetype: string;
  creator: string;
  config: string;
  registeredAt: string;
};

export type ParsedFactoryTokenConfig = {
  name: string;
  symbol: string;
  archetype: TokenArchetype;
  decimals?: number;
  totalSupply?: string;
};

export function parseArc20FactoryConfigJson(config: string): ParsedFactoryTokenConfig {
  try {
    const c = JSON.parse(config) as {
      name?: string;
      symbol?: string;
      archetype?: string;
      decimals?: number;
      totalSupply?: string;
    };
    const archetype = (c.archetype ?? "STANDARD") as TokenArchetype;
    return {
      name: c.name?.trim() || "Token",
      symbol: c.symbol?.trim() || "???",
      archetype,
      decimals: c.decimals,
      totalSupply: c.totalSupply
    };
  } catch {
    return { name: "Token", symbol: "???", archetype: "STANDARD" };
  }
}

/** Walk the on-chain ARC-20 factory registry (requires `getToken` on the deployed factory). */
export async function listArc20FactoryTokens(
  network: AsentumNetworkConfig,
  factoryAddress: string
): Promise<Arc20FactoryTokenRecord[]> {
  const client = createAsentumClient(network);
  const factory = new AsentumContract(client, toHexAddress(factoryAddress));
  const countRaw = await factory.view("tokenCount", []);
  const count = Number(countRaw ?? 0);
  if (!Number.isFinite(count) || count <= 0) return [];

  const tokens: Arc20FactoryTokenRecord[] = [];
  for (let i = 1; i <= count; i++) {
    try {
      const raw = await factory.view("getToken", [String(i)]);
      if (!raw) continue;
      const rec =
        typeof raw === "string"
          ? (JSON.parse(raw) as Arc20FactoryTokenRecord)
          : (raw as Arc20FactoryTokenRecord);
      if (rec?.token) tokens.push(rec);
    } catch {
      break;
    }
  }
  return tokens;
}

export function filterFactoryTokensByCreators(
  records: Arc20FactoryTokenRecord[],
  creatorAddresses: Set<string>
): Arc20FactoryTokenRecord[] {
  const creators = new Set([...creatorAddresses].map(toAseAddress));
  return records.filter((r) => creators.has(toAseAddress(String(r.creator))));
}
