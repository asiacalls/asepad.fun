import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const BASE = "https://pump.asepad.fun";

const ROUTES: { path: string; priority: number; freq: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "", priority: 1, freq: "hourly" }
];

export default function sitemap(): MetadataRoute.Sitemap {
  return ROUTES.map((r) => ({ url: `${BASE}${r.path}`, lastModified: new Date(), changeFrequency: r.freq, priority: r.priority }));
}
