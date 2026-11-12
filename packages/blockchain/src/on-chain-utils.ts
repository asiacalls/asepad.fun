import type { AsentumClient, Receipt } from "@asentum/sdk";
import { toHexAddress } from "@asentrise/utils";
import { getTxConfirmTimeoutMs } from "./tx-confirm.js";

const POLL_MS = 2_000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Canonical contract address from a mined deploy receipt (matches explorer). */
export function deployAddressFromReceipt(receipt: {
  kind: string;
  recipient: string;
  success: boolean;
}): string | null {
  if (!receipt.success) return null;
  const r = receipt.recipient?.trim();
  if (!r || !/^0x[0-9a-f]{40}$/i.test(r)) return null;
  if (receipt.kind === "deploy") return r;
  // Some nodes label deploy receipts differently — still use recipient when tx succeeded.
  if (receipt.kind === "call" || receipt.kind === "transfer") return null;
  return r;
}

export async function contractHasCode(
  client: AsentumClient,
  address: string,
  maxWaitMs = 5_000
): Promise<boolean> {
  const target = toHexAddress(address); // eth_getCode requires the hex form
  const deadline = Date.now() + maxWaitMs;
  do {
    const hex = await client.getCode(target);
    if (hex && hex !== "0x" && hex.length > 10) return true;
    if (maxWaitMs <= 5_000) return false;
    await sleep(POLL_MS);
  } while (Date.now() < deadline);
  return false;
}

/** Poll until a tx is mined or timeout. */
export async function waitForTxReceipt(
  client: AsentumClient,
  txHash: string,
  maxMs = getTxConfirmTimeoutMs()
): Promise<Receipt | null> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const receipt = await client.getReceipt(txHash);
    if (receipt) return receipt;
    await sleep(POLL_MS);
  }
  return null;
}

/** Resolve deployed token address from tx hash once mined. */
export async function resolveDeployAddressFromTx(
  client: AsentumClient,
  txHash: string,
  maxMs = getTxConfirmTimeoutMs()
): Promise<{ tokenAddress: string | null; receipt: Receipt | null; reverted: boolean }> {
  const receipt = await waitForTxReceipt(client, txHash, maxMs);
  if (!receipt) return { tokenAddress: null, receipt: null, reverted: false };
  if (!receipt.success) return { tokenAddress: null, receipt, reverted: true };
  const addr = deployAddressFromReceipt(receipt);
  if (!addr) return { tokenAddress: null, receipt, reverted: false };
  const hasCode = await contractHasCode(client, addr, 12_000);
  return { tokenAddress: hasCode ? addr : null, receipt, reverted: false };
}

/** @deprecated Use waitForTxReceipt */
export const waitForDeployReceipt = waitForTxReceipt;
