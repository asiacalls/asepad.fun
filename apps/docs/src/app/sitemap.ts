import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const BASE = "https://docs.asepad.fun";

const ROUTES: { path: string; priority: number; freq: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "", priority: 0.9, freq: "weekly" },
  { path: "/welcome", priority: 0.8, freq: "monthly" },
  { path: "/getting-started", priority: 0.8, freq: "monthly" },
  { path: "/create-token", priority: 0.8, freq: "monthly" },
  { path: "/launch-page", priority: 0.7, freq: "monthly" },
  { path: "/bonding-curve", priority: 0.7, freq: "monthly" },
  { path: "/migration", priority: 0.7, freq: "monthly" },
  { path: "/terminal", priority: 0.7, freq: "monthly" },
  { path: "/orders", priority: 0.7, freq: "monthly" },
  { path: "/markets", priority: 0.7, freq: "monthly" },
  { path: "/wallet", priority: 0.7, freq: "monthly" },
  { path: "/token-lock", priority: 0.7, freq: "monthly" },
  { path: "/asevault", priority: 0.6, freq: "monthly" },
  { path: "/auras", priority: 0.6, freq: "monthly" },
  { path: "/fees-safety", priority: 0.7, freq: "monthly" },
  { path: "/contracts", priority: 0.7, freq: "monthly" }
];

export default function sitemap(): MetadataRoute.Sitemap {
  return ROUTES.map((r) => ({ url: `${BASE}${r.path}`, lastModified: new Date(), changeFrequency: r.freq, priority: r.priority }));
}
