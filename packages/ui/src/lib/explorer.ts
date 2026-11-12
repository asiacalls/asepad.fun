import { network } from "@/lib/network";
import { toAseAddress } from "@asentrise/utils";

export function explorerBase() {
  return (network.explorerBaseUrl ?? "https://testnet.asentum.com").replace(/\/$/, "");
}

export function explorerAddressUrl(address: string) {
  return `${explorerBase()}/address/${toAseAddress(address)}`;
}

export function explorerTxUrl(txHash: string) {
  return `${explorerBase()}/tx/${txHash}`;
}
