import { AsentumWallet } from "@asentum/sdk";
import type { AsentumNetworkConfig } from "@asentrise/config";
import { createAsentumClient } from "../client.js";
import { ARC20_CALL_GAS } from "../gas-limits.js";
import { sendCallAndConfirm, sendSaleCallAndConfirm } from "../tx-confirm.js";

export type FundLaunchSaleResult = {
  status: "funded" | "queued" | "failed";
  approveTxHash?: string;
  depositTxHash?: string;
  message?: string;
};

/**
 * Approve + deposit project tokens into a launch-sale contract.
 * Caller wallet must hold the tokens (typically the platform deployer after Token Studio).
 */
export async function fundLaunchSaleTokens(
  network: AsentumNetworkConfig,
  signerSecretKey: string,
  signerPublicKey: string,
  tokenAddress: string,
  saleAddress: string,
  amountBaseUnits: string
): Promise<FundLaunchSaleResult> {
  const amount = amountBaseUnits.trim();
  if (!amount || amount === "0") {
    return { status: "failed", message: "tokensForSale amount required" };
  }

  try {
    const client = createAsentumClient(network);
    const wallet = AsentumWallet.fromSecretKey(client, signerSecretKey, signerPublicKey);
    const token = tokenAddress.toLowerCase();
    const sale = saleAddress.toLowerCase();

    const approveTx = await sendCallAndConfirm(wallet, {
      to: token,
      method: "approve",
      args: [sale, amount],
      gasLimit: ARC20_CALL_GAS
    });

    const depositTx = await sendSaleCallAndConfirm(wallet, {
      to: sale,
      method: "depositTokens",
      args: [amount]
    });

    return {
      status: "funded",
      approveTxHash: approveTx.hash,
      depositTxHash: depositTx.hash
    };
  } catch (e) {
    return {
      status: "failed",
      message: e instanceof Error ? e.message : "sale token deposit failed"
    };
  }
}
