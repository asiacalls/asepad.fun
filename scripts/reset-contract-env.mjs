/**
 * Clear platform contract addresses after a testnet reset.
 * Run before a fresh `pnpm contracts:deploy`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const networkKey = process.argv[2] ?? "asentum-testnet";

const CLEAR_KEYS = [
  "CONTRACT_ASEPAD",
  "CONTRACT_ASEDEX",
  "CONTRACT_ARC20_FACTORY",
  "NEXT_PUBLIC_CONTRACT_ASEPAD",
  "NEXT_PUBLIC_CONTRACT_ASEDEX",
  "NEXT_PUBLIC_CONTRACT_ARC20_FACTORY"
];

const envFiles = [
  path.join(root, ".env"),
  path.join(root, "apps", "web", ".env")
];

function patchFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  let text = fs.readFileSync(filePath, "utf8");
  for (const key of CLEAR_KEYS) {
    const re = new RegExp(`^${key}=.*$`, "m");
    text = re.test(text) ? text.replace(re, `${key}=`) : text;
  }
  fs.writeFileSync(filePath, text.endsWith("\n") ? text : `${text}\n`);
  console.log("cleared contract vars in", filePath);
}

for (const f of envFiles) patchFile(f);

const deployPath = path.join(
  root,
  "packages",
  "contracts",
  "deployments",
  `${networkKey}.json`
);
if (fs.existsSync(deployPath)) {
  fs.unlinkSync(deployPath);
  console.log("removed", deployPath);
}

console.log("\nDone. Deploy contracts fresh:\n  pnpm contracts:deploy\n");
