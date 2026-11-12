import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const BASE = "https://asedex.asepad.fun";

const ROUTES: { path: string; priority: number; freq: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "", priority: 0.9, freq: "hourly" },
  { path: "/markets", priority: 0.9, freq: "hourly" },
  { path: "/radar", priority: 0.8, freq: "hourly" },
  { path: "/terminal", priority: 0.8, freq: "hourly" },
  { path: "/pools", priority: 0.8, freq: "hourly" },
  { path: "/wallet", priority: 0.6, freq: "daily" }
];

export default function sitemap(): MetadataRoute.Sitemap {
  return ROUTES.map((r) => ({ url: `${BASE}${r.path}`, lastModified: new Date(), changeFrequency: r.freq, priority: r.priority }));
}
