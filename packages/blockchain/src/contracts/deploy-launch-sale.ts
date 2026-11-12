import { AsentumWallet } from "@asentum/sdk";
import type { AsentumNetworkConfig } from "@asentrise/config";
import { buildLaunchSaleInitArgs, type LaunchSaleDeployInput } from "@asentrise/contracts";
import { loadContractSource } from "@asentrise/contracts/server";
import { createAsentumClient } from "../client.js";
import { deployAndConfirm, sendCallAndConfirm } from "../tx-confirm.js";

export type DeployLaunchSaleResult = {
  status: "deployed" | "queued" | "failed";
  saleAddress?: string;
  onChainSaleId?: string;
  txHash?: string;
  message?: string;
};

/**
 * Deploy a fresh launch-sale contract for one project and register it on the factory.
 * Project owner is set in init — not the deployer wallet.
 */
export async function deployLaunchSale(
  network: AsentumNetworkConfig,
  signerSecretKey: string,
  signerPublicKey: string,
  input: LaunchSaleDeployInput,
  factoryAddress: string | null
): Promise<DeployLaunchSaleResult> {
  try {
    const client = createAsentumClient(network);
    const wallet = AsentumWallet.fromSecretKey(client, signerSecretKey, signerPublicKey);
    const source = loadContractSource("launch-sale");
    const contract = await deployAndConfirm(wallet, source, 5_000_000n);

    const initArgs = buildLaunchSaleInitArgs(input);
    await sendCallAndConfirm(wallet, {
      to: contract.address,
      method: "init",
      args: initArgs
    });

    let onChainSaleId: string | undefined;
    if (factoryAddress) {
      const reg = await sendCallAndConfirm(wallet, {
        to: factoryAddress,
        method: "registerSale",
        args: [contract.address, input.projectOwner, input.tokenAddress, String(input.launchType)]
      });
      onChainSaleId = reg.hash;
    }

    return {
      status: "deployed",
      saleAddress: contract.address,
      onChainSaleId,
      txHash: contract.deployTx?.hash
    };
  } catch (e) {
    return {
      status: "failed",
      message: e instanceof Error ? e.message : "launch sale deploy failed"
    };
  }
}
