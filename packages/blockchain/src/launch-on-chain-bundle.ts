import { buildCampaignPoolInitArgs, buildLaunchSaleInitArgs, type CampaignPoolDeployInput } from "@asentrise/contracts";
import type { LaunchSaleDeployInput } from "@asentrise/contracts";
import { loadContractSource } from "@asentrise/contracts/server";
import { AsentumContract, AsentumWallet } from "@asentum/sdk";
import type { AsentumNetworkConfig } from "@asentrise/config";
import { createAsentumClient } from "./client.js";
import { contractHasCode, resolveDeployAddressFromTx } from "./on-chain-utils.js";
import { ARC20_CALL_GAS } from "./gas-limits.js";
import {
  deployAndConfirm,
  sendCallAndConfirm,
  sendSaleCallAndConfirm,
  type TxRetryOpts
} from "./tx-confirm.js";

/**
 * Bounded per-attempt confirm + re-broadcast for every bundle tx. Asentum testnet
 * silently drops txs; without this a single drop would block on ASENTUM_TX_WAIT_MS
 * (often 10 min) per step. 90s × 5 recovers fast while staying patient enough for lag.
 */
const BUNDLE_TX_RETRY: TxRetryOpts = { attempts: 5, timeoutMs: 90_000 };

export type BundleStepResult = {
  step: string;
  txHash?: string;
  status: "pending" | "running" | "done" | "failed";
  error?: string;
  startedAt?: string;
  finishedAt?: string;
};

export type LaunchOnChainBundleInput = {
  sale: LaunchSaleDeployInput;
  factoryAddress: string | null;
  /** When set, platform signer approves + deposits sale tokens (deployer must hold balance). */
  fundSale?: { tokenAddress: string; amountBaseUnits: string };
  /** Sale allocation size (for pending_creator steps when creatorDepositsTokens). */
  saleTokensForSale?: string;
  /**
   * When true (default for community launches), sale/campaign token funding is left to the
   * project owner wallet after deploy — steps are recorded as pending_creator.
   */
  creatorDepositsTokens?: boolean;
  /** When false, campaign vault is deployed/inited but not funded or activated on-chain yet. */
  activateCampaignOnDeploy?: boolean;
  campaign?: CampaignPoolDeployInput & { fundAmountBaseUnits: string };
};

export type LaunchOnChainBundleResult = {
  status: "complete" | "failed";
  saleAddress?: string;
  onChainSaleId?: string;
  vaultAddress?: string;
  steps: BundleStepResult[];
  message?: string;
};

/**
 * Run all launch + campaign on-chain steps in order (one click server-side).
 * Each tx is confirmed before the next so nonces stay valid on testnet.
 */
