import type { AsentumNetworkConfig } from "@asentrise/config";
import { createAsentumClient } from "./client.js";
import { contractHasCode, resolveDeployAddressFromTx } from "./on-chain-utils.js";

export type ReconcileTokenDeployResult = {
  status: "DEPLOYED" | "DEPLOYING" | "FAILED";
  tokenAddress?: string;
  message?: string;
};

/** Re-check chain when DB says failed/deploying but a deploy tx may have succeeded. */
export async function reconcileTokenDeployFromChain(
  network: AsentumNetworkConfig,
  input: {
    deployTxHash: string | null;
    tokenAddress: string | null;
  }
): Promise<ReconcileTokenDeployResult> {
  const client = createAsentumClient(network);

  if (input.tokenAddress) {
    const ok = await contractHasCode(client, input.tokenAddress, 3_000);
    if (ok) {
      return { status: "DEPLOYED", tokenAddress: input.tokenAddress };
    }
  }

  if (!input.deployTxHash) {
    return { status: "FAILED", message: "No deploy transaction hash" };
  }

  const resolved = await resolveDeployAddressFromTx(client, input.deployTxHash, 45_000);
  if (resolved.tokenAddress) {
    return { status: "DEPLOYED", tokenAddress: resolved.tokenAddress };
  }
  if (resolved.reverted) {
    return { status: "FAILED", message: "Deploy transaction reverted on chain" };
  }
  if (!resolved.receipt) {
    return { status: "DEPLOYING", message: "Deploy transaction still confirming" };
  }

  return { status: "FAILED", message: "Deploy mined but contract address could not be resolved" };
}
