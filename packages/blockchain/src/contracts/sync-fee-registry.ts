import { AsentumClient, AsentumContract, AsentumWallet } from "@asentum/sdk";
import type { AsentumNetworkConfig } from "@asentrise/config";
import { toHexAddress } from "@asentrise/utils";
import { createAsentumClient } from "../client.js";

export type FeeRegistrySyncItem = {
  feeKey: string;
  amountWei: string;
  kind: "wei" | "bps";
};

export type SyncFeeRegistryResult = {
  status: "synced" | "skipped" | "failed";
  txHashes?: string[];
  message?: string;
};

export function isBpsFeeKey(feeKey: string): boolean {
  return feeKey.includes("_bps") || feeKey.endsWith(":bps");
}

/**
 * Push admin fee table to on-chain Platform Fee Registry (deployer must be registry admin).
 */
export async function syncFeesToRegistry(
  network: AsentumNetworkConfig,
  registryAddress: string,
  signerSecretKey: string,
  signerPublicKey: string,
  fees: FeeRegistrySyncItem[]
): Promise<SyncFeeRegistryResult> {
  if (!registryAddress) {
    return { status: "skipped", message: "CONTRACT_PLATFORM_FEES not set" };
  }

  try {
    const client = createAsentumClient(network);
    const wallet = AsentumWallet.fromSecretKey(client, signerSecretKey, signerPublicKey);
    const registry = new AsentumContract(client, toHexAddress(registryAddress)).connect(wallet);
    const txHashes: string[] = [];

    for (const fee of fees) {
      const method = fee.kind === "bps" ? "setFeeBps" : "setFee";
      const tx = await registry.send(method, [fee.feeKey, fee.amountWei]);
      if (tx.hash) txHashes.push(tx.hash);
      if (tx.wait) await tx.wait();
    }

    return { status: "synced", txHashes };
  } catch (e) {
    return {
      status: "failed",
      message: e instanceof Error ? e.message : "registry sync failed"
    };
  }
}

export async function readFeeWeiFromRegistry(
  network: AsentumNetworkConfig,
  registryAddress: string,
  feeKey: string
): Promise<string | null> {
  try {
    const client = createAsentumClient(network);
    const registry = new AsentumContract(client, toHexAddress(registryAddress));
    const v = await registry.view("getFeeWei", [feeKey]);
    return String(v);
  } catch {
    return null;
  }
}

export async function readFeeBpsFromRegistry(
  network: AsentumNetworkConfig,
  registryAddress: string,
  feeKey: string
): Promise<string | null> {
  try {
    const client = createAsentumClient(network);
    const registry = new AsentumContract(client, toHexAddress(registryAddress));
    const v = await registry.view("getFeeBps", [feeKey]);
    return String(v);
  } catch {
    return null;
  }
}
