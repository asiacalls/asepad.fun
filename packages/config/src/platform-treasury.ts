import { isChainAddress, toHexAddress } from "@asentrise/utils";

/** Platform treasury — receives all on-chain fees (registry payFee, sale platform cut, etc.). */
export function getPlatformTreasuryAddress(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const raw =
    env.PLATFORM_TREASURY_ADDRESS?.trim() ||
    env.DEPLOYER_WALLET_ADDRESS?.trim() ||
    "";
  if (!raw) return null;
  if (!isChainAddress(raw)) {
    throw new Error("Invalid PLATFORM_TREASURY_ADDRESS / DEPLOYER_WALLET_ADDRESS");
  }
  // Contracts store/compare the internal 20-byte hex form.
  return toHexAddress(raw);
}
