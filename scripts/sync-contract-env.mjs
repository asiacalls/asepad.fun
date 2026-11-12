/**
 * Merge packages/contracts/deployments/<network>.json into .env files.
 * Usage: node scripts/sync-contract-env.mjs [networkKey] [--partial]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const networkKey = process.argv.find((a) => !a.startsWith("-") && a !== process.argv[0] && !a.endsWith(".mjs")) ?? "asentum-testnet";
const allowPartial = process.argv.includes("--partial");
const deployPath = path.join(
  root,
  "packages",
  "contracts",
  "deployments",
  `${networkKey}.json`
);

if (!fs.existsSync(deployPath)) {
  console.error(`Missing ${deployPath} — run pnpm contracts:deploy:fresh first`);
  process.exit(1);
}

const payload = JSON.parse(fs.readFileSync(deployPath, "utf8"));
if (!payload.confirmed && !allowPartial) {
  console.error(
    "Deployment file is not confirmed — run deploy until all contracts finish, or pass --partial."
  );
  process.exit(1);
}

const { deployments } = payload;
const envFiles = [
  path.join(root, ".env"),
  path.join(root, "apps", "web", ".env")
];

const envKeyMap = {
  arc20_factory: "CONTRACT_ARC20_FACTORY",
  asepad: "CONTRACT_ASEPAD",
  asedex: "CONTRACT_ASEDEX"
};

/** Keys exposed to Next.js. */
const publicMirrorKeys = new Set([
  "CONTRACT_ARC20_FACTORY",
  "CONTRACT_ASEPAD",
  "CONTRACT_ASEDEX"
]);


function setLine(text, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  return re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`;
}

function patchFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  let text = fs.readFileSync(filePath, "utf8");
  for (const [key, { address }] of Object.entries(deployments)) {
    if (!address) continue;
    const envKey = envKeyMap[key] ?? `CONTRACT_${key.toUpperCase()}`;
    text = setLine(text, envKey, address);
    if (publicMirrorKeys.has(envKey)) {
      text = setLine(text, `NEXT_PUBLIC_${envKey}`, address);
    }
  }
  fs.writeFileSync(filePath, text.endsWith("\n") ? text : `${text}\n`);
  console.log("updated", filePath);
}

for (const f of envFiles) patchFile(f);

console.log("\nSynced contract addresses from", deployPath);
console.log("Restart web after deploy.\n");
for (const [key, { address }] of Object.entries(deployments)) {
  const envKey = envKeyMap[key] ?? key;
  console.log(`  ${envKey}=${address}`);
}
