import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sources = {
  arc20Base: readFileSync(join(root, "src", "sources", "arc20-base.js"), "utf8"),
  arc20Pad: readFileSync(join(root, "src", "sources", "arc20-pad.js"), "utf8"),
  arc20Tax: readFileSync(join(root, "src", "sources", "arc20-tax.js"), "utf8")
};
// Retired template versions still deployed on-chain — kept byte-exact so
// verifyTokenSourceString can verify them against their original template.
const legacyPad = readdirSync(join(root, "src", "legacy"))
  .filter((f) => f.startsWith("arc20-pad") && f.endsWith(".js")).sort()
  .map((f) => readFileSync(join(root, "src", "legacy", f), "utf8"));
const legacyBase = readdirSync(join(root, "src", "legacy"))
  .filter((f) => f.startsWith("arc20-base") && f.endsWith(".js")).sort()
  .map((f) => readFileSync(join(root, "src", "legacy", f), "utf8"));
const legacyTax = readdirSync(join(root, "src", "legacy"))
  .filter((f) => f.startsWith("arc20-tax") && f.endsWith(".js")).sort()
  .map((f) => readFileSync(join(root, "src", "legacy", f), "utf8"));
const out = join(root, "src", "generated");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "browser-sources.ts"), `/** Generated from contract sources for serverless browser deployment. */\nexport const ARC20_BASE_SOURCE = ${JSON.stringify(sources.arc20Base)};\nexport const ARC20_PAD_SOURCE = ${JSON.stringify(sources.arc20Pad)};\nexport const ARC20_TAX_SOURCE = ${JSON.stringify(sources.arc20Tax)};\nexport const ARC20_PAD_LEGACY_SOURCES = ${JSON.stringify(legacyPad)};\nexport const ARC20_BASE_LEGACY_SOURCES = ${JSON.stringify(legacyBase)};\nexport const ARC20_TAX_LEGACY_SOURCES = ${JSON.stringify(legacyTax)};\n`);
console.log("Generated browser contract sources");
