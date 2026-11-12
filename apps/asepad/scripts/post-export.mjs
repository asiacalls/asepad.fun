// Static-export post step: mirror every deep page's <name>.html as
// <name>/index.html so clean URLs (no extension) resolve to the prebuilt file
// on any static host. This is what lets shared /asepad/token/<addr> and
// /asedex/terminal/<dex>/<pool>/<token> links serve their own OG meta tags to
// crawlers instead of falling through to the generic shells in _redirects.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "../out");

function* walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (e.endsWith(".html") && e !== "index.html") yield p;
  }
}

let n = 0;
for (const html of walk(out)) {
  const dir = html.slice(0, -".html".length);
  mkdirSync(dir, { recursive: true });
  cpSync(html, join(dir, "index.html"));
  n++;
}

// Deep-link shells live under the same wildcard that rewrites to them
// (/asepad/token/* -> /asepad/token/_ loops on Pages). Mirror each shell to a
// wildcard-free flat file so the clean-path rewrite target can neither
// self-match nor canonicalize to a trailing slash.
const SHELLS = [
  ["asepad/token/_.html", "_sh/token.html"],
  ["lock/_.html", "_sh/lock.html"],
];
for (const [src, dst] of SHELLS) {
  try {
    mkdirSync(join(out, "_sh"), { recursive: true });
    cpSync(join(out, src), join(out, dst));
    console.log(`post-export: shell ${src} -> ${dst}`);
  } catch (e) {
    console.warn(`post-export: shell ${src} skipped (${e.code || e.message})`);
  }
}
console.log(`post-export: mirrored ${n} pages as dir/index.html`);

// Pages Functions mode — NOT advanced-mode _worker.js: a root _worker.js
// would invoke the worker for EVERY request including static assets and burn
// the free daily Workers quota in minutes. functions/ only invokes on the
// dynamic routes (/api/indexer/*, /rpc/*). A stale out/_worker.js from an
// earlier build would silently flip the deploy back to advanced mode.
const staleWorker = join(out, "_worker.js");
if (existsSync(staleWorker)) { rmSync(staleWorker); console.log("post-export: removed stale out/_worker.js"); }
