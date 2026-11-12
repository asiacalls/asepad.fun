import { AsentumContract, AsentumWallet, type AsentumClient, type Receipt, type SentTx } from "@asentum/sdk";
import { toHexAddress } from "@asentrise/utils";
import { SALE_CONTRACT_GAS } from "./gas-limits.js";
import { contractHasCode, waitForTxReceipt } from "./on-chain-utils.js";

type SendCallOpts = Parameters<AsentumWallet["sendCall"]>[0];

/**
 * Retry policy for testnet flakiness. Asentum testnet intermittently drops txs
 * (broadcast accepted but never mined). A bounded per-attempt timeout + re-broadcast
 * recovers quickly instead of blocking on the full ASENTUM_TX_WAIT_MS window.
 */
export type TxRetryOpts = { attempts?: number; timeoutMs?: number };

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Sale / launchpad contract writes with adequate gas (default SDK limit is 2M — too low). */
export async function sendSaleCallAndConfirm(
  wallet: AsentumWallet,
  opts: SendCallOpts,
  retry?: TxRetryOpts
): Promise<SentTx> {
  return sendCallAndConfirm(
    wallet,
    {
      ...opts,
      gasLimit: opts.gasLimit ?? SALE_CONTRACT_GAS
    },
    retry
  );
}

/** Default 30s for interactive flows; override with ASENTUM_TX_WAIT_MS for deploy scripts. */
export function getTxConfirmTimeoutMs(): number {
  const raw = process.env.ASENTUM_TX_WAIT_MS ?? process.env.LAUNCH_TX_WAIT_MS ?? "30000";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 30_000;
}

/** Wait for tx inclusion — SDK wait first, then poll receipts (testnet often lags). */
export async function confirmSentTx(
  tx: SentTx,
  client: AsentumClient,
  timeout = getTxConfirmTimeoutMs()
): Promise<Receipt> {
  const hash = tx.hash;
  let receipt: Receipt | null = null;
  try {
    receipt = await tx.wait(timeout);
  } catch (err) {
    if (!hash) throw err;
    receipt = await waitForTxReceipt(client, hash, timeout);
    if (!receipt) throw err;
  }
  if (receipt && receipt.success === false) {
    throw new Error(`Transaction reverted in block ${receipt.blockNumber} (${hash})`);
  }
  if (receipt) return receipt;
  throw new Error(`No receipt for tx ${hash}`);
}

/**
 * Submit a contract call and wait for its receipt before the next nonce.
 * When `retry.attempts > 1`, a dropped/timed-out tx is re-broadcast with a bounded
 * per-attempt timeout instead of blocking for the full confirm window.
 */
export async function sendCallAndConfirm(
  wallet: AsentumWallet,
  opts: SendCallOpts,
  retry?: TxRetryOpts
): Promise<SentTx> {
  const attempts = Math.max(1, retry?.attempts ?? 1);
  const timeoutMs = retry?.timeoutMs ?? getTxConfirmTimeoutMs();
  // The SDK's tx builder wants the raw 20-byte hex form; callers may pass ase1.
  const call = { ...opts, to: toHexAddress(opts.to) };
  let lastErr: unknown;
  // Poll the current broadcast for one window; if it doesn't confirm, re-broadcast.
  // A fresh tx means the prior one was dropped; a "duplicate" rejection means it's still
  // pending, so we keep polling rather than failing.
  let pending: SentTx | undefined;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (!pending) {
      try {
        pending = await wallet.sendCall(call);
      } catch (err) {
        lastErr = err;
        if (attempt < attempts) await sleep(4_000);
        continue;
      }
    }

    try {
      await confirmSentTx(pending, wallet.client, timeoutMs);
      return pending;
    } catch (err) {
      lastErr = err;
    }

    if (attempt < attempts) {
      try {
        pending = await wallet.sendCall(call);
      } catch (err) {
        if (!isDuplicateTxError(err)) lastErr = err;
      }
      await sleep(3_000);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("contract call not confirmed");
}

/**
 * Deploy a contract and confirm it produced code on-chain.
 * With `retry.attempts > 1`, re-broadcasts the deploy on drop/timeout (bounded per attempt)
 * and treats "code exists at address" as success even if the receipt lagged.
 */
function isDuplicateTxError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /duplicate|mempool full|already known|nonce too low/i.test(msg);
}

export async function deployAndConfirm(
  wallet: AsentumWallet,
  source: string,
  gasLimit: bigint,
  retry?: TxRetryOpts
): Promise<AsentumContract> {
  const attempts = Math.max(1, retry?.attempts ?? 1);
  const timeoutMs = retry?.timeoutMs ?? getTxConfirmTimeoutMs();
  let lastErr: unknown;
  // Asentum testnet both *drops* txs (broadcast accepted, then vanishes) and *lags*
  // (mines minutes later). Strategy: poll the current broadcast for one window; if it
  // hasn't mined, try to re-broadcast — a fresh hash means the old one was dropped, while
  // a "duplicate" rejection means the original is still pending so we keep polling it.
  let contract: AsentumContract | undefined;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (!contract) {
      try {
        contract = await wallet.deploy({ source, gasLimit });
      } catch (err) {
        lastErr = err;
        if (attempt < attempts) await sleep(4_000);
        continue;
      }
    }

    const hash = contract.deployTx?.hash;

    if (hash) {
      const receipt = await waitForTxReceipt(wallet.client, hash, timeoutMs).catch(() => null);
      // The SDK's locally-computed address doesn't match this chain — the mined
      // receipt's `recipient` is the real contract address.
      const addr = receipt?.recipient || contract.address;
      if (receipt?.success && addr && (await contractHasCode(wallet.client, addr, 12_000))) {
        return new AsentumContract(wallet.client, addr, contract.deployTx, wallet);
      }
    }
    // Receipt index can lag even after code is live — accept code presence as success.
    if (contract.address && (await contractHasCode(wallet.client, contract.address, 8_000))) {
      return contract;
    }

    lastErr = new Error(`deploy attempt ${attempt}/${attempts} not confirmed (${hash ?? "no hash"})`);
    if (attempt < attempts) {
      try {
        // Re-broadcast: success ⇒ previous tx was dropped, use the new one.
        contract = await wallet.deploy({ source, gasLimit });
      } catch (err) {
        // Duplicate ⇒ original still pending; keep polling it. Other errors ⇒ surface later.
        if (!isDuplicateTxError(err)) lastErr = err;
      }
      await sleep(3_000);
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error("contract deploy not confirmed");
}
