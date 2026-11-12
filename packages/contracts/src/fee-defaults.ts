import { TOKEN_STUDIO_ARCHETYPES } from "@asentrise/utils";

export type FeeDefaultRow = {
  feeKey: string;
  amountWei: string;
  kind: "wei" | "bps";
};

const LAUNCH_TYPES = [
  "FAIR_LAUNCH",
  "PRESALE",
  "PRIVATE_SALE",
  "COMMUNITY_LAUNCH",
  "STEALTH_LAUNCH"
] as const;

const CAMPAIGN_KINDS = [
  "SOCIAL",
  "COMMUNITY",
  "TRADING",
  "REFERRAL",
  "STAKING",
  "ECOSYSTEM",
  "LAUNCH_GROWTH"
] as const;

/** Defaults seeded on-chain at deploy and in admin DB. */
export function buildDefaultPlatformFees(): FeeDefaultRow[] {
  const rows: FeeDefaultRow[] = [
    { feeKey: "global:gas_price_wei", amountWei: "1000000000", kind: "wei" },
    { feeKey: "launch:sale_platform_fee_bps", amountWei: "250", kind: "bps" },
    { feeKey: "launch:growth_campaign_bundle", amountWei: "500000000000000000", kind: "wei" },
    { feeKey: "campaign:create", amountWei: "300000000000000000", kind: "wei" }
  ];

  for (const meta of TOKEN_STUDIO_ARCHETYPES) {
    rows.push({
      feeKey: `token_deploy:${meta.id}`,
      amountWei: meta.platformFeeWei,
      kind: "wei"
    });
  }

  for (const t of LAUNCH_TYPES) {
    rows.push({
      feeKey: `launch_deploy:${t}`,
      amountWei: "800000000000000000",
      kind: "wei"
    });
  }

  for (const k of CAMPAIGN_KINDS) {
    rows.push({
      feeKey: `campaign:kind:${k}`,
      amountWei: k === "LAUNCH_GROWTH" ? "400000000000000000" : "0",
      kind: "wei"
    });
  }

  return rows;
}
