import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const BASE = "https://asepad.fun";

const STATIC_ROUTES: { path: string; priority: number; freq: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "", priority: 1, freq: "hourly" },
  { path: "/asepad", priority: 0.9, freq: "hourly" },
  { path: "/create", priority: 0.9, freq: "weekly" },
  { path: "/asedex", priority: 0.9, freq: "hourly" },
  { path: "/asedex/radar", priority: 0.8, freq: "hourly" },
  { path: "/asedex/terminal", priority: 0.8, freq: "hourly" },
  { path: "/asedex/pools", priority: 0.8, freq: "hourly" },
  { path: "/asedex/wallet", priority: 0.7, freq: "daily" },
  { path: "/asevault", priority: 0.8, freq: "weekly" },
  { path: "/auditreport", priority: 0.6, freq: "monthly" },
  { path: "/privacypolicy", priority: 0.5, freq: "monthly" },
  { path: "/lock", priority: 0.8, freq: "daily" },
  { path: "/docs", priority: 0.7, freq: "weekly" },
  ...["welcome", "getting-started", "create-token", "launch-page", "bonding-curve", "migration",
    "terminal", "orders", "markets", "wallet", "token-lock", "asevault", "auras", "fees-safety", "contracts"]
    .map((s) => ({ path: `/docs/${s}`, priority: 0.6, freq: "weekly" as const }))
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  // Static routes only — token URLs all serve the same "_" shell now, so
  // enumerating them here would be hundreds of duplicate-content entries.
  return STATIC_ROUTES.map((r) => ({
    url: `${BASE}${r.path}`, lastModified: now, changeFrequency: r.freq, priority: r.priority
  }));
}
