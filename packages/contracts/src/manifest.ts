import type { TokenArchetype } from "@asentrise/types";
import type { ContractKey } from "@asentrise/config";

/** Deployable platform contracts — sources live in ./sources/*.js */
export type PlatformContractId =
  | "platform-fee-registry"
  | "arc20-base"
  | "arc20-factory"
  | "launch-sale-factory"
  | "campaign-rewards"
  | "reputation-registry"
  | "asepad"
  | "asedex"
  | "arc20-pad";

export type ContractManifestEntry = {
  id: PlatformContractId;
  name: string;
  description: string;
  envKey: ContractKey;
  /** Call after deploy */
  initMethod?: string;
  initArgs?: unknown[];
  upgradeable: boolean;
  module: "token" | "launchpad" | "growth" | "reputation" | "future";
};

/** Core infrastructure deployed once per network via `pnpm contracts:deploy`. */
export const PLATFORM_CONTRACTS: ContractManifestEntry[] = [
  {
    id: "arc20-factory",
    name: "ARC-20 Factory Registry",
    description: "Registers tokens created through AsePad Token Studio",
    envKey: "arc20_factory",
    initMethod: "init",
    initArgs: [], // filled with deployer at deploy time
    upgradeable: true,
    module: "token"
  },
  {
    id: "asedex",
    name: "AseDex Exchange",
    description: "Official AsePad constant-product exchange with 0.30% treasury swap fee and AsePad migration support",
    envKey: "asedex",
    initMethod: "init",
    initArgs: [], // filled with admin/pad at deploy time
    upgradeable: true,
    module: "launchpad"
  },
  {
    id: "asepad",
    name: "ASEPAD Bonding Launchpad",
    description: "Official AsePad bonding-curve token launches with $4k virtual-cap pricing, migrates to AseDex",
    envKey: "asepad",
    initMethod: "init",
    initArgs: [], // filled with admin/treasury/dex/fees at deploy time
    upgradeable: true,
    module: "token"
  }
];

/** Per-archetype token templates (deployed per token via Token Studio). */
export const ARC20_ARCHETYPE_SOURCES: Record<TokenArchetype, PlatformContractId> = {
  STANDARD: "arc20-base"
};

