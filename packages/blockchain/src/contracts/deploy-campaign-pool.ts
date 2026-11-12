import { AsentumWallet } from "@asentum/sdk";
import type { AsentumNetworkConfig } from "@asentrise/config";
import { buildCampaignPoolInitArgs, type CampaignPoolDeployInput } from "@asentrise/contracts";
import { loadContractSource } from "@asentrise/contracts/server";
import { createAsentumClient } from "../client.js";
import { deployAndConfirm, sendCallAndConfirm } from "../tx-confirm.js";

export type DeployCampaignPoolResult = {
  status: "deployed" | "queued" | "failed";
  vaultAddress?: string;
  txHash?: string;
  message?: string;
};

/** Deploy a dedicated campaign-pool vault for one quest campaign. */
export async function deployCampaignPool(
  network: AsentumNetworkConfig,
  signerSecretKey: string,
  signerPublicKey: string,
  input: CampaignPoolDeployInput
): Promise<DeployCampaignPoolResult> {
  try {
    const client = createAsentumClient(network);
    const wallet = AsentumWallet.fromSecretKey(client, signerSecretKey, signerPublicKey);
    const source = loadContractSource("campaign-pool");
    const contract = await deployAndConfirm(wallet, source, 4_000_000n);

    const initArgs = buildCampaignPoolInitArgs(input);
    await sendCallAndConfirm(wallet, {
      to: contract.address,
      method: "init",
      args: initArgs
    });

    return {
      status: "deployed",
      vaultAddress: contract.address,
      txHash: contract.deployTx?.hash
    };
  } catch (e) {
    return {
      status: "failed",
      message: e instanceof Error ? e.message : "campaign pool deploy failed"
    };
  }
}