export async function runLaunchOnChainBundle(
  network: AsentumNetworkConfig,
  signerSecretKey: string,
  signerPublicKey: string,
  input: LaunchOnChainBundleInput,
  onStep?: (step: BundleStepResult) => void | Promise<void>
): Promise<LaunchOnChainBundleResult> {
  const steps: BundleStepResult[] = [];
  const client = createAsentumClient(network);
  const wallet = AsentumWallet.fromSecretKey(client, signerSecretKey, signerPublicKey);

  const record = async (step: BundleStepResult) => {
    const idx = steps.findIndex((s) => s.step === step.step);
    const merged =
      idx >= 0
        ? { ...steps[idx], ...step, finishedAt: step.finishedAt ?? new Date().toISOString() }
        : { ...step, finishedAt: step.status === "done" || step.status === "failed" ? new Date().toISOString() : undefined };
    if (idx >= 0) steps[idx] = merged;
    else steps.push(merged);
    await onStep?.(merged);
  };

  const markRunning = async (stepId: string) => {
    await record({ step: stepId, status: "running", startedAt: new Date().toISOString() });
  };

  let saleAddress: string | undefined;

  try {
    const saleSource = loadContractSource("launch-sale");
    await markRunning("sale_deploy");
    const saleContract = await deployAndConfirm(wallet, saleSource, 5_000_000n, BUNDLE_TX_RETRY);
    const deployHash = saleContract.deployTx?.hash;
    saleAddress = saleContract.address?.toLowerCase();
    if (deployHash) {
      const resolved = await resolveDeployAddressFromTx(wallet.client, deployHash, 30_000);
      if (resolved.tokenAddress) saleAddress = resolved.tokenAddress.toLowerCase();
    }
    if (saleAddress && !(await contractHasCode(wallet.client, saleAddress, 8_000))) {
      throw new Error(
        `Sale deploy tx ${deployHash ?? "?"} did not produce contract code at ${saleAddress}`
      );
    }
    await record({
      step: "sale_deploy",
      status: "done",
      txHash: deployHash,
      startedAt: steps.find((s) => s.step === "sale_deploy")?.startedAt
    });

    await markRunning("sale_init");
    const initTx = await sendCallAndConfirm(
      wallet,
      {
        to: saleAddress!,
        method: "init",
        args: buildLaunchSaleInitArgs(input.sale)
      },
      BUNDLE_TX_RETRY
    );
    const saleProbe = new AsentumContract(client, saleAddress!);
    const hardAfterInit = BigInt(String(await saleProbe.view("hardCapWei")));
    if (hardAfterInit === 0n) {
      throw new Error(
        `sale init tx ${initTx.hash} did not configure caps on chain at ${saleAddress}`
      );
    }
    await record({
      step: "sale_init",
      status: "done",
      txHash: initTx.hash,
      startedAt: steps.find((s) => s.step === "sale_init")?.startedAt
    });

    let onChainSaleId: string | undefined;
    if (input.factoryAddress) {
      await markRunning("sale_register");
      const regTx = await sendCallAndConfirm(
        wallet,
        {
          to: input.factoryAddress,
          method: "registerSale",
          args: [saleAddress!, input.sale.projectOwner, input.sale.tokenAddress, String(input.sale.launchType)]
        },
        BUNDLE_TX_RETRY
      );
      onChainSaleId = regTx.hash;
      await record({
        step: "sale_register",
        status: "done",
        txHash: regTx.hash,
        startedAt: steps.find((s) => s.step === "sale_register")?.startedAt
      });
    }

    const creatorFunds = input.creatorDepositsTokens === true;
    const saleAlloc = input.saleTokensForSale ?? input.fundSale?.amountBaseUnits ?? "0";
    if (creatorFunds && BigInt(saleAlloc) > 0n) {
      await record({
        step: "sale_token_approve",
        status: "pending",
        error: "Approve sale tokens from your connected wallet on the launch page"
      });
      await record({
        step: "sale_token_deposit",
        status: "pending",
        error: "Deposit sale allocation into the sale contract from your wallet"
      });
    }

    if (!creatorFunds && input.fundSale && BigInt(input.fundSale.amountBaseUnits) > 0n) {
      const token = input.fundSale.tokenAddress.toLowerCase();
      const sale = saleAddress!.toLowerCase();
      const amt = input.fundSale.amountBaseUnits;

      await markRunning("sale_token_approve");
      const approveTx = await sendCallAndConfirm(
        wallet,
        {
          to: token,
          method: "approve",
          args: [sale, amt],
          gasLimit: ARC20_CALL_GAS
        },
        BUNDLE_TX_RETRY
      );
      await record({
        step: "sale_token_approve",
        status: "done",
        txHash: approveTx.hash,
        startedAt: steps.find((s) => s.step === "sale_token_approve")?.startedAt
      });

      await markRunning("sale_token_deposit");
      const depositTx = await sendSaleCallAndConfirm(
        wallet,
        {
          to: sale,
          method: "depositTokens",
          args: [amt]
        },
        BUNDLE_TX_RETRY
      );
      await record({
        step: "sale_token_deposit",
        status: "done",
        txHash: depositTx.hash,
        startedAt: steps.find((s) => s.step === "sale_token_deposit")?.startedAt
      });
    }

    let vaultAddress: string | undefined;
    if (input.campaign && BigInt(input.campaign.fundAmountBaseUnits) > 0n) {
      const poolSource = loadContractSource("campaign-pool");
      await markRunning("campaign_vault_deploy");
      const poolContract = await deployAndConfirm(wallet, poolSource, 4_000_000n, BUNDLE_TX_RETRY);
      vaultAddress = poolContract.address;
      await record({
        step: "campaign_vault_deploy",
        status: "done",
        txHash: poolContract.deployTx?.hash,
        startedAt: steps.find((s) => s.step === "campaign_vault_deploy")?.startedAt
      });

      await markRunning("campaign_vault_init");
      const poolInitTx = await sendCallAndConfirm(
        wallet,
        {
          to: poolContract.address,
          method: "init",
          args: buildCampaignPoolInitArgs(input.campaign)
        },
        BUNDLE_TX_RETRY
      );
      await record({
        step: "campaign_vault_init",
        status: "done",
        txHash: poolInitTx.hash,
        startedAt: steps.find((s) => s.step === "campaign_vault_init")?.startedAt
      });

      const token = input.campaign.tokenAddress.toLowerCase();
      const vault = poolContract.address.toLowerCase();
      const amt = input.campaign.fundAmountBaseUnits;
      if (creatorFunds) {
        await record({
          step: "campaign_token_approve",
          status: "pending",
          error: "Approve campaign reward tokens from your wallet"
        });
        await record({
          step: "campaign_token_deposit",
          status: "pending",
          error: "Fund the campaign vault from your wallet"
        });
        await record({
          step: "campaign_activate",
          status: "pending",
          error: "Activate the campaign vault after funding (scheduled with sale/campaign start)"
        });
      } else {
      await markRunning("campaign_token_approve");
      const cApprove = await sendCallAndConfirm(
        wallet,
        {
          to: token,
          method: "approve",
          args: [vault, amt]
        },
        BUNDLE_TX_RETRY
      );
      await record({
        step: "campaign_token_approve",
        status: "done",
        txHash: cApprove.hash,
        startedAt: steps.find((s) => s.step === "campaign_token_approve")?.startedAt
      });

      await markRunning("campaign_token_deposit");
      const cDeposit = await sendCallAndConfirm(
        wallet,
        {
          to: vault,
          method: "depositTokens",
          args: [amt]
        },
        BUNDLE_TX_RETRY
      );
      await record({
        step: "campaign_token_deposit",
        status: "done",
        txHash: cDeposit.hash,
        startedAt: steps.find((s) => s.step === "campaign_token_deposit")?.startedAt
      });

      if (input.activateCampaignOnDeploy !== false) {
        await markRunning("campaign_activate");
        const cActivate = await sendCallAndConfirm(
          wallet,
          {
            to: vault,
            method: "activate",
            args: []
          },
          BUNDLE_TX_RETRY
        );
        await record({
          step: "campaign_activate",
          status: "done",
          txHash: cActivate.hash,
          startedAt: steps.find((s) => s.step === "campaign_activate")?.startedAt
        });
      } else {
        await record({
          step: "campaign_activate",
          status: "pending",
          error: "Campaign vault will activate at scheduled start"
        });
      }
      }
    }

    return {
      status: "complete",
      saleAddress,
      onChainSaleId,
      vaultAddress,
      steps
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "on-chain bundle failed";
    return {
      status: "failed",
      saleAddress,
      steps,
      message
    };
  }
}
