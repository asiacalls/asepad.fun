import { toUnixSeconds } from "./launch-deploy-args.js";

export type CampaignPoolDeployInput = {
  projectOwner: string;
  platformAdmin: string;
  tokenAddress: string;
  /** Off-chain campaign id (cuid) — binds this vault to one campaign only */
  campaignRef: string;
  endAt: Date | number;
};

export function buildCampaignPoolInitArgs(input: CampaignPoolDeployInput): unknown[] {
  return [
    input.projectOwner.toLowerCase(),
    input.platformAdmin.toLowerCase(),
    input.tokenAddress.toLowerCase(),
    input.campaignRef,
    toUnixSeconds(input.endAt)
  ];
}
