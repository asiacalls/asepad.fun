// Bundles worker/entry.ts -> out/_worker.js (advanced-mode Pages worker).
// Runs after post-export.mjs, which deletes any stale out/_worker.js first —
// this file IS the deployment's dynamic layer: /rpc relay + every /api/*
// route dispatching to the functions/ handlers. Pages functions-dir routing
// fails open to statics on this project, so this worker is required.
import { build } from "esbuild";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [join(root, "worker/entry.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  external: ["cloudflare:sockets"],
  outfile: join(root, "out/_worker.js"),
  minify: true,
});

console.log("build-worker: out/_worker.js written");
