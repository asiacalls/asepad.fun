import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// STATIC_EXPORT=1 builds a plain static site into `out/` for Netlify
// drag-and-drop. Deep links (token pages, terminal pairs) are served by the
// SPA fallbacks in public/_redirects; the favicon rewrite lives there too.
const staticExport = process.env.STATIC_EXPORT === "1";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Baked at build time: the AseVault flash strip campaign clock starts on
  // each deploy (Netlify build) instead of a hardcoded timestamp.
  env: { NEXT_PUBLIC_BUILD_TS: String(Date.now()) },
  outputFileTracingRoot: path.join(__dirname, "../.."),
  transpilePackages: ["@asentrise/blockchain", "@asentrise/utils", "@asentrise/contracts"],
  experimental: {
    optimizePackageImports: ["lucide-react"],
    // RAM-constrained build box: one worker keeps the static export inside
    // ~7 GB of physical memory (parallel workers OOM'd the Zone allocator).
    cpus: 1
  },
  ...(staticExport
    ? { output: "export", images: { unoptimized: true } }
    : {
        async rewrites() {
          const explorer = (process.env.NEXT_PUBLIC_ASENTUM_EXPLORER_BASE_URL || "https://explorer.asentum.com").replace(/\/$/, "");
          const rpcMain = (process.env.NEXT_PUBLIC_ASENTUM_RPC_HTTP || "https://explorer.asentum.com/rpc").replace(/\/$/, "");
          const rpcAlt = (process.env.NEXT_PUBLIC_ASENTUM_RPC_ALT || "https://testnet.asentum.com").replace(/\/$/, "");
          return [
            { source: "/favicon.ico", destination: "/icon.png" },
            // Same-origin proxy for the explorer indexer — its /api/indexer
            // endpoints send no CORS headers, so browsers can't call them
            // cross-origin. (Prod static deploy: Netlify proxies the same
            // path via public/_redirects.)
            { source: "/api/indexer/:path*", destination: `${explorer}/api/indexer/:path*` },
            // Same-origin proxy for the chain RPCs — error responses (502,
            // 429) carry no CORS headers and mask as "Failed to fetch"; via
            // our own origin the real status always reaches the gate.
            { source: "/asentum-rpc/main", destination: rpcMain },
            { source: "/asentum-rpc/main/:path*", destination: `${rpcMain}/:path*` },
            { source: "/asentum-rpc/testnet", destination: rpcAlt },
            { source: "/asentum-rpc/testnet/:path*", destination: `${rpcAlt}/:path*` },
            // Dev parity for the prod Pages Function at functions/rpc/ — the
            // app's read pool and wallet SDK both use the same-origin "/rpc"
            // relay; in dev it just forwards to the main node.
            { source: "/rpc", destination: rpcMain },
            { source: "/rpc/:path*", destination: `${rpcMain}/:path*` }
          ];
        }
      })
};

export default nextConfig;
