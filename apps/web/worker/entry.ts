// Advanced-mode Pages Worker (out/_worker.js). Only /api/indexer/* needs code
// (the explorer sends no CORS headers); every other request — including the
// rest of /api/* — falls through to static assets via env.ASSETS, which
// applies _headers and _redirects. _redirects 302s each /api/<path> to the
// shard that owns its domain (same map as src/lib/ase-api.ts ROUTES); the
// Pages D1 binding is a single shard's DB and must not answer them.
// Bundled into out/_worker.js by scripts/build-worker.mjs — wrangler's
// functions-bundle format is NOT a valid advanced-mode worker.
import { onRequest as indexerOnRequest } from "../functions/api/indexer/[[path]]";

type FnCtx = { request: Request; env: unknown; params: Record<string, string[]>; waitUntil: (p: Promise<unknown>) => void };

export default {
  async fetch(
    request: Request,
    env: { ASSETS: { fetch: (r: Request) => Promise<Response> } },
    ctx: { waitUntil: (p: Promise<unknown>) => void }
  ): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/api/indexer" || path.startsWith("/api/indexer/")) {
      return indexerOnRequest({ request, env, params: { path: path.slice(12).split("/").filter(Boolean) }, waitUntil: (p) => ctx.waitUntil(p) } as FnCtx);
    }
    return env.ASSETS.fetch(request);
  }
};
