import { createAsentumClient } from "./client";
import { deployArc20FromStudio, type DeployTokenResult } from "./contracts/deploy-token";
import { tryResolveDeployerKeyMaterial } from "./resolve-deployer-wallet";
import type { AsentumNetworkConfig } from "@asentrise/config";
import type { TokenDeployInput } from "@asentrise/contracts";

export type Arc20DeployParams = TokenDeployInput;

export type Arc20DeployResult = DeployTokenResult;

/**
 * ARC-20 deployment — uses @asentrise/contracts sources + optional factory registry.
 */
export async function deployArc20Token(
  network: AsentumNetworkConfig,
  params: Arc20DeployParams,
  factoryAddress: string | null,
  deployerSecretKey?: string | null,
  deployerPublicKey?: string | null,
  creatorAddress?: string | null
): Promise<Arc20DeployResult> {
  const resolved = tryResolveDeployerKeyMaterial();
  const secret = deployerSecretKey ?? resolved?.secretKeyHex ?? null;
  const pub = deployerPublicKey ?? resolved?.publicKeyHex ?? null;

  if (!secret || !pub) {
    const client = createAsentumClient(network);
    const healthy = await client.isHealthy();
    if (!healthy) {
      return { status: "failed", message: "Asentum RPC unavailable" };
    }
    return {
      status: "queued",
      message:
        "Set DEPLOYER_PRIVATE_KEY (Asentum wallet) and CONTRACT_ARC20_FACTORY to enable on-chain deploy."
    };
  }

  return deployArc20FromStudio(network, secret, pub, params, factoryAddress, creatorAddress);
}
