import type { LaunchType } from "@asentrise/types";

export type LaunchSaleDeployInput = {
  projectOwner: string;
  platformAdmin: string;
  feeRegistryAddress: string;
  launchType: LaunchType | string;
  tokenAddress: string;
  /** Token base units allocated to the sale */
  tokensForSale: string;
  softCapWei: string;
  hardCapWei: string;
  priceWei: string;
  startAt: Date | number;
  endAt: Date | number;
  minBuyWei?: string;
  maxBuyWei?: string;
  whitelistEnabled: boolean;
  platformFeeBps: number;
};

export function toUnixSeconds(d: Date | number): string {
  const sec = d instanceof Date ? Math.floor(d.getTime() / 1000) : Math.floor(d);
  return String(sec);
}

/** `init(...)` args for launch-sale.js */
export function buildLaunchSaleInitArgs(input: LaunchSaleDeployInput): unknown[] {
  return [
    input.projectOwner.toLowerCase(),
    input.platformAdmin.toLowerCase(),
    input.feeRegistryAddress.toLowerCase(),
    String(input.launchType),
    input.tokenAddress.toLowerCase(),
    input.tokensForSale,
    input.softCapWei,
    input.hardCapWei,
    input.priceWei,
    toUnixSeconds(input.startAt),
    toUnixSeconds(input.endAt),
    input.minBuyWei ?? "0",
    input.maxBuyWei ?? "0",
    Boolean(input.whitelistEnabled),
    String(input.platformFeeBps)
  ];
}
