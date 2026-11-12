import { z } from "zod";
import { getAsentumNetworkFromEnv, type AsentumNetworkConfig } from "./asentum";

const contractKeys = [
  "platform_fees",
  "arc20_factory",
  "arc21_scheduler",
  "campaign_rewards",
  "launchpad",
  "reputation",
  "asepad",
  "asedex"
] as const;


/** Env keys: CONTRACT_ARC20_FACTORY, CONTRACT_LAUNCHPAD, etc. */

export type ContractKey = (typeof contractKeys)[number];

/** Five contracts deployed by `pnpm contracts:deploy` (excludes genesis ARC-21 scheduler). */
export const PLATFORM_DEPLOYED_CONTRACT_KEYS = [
  "platform_fees",
  "arc20_factory",
  "launchpad",
  "campaign_rewards",
  "reputation",
  "asepad",
  "asedex"
] as const satisfies readonly ContractKey[];

export type PlatformDeployedContractKey = (typeof PLATFORM_DEPLOYED_CONTRACT_KEYS)[number];

export function countPlatformDeployedContracts(
  contracts: Record<ContractKey, string | null>
): { ready: number; total: number } {
  const keys = PLATFORM_DEPLOYED_CONTRACT_KEYS;
  const ready = keys.filter((k) => Boolean(contracts[k])).length;
  return { ready, total: keys.length };
}

const platformEnvSchema = z.object({
  ASENTRISE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PLATFORM_NAME: z.string().default("AsePad"),
  WEB_URL: z.string().url(),
  API_URL: z.string().url(),
  ADMIN_URL: z.string().url().optional(),
  STORAGE_URL: z.string().url().optional(),
  ASENTUM_NETWORK_KEY: z.string().optional(),
  ASENTUM_NETWORK_NAME: z.string().optional(),
  ASENTUM_RPC_HTTP: z.string().url().optional(),
  ASENTUM_RPC_WS: z.string().url().optional(),
  ASENTUM_EXPLORER_BASE_URL: z.string().url().optional(),
  ASENTUM_CHAIN_ID: z.string().optional()
});

export type PlatformConfig = {
  env: "development" | "test" | "production";
  name: string;
  webUrl: string;
  apiUrl: string;
  adminUrl: string;
  storageUrl: string | null;
  network: AsentumNetworkConfig;
  contracts: Record<ContractKey, string | null>;
};

function contractAddress(env: NodeJS.ProcessEnv, key: ContractKey): string | null {
  const envKey = `CONTRACT_${key.toUpperCase()}`;
  const v = env[envKey];
  return v && v.length > 0 ? v : null;
}

/** Central platform config — no hardcoded RPC, chain IDs, or contract addresses. */
export function getPlatformConfig(env: NodeJS.ProcessEnv = process.env): PlatformConfig {
  const parsed = platformEnvSchema.parse(env);
  const network = getAsentumNetworkFromEnv({
    ASENTUM_NETWORK_KEY: env.ASENTUM_NETWORK_KEY,
    ASENTUM_NETWORK_NAME: env.ASENTUM_NETWORK_NAME,
    ASENTUM_RPC_HTTP: env.ASENTUM_RPC_HTTP,
    ASENTUM_RPC_WS: env.ASENTUM_RPC_WS,
    ASENTUM_EXPLORER_BASE_URL: env.ASENTUM_EXPLORER_BASE_URL,
    ASENTUM_CHAIN_ID: env.ASENTUM_CHAIN_ID
  });

  return {
    env: parsed.ASENTRISE_ENV,
    name: parsed.PLATFORM_NAME,
    webUrl: parsed.WEB_URL,
    apiUrl: parsed.API_URL,
    adminUrl: parsed.ADMIN_URL ?? "http://localhost:3001",
    storageUrl: parsed.STORAGE_URL ?? null,
    network,
    contracts: Object.fromEntries(
      contractKeys.map((k) => [k, contractAddress(env, k)])
    ) as Record<ContractKey, string | null>
  };
}

export function explorerAddressUrl(config: PlatformConfig, address: string): string {
  const base = config.network.explorerBaseUrl ?? "https://explorer.asentum.com";
  return `${base.replace(/\/$/, "")}/address/${address}`;
}

export function explorerTxUrl(config: PlatformConfig, txHash: string): string {
  const base = config.network.explorerBaseUrl ?? "https://explorer.asentum.com";
  return `${base.replace(/\/$/, "")}/tx/${txHash}`;
}
