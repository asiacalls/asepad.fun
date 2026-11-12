import type { AsentumNetworkConfig } from "@asentrise/config";
import type { LaunchSaleDeployInput } from "@asentrise/contracts";
import { deployLaunchSale, type DeployLaunchSaleResult } from "./contracts/deploy-launch-sale.js";
import { tryResolveDeployerKeyMaterial } from "./resolve-deployer-wallet.js";

export type LaunchSaleDeployParams = LaunchSaleDeployInput;

export type LaunchSaleDeployResult = DeployLaunchSaleResult;

export async function deployLaunchSaleContract(
  network: AsentumNetworkConfig,
  params: LaunchSaleDeployParams,
  factoryAddress: string | null,
  deployerSecretKey?: string | null,
  deployerPublicKey?: string | null
): Promise<LaunchSaleDeployResult> {
  const resolved = tryResolveDeployerKeyMaterial();
  const secret = deployerSecretKey ?? resolved?.secretKeyHex ?? null;
  const pub = deployerPublicKey ?? resolved?.publicKeyHex ?? null;

  if (!secret || !pub) {
    return {
      status: "queued",
      message:
        "Set DEPLOYER_PRIVATE_KEY (Asentum wallet) and CONTRACT_LAUNCHPAD (factory) to deploy on-chain sale contracts."
    };
  }
  return deployLaunchSale(network, secret, pub, params, factoryAddress);
}
