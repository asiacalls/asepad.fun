import { AsentumWallet } from "@asentum/sdk";
import type { AsentumNetworkConfig } from "@asentrise/config";
import { createAsentumClient } from "../client.js";
import { sendCallAndConfirm } from "../tx-confirm.js";

export type CampaignWinnerAllocation = {
  address: string;
  amount: string;
};

export type FinalizeCampaignRewardsResult = {
  status: "finalized" | "failed";
  finalizeTxHash?: string;
  setRewardTxHashes?: string[];
  message?: string;
};

export async function finalizeCampaignPoolRewards(
  network: AsentumNetworkConfig,
  signerSecretKey: string,
  signerPublicKey: string,
  vaultAddress: string,
  winners: CampaignWinnerAllocation[]
): Promise<FinalizeCampaignRewardsResult> {
  try {
    const client = createAsentumClient(network);
    const wallet = AsentumWallet.fromSecretKey(client, signerSecretKey, signerPublicKey);
    const vault = vaultAddress.toLowerCase();

    const finalizeTx = await sendCallAndConfirm(wallet, {
      to: vault,
      method: "finalize",
      args: []
    });

    const setRewardTxHashes: string[] = [];
    for (const w of winners) {
      if (BigInt(w.amount || "0") <= 0n) continue;
      const tx = await sendCallAndConfirm(wallet, {
        to: vault,
        method: "setReward",
        args: [w.address.toLowerCase(), w.amount]
      });
      setRewardTxHashes.push(tx.hash);
    }

    return {
      status: "finalized",
      finalizeTxHash: finalizeTx.hash,
      setRewardTxHashes
    };
  } catch (e) {
    return {
      status: "failed",
      message: e instanceof Error ? e.message : "campaign reward finalize failed"
    };
  }
}
