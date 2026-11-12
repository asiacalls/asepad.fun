import { AsentumWallet } from "@asentum/sdk";
import type { AsentumNetworkConfig } from "@asentrise/config";
import { createAsentumClient } from "../client.js";
import {
  ARC20_ARCHETYPE_SOURCES,
  buildArc20FactoryConfigJson,
  buildArc20InitArgs,
  type TokenDeployInput
} from "@asentrise/contracts";
import { loadContractSource } from "@asentrise/contracts/server";
import { getTxConfirmTimeoutMs, sendCallAndConfirm } from "../tx-confirm.js";
import { contractHasCode, resolveDeployAddressFromTx } from "../on-chain-utils.js";

export type DeployTokenResult = {
  status: "deployed" | "queued" | "failed";
  tokenAddress?: string;
  txHash?: string;
  message?: string;
};

/**
 * Deploy an ARC-20 token from Token Studio archetype source + init args.
 * Requires a signer wallet (platform deployer or user extension via API relay).
 */
export async function deployArc20FromStudio(
  network: AsentumNetworkConfig,
  signerSecretKey: string,
  signerPublicKey: string,
  input: TokenDeployInput,
  factoryAddress: string | null,
  creatorAddress?: string | null
): Promise<DeployTokenResult> {
  const client = createAsentumClient(network);
  const wallet = AsentumWallet.fromSecretKey(client, signerSecretKey, signerPublicKey);
  const sourceId = ARC20_ARCHETYPE_SOURCES[input.archetype];
  const source = loadContractSource(sourceId);
  const initArgs = buildArc20InitArgs(input);

  let tokenAddress: string | undefined;
  let txHash: string | undefined;

  const contract = await wallet.deploy({ source, gasLimit: 4_000_000n });
  txHash = contract.deployTx?.hash;

  try {
    if (contract.waitForDeploy) {
      await contract.waitForDeploy(getTxConfirmTimeoutMs());
    }
    // SDK-computed address can differ from the chain's — receipt recipient is canonical.
    if (txHash) {
      const resolved = await resolveDeployAddressFromTx(client, txHash, 15_000);
      tokenAddress = resolved.tokenAddress ?? contract.address;
    } else {
      tokenAddress = contract.address;
    }
    if (!(await contractHasCode(client, tokenAddress, 5_000))) {
      throw new Error("deploy tx finished but contract bytecode not found yet");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "deploy failed";
    if (txHash) {
      const recoverMs = getTxConfirmTimeoutMs();
      const recovered = await resolveDeployAddressFromTx(client, txHash, recoverMs);
      if (recovered.tokenAddress) {
        tokenAddress = recovered.tokenAddress;
      } else if (recovered.reverted) {
        return { status: "failed", txHash, message: `Deploy transaction reverted: ${msg}` };
      } else if (!recovered.receipt) {
        return {
          status: "queued",
          txHash,
          message: `Deploy submitted — still confirming on chain (${txHash}).`
        };
      }
    }
    if (!tokenAddress) {
      return { status: "failed", txHash, message: msg };
    }
  }

  try {
    await sendCallAndConfirm(wallet, {
      to: tokenAddress,
      method: "init",
      args: initArgs
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "init failed";
    return {
      status: "deployed",
      tokenAddress,
      txHash,
      message: `Token contract deployed; init may still be pending: ${msg}`
    };
  }

  if (factoryAddress) {
    try {
      const configJson = buildArc20FactoryConfigJson(input);
      const creator = creatorAddress ?? wallet.address;
      await sendCallAndConfirm(wallet, {
        to: factoryAddress,
        method: "registerToken",
        args: [tokenAddress, input.archetype, creator, configJson]
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "factory registration failed";
      return {
        status: "deployed",
        tokenAddress,
        txHash,
        message: `Token deployed at ${tokenAddress}; factory registration pending: ${msg}`
      };
    }
  }

  return {
    status: "deployed",
    tokenAddress,
    txHash
  };
}

/** Finish deploy when bytecode tx was submitted but receipt lagged (testnet). */
export async function finishArc20DeployFromTx(
  network: AsentumNetworkConfig,
  signerSecretKey: string,
  signerPublicKey: string,
  input: TokenDeployInput,
  deployTxHash: string,
  factoryAddress: string | null,
  creatorAddress?: string | null
): Promise<DeployTokenResult> {
  const client = createAsentumClient(network);
  const wallet = AsentumWallet.fromSecretKey(client, signerSecretKey, signerPublicKey);
  const recovered = await resolveDeployAddressFromTx(client, deployTxHash, getTxConfirmTimeoutMs());
  if (!recovered.tokenAddress) {
    return {
      status: "queued",
      txHash: deployTxHash,
      message: `Deploy tx still confirming: ${deployTxHash}`
    };
  }
  if (recovered.reverted) {
    return { status: "failed", txHash: deployTxHash, message: "Deploy transaction reverted" };
  }

  const tokenAddress = recovered.tokenAddress;
  const initArgs = buildArc20InitArgs(input);

  try {
    await sendCallAndConfirm(wallet, {
      to: tokenAddress,
      method: "init",
      args: initArgs
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "init failed";
    return {
      status: "deployed",
      tokenAddress,
      txHash: deployTxHash,
      message: `Bytecode ready; init may be pending: ${msg}`
    };
  }

  if (factoryAddress) {
    try {
      const configJson = buildArc20FactoryConfigJson(input);
      const creator = creatorAddress ?? wallet.address;
      await sendCallAndConfirm(wallet, {
        to: factoryAddress,
        method: "registerToken",
        args: [tokenAddress, input.archetype, creator, configJson]
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "factory registration failed";
      return {
        status: "deployed",
        tokenAddress,
        txHash: deployTxHash,
        message: `Token at ${tokenAddress}; factory registration pending: ${msg}`
      };
    }
  }

  return { status: "deployed", tokenAddress, txHash: deployTxHash };
}
