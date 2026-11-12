import { AsentumWallet } from "@asentum/sdk";
import { toHexAddress } from "@asentrise/utils";
import { createAsentumClient } from "../client.js";
import type { AsentumNetworkConfig } from "@asentrise/config";
import type { ContractKey } from "@asentrise/config";

export type RescueKind = "ase" | "token" | "token-all";

export type RescueParams = {
  contractAddress: string;
  kind: RescueKind;
  toAddress: string;
  /** Wei string for ASE or token amount; ignored for token-all */
  amount?: string;
  /** ARC-20 token contract when kind is token* */
  tokenAddress?: string;
};

export type RescueResult = {
  status: "sent" | "failed";
  txHash?: string;
  message?: string;
};

/**
 * Invoke rescue* on a deployed platform or token contract (owner must be deployer wallet).
 */
export async function executeContractRescue(
  network: AsentumNetworkConfig,
  signerSecretKey: string,
  signerPublicKey: string,
  params: RescueParams
): Promise<RescueResult> {
  try {
    const client = createAsentumClient(network);
    const wallet = AsentumWallet.fromSecretKey(client, signerSecretKey, signerPublicKey);
    const to = params.toAddress.toLowerCase();

    let method: string;
    let args: unknown[];

    if (params.kind === "ase") {
      if (!params.amount) return { status: "failed", message: "amount required for ASE rescue" };
      method = "rescueAse";
      args = [to, params.amount];
    } else if (params.kind === "token-all") {
      if (!params.tokenAddress) return { status: "failed", message: "tokenAddress required" };
      method = "rescueAllToken";
      args = [params.tokenAddress.toLowerCase(), to];
    } else {
      if (!params.tokenAddress || !params.amount) {
        return { status: "failed", message: "tokenAddress and amount required" };
      }
      method = "rescueToken";
      args = [params.tokenAddress.toLowerCase(), to, params.amount];
    }

    const tx = await wallet.sendCall({
      to: toHexAddress(params.contractAddress),
      method,
      args
    });

    return { status: "sent", txHash: tx.hash };
  } catch (e) {
    return { status: "failed", message: e instanceof Error ? e.message : "rescue failed" };
  }
}

/** Resolve env CONTRACT_* address for a platform module. */
export function contractAddressFromEnv(
  contracts: Record<ContractKey, string | null>,
  key: ContractKey
): string | null {
  return contracts[key];
}
