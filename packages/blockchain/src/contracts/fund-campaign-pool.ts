import { AsentumWallet } from "@asentum/sdk";
import type { AsentumNetworkConfig } from "@asentrise/config";
import { createAsentumClient } from "../client.js";
import { sendCallAndConfirm } from "../tx-confirm.js";

export type FundCampaignPoolResult = {
  status: "funded" | "failed";
  approveTxHash?: string;
  depositTxHash?: string;
  activateTxHash?: string;
  message?: string;
};

export async function fundCampaignPoolTokens(
  network: AsentumNetworkConfig,
  signerSecretKey: string,
  signerPublicKey: string,
  tokenAddress: string,
  vaultAddress: string,
  amountBaseUnits: string,
  activate = true
): Promise<FundCampaignPoolResult> {
  try {
    const client = createAsentumClient(network);
    const wallet = AsentumWallet.fromSecretKey(client, signerSecretKey, signerPublicKey);
    const token = tokenAddress.toLowerCase();
    const vault = vaultAddress.toLowerCase();

    const approveTx = await sendCallAndConfirm(wallet, {
      to: token,
      method: "approve",
      args: [vault, amountBaseUnits]
    });

    const depositTx = await sendCallAndConfirm(wallet, {
      to: vault,
      method: "depositTokens",
      args: [amountBaseUnits]
    });

    let activateTxHash: string | undefined;
    if (activate) {
      const activateTx = await sendCallAndConfirm(wallet, {
        to: vault,
        method: "activate",
        args: []
      });
      activateTxHash = activateTx.hash;
    }

    return {
      status: "funded",
      approveTxHash: approveTx.hash,
      depositTxHash: depositTx.hash,
      activateTxHash
    };
  } catch (e) {
    return {
      status: "failed",
      message: e instanceof Error ? e.message : "campaign pool funding failed"
    };
  }
}
