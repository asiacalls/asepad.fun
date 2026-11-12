// Subdomain-aware link helper. Each split app sets NEXT_PUBLIC_APP to its
// slug ("asedex", "pump", ...); the monolith ("web") leaves it unset and every
// href stays a same-origin path. In a split app, same-app links collapse to
// root-relative paths and cross-app links become absolute subdomain URLs.
export const APP = process.env.NEXT_PUBLIC_APP ?? "web";

const env = (k: string, d: string) => (process.env[k] ?? d).replace(/\/$/, "");
export const SITE = {
  asepad: env("NEXT_PUBLIC_SITE_ASEPAD", "https://asepad.fun"),
  pump: env("NEXT_PUBLIC_SITE_PUMP", "https://pump.asepad.fun"),
  create: env("NEXT_PUBLIC_SITE_CREATE", "https://create.asepad.fun"),
  asedex: env("NEXT_PUBLIC_SITE_ASEDEX", "https://asedex.asepad.fun"),
  locks: env("NEXT_PUBLIC_SITE_LOCKS", "https://aselock.asepad.fun"),
  docs: env("NEXT_PUBLIC_SITE_DOCS", "https://docs.asepad.fun"),
  policy: env("NEXT_PUBLIC_SITE_POLICY", "https://policy.asepad.fun"),
  asevault: env("NEXT_PUBLIC_SITE_ASEVAULT", "https://asevault.asepad.fun"),
  admin: env("NEXT_PUBLIC_SITE_ADMIN", "https://admin.asepad.fun"),
} as const;

// Old monolith path → { app, path-on-that-app }
const MAP: [RegExp, keyof typeof SITE, string][] = [
  [/^\/asedex(\/.*)?$/, "asedex", "$1"],
  [/^\/asepad(\/.*)?$/, "pump", "$1"],
  [/^\/create(\/.*)?$/, "create", "$1"],
  [/^\/lock(\/.*)?$/, "locks", "$1"],
  [/^\/docs(\/.*)?$/, "docs", "$1"],
  [/^\/asevault(\/.*)?$/, "asevault", "$1"],
  [/^\/auditreport(\/.*)?$/, "asevault", "/audit$1"],
  [/^\/privacypolicy(\/.*)?$/, "policy", "/privacy$1"],
  [/^\/admin(\/.*)?$/, "admin", "$1"],
];

/** Map an old monolith path to the correct app's path (no host). */
export function appPath(path: string): { app: keyof typeof SITE | "asepad"; path: string } | null {
  for (const [re, app, sub] of MAP) {
    const m = re.exec(path);
    if (!m) continue;
    const rest = m[1] ?? "";
    const p = sub === "$1" ? rest || "/" : sub.replace("$1", rest);
    return { app, path: p };
  }
  if (path === "/" || path === "") return { app: "asepad", path: "/" };
  return null;
}

/** Resolve an old monolith path into the right href for this app. */
export function href(path: string): string {
  if (APP === "web") return path;
  const hit = appPath(path);
  if (!hit) return path;
  if (hit.app === APP) return hit.path;
  return `${SITE[hit.app as keyof typeof SITE]}${hit.path === "/" ? "" : hit.path}`;
}
