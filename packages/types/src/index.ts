/** Shared platform types for Asentrise (API + web + admin). */

export type EcosystemRank =
  | "beginner"
  | "explorer"
  | "contributor"
  | "og"
  | "ecosystem_elite";

export type LaunchType =
  | "FAIR_LAUNCH"
  | "PRESALE"
  | "PRIVATE_SALE"
  | "COMMUNITY_LAUNCH"
  | "STEALTH_LAUNCH";

export type TokenArchetype = "STANDARD";

export type CampaignKind =
  | "SOCIAL"
  | "COMMUNITY"
  | "TRADING"
  | "REFERRAL"
  | "STAKING"
  | "ECOSYSTEM"
  | "LAUNCH_GROWTH";

export type ExploreFeed = {
  trendingLaunches: Array<{ id: string; slug?: string | null; projectName: string; symbol: string; status: string }>;
  trendingCampaigns: Array<{ id: string; title: string; status: string; xpReward: number }>;
  featuredProjects: Array<{ id: string; slug: string; name: string; logoUrl: string | null; verified: boolean }>;
  topContributors: Array<{ address: string; xp: number; level: number; reputation: number }>;
};

export type TokenStudioStep = 1 | 2 | 3 | 4;

export type PlatformModule =
  | "token-studio"
  | "launchpad"
  | "campaigns"
  | "reputation"
  | "explore"
  | "automation";
