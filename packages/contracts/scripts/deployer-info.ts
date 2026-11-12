/**
 * Print deployer address from .env keys (no secrets printed).
 * Run: pnpm deployer:info
 */
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
config({ path: path.join(root, ".env") });
import { getPlatformTreasuryAddress } from "@asentrise/config";
import { resolveDeployerKeyMaterial } from "./deployer-keys.js";

try {
  const { address, secretKeyHex, publicKeyHex } = resolveDeployerKeyMaterial();
  const skLen = (secretKeyHex.length - 2) / 2;
  const pkLen = (publicKeyHex.length - 2) / 2;
  console.log("Signer address (from keys):", address);
  const expected = process.env.DEPLOYER_WALLET_ADDRESS?.trim();
  if (expected) {
    const ok = address.toLowerCase() === expected.toLowerCase();
    console.log(
      ok ? "Matches DEPLOYER_WALLET_ADDRESS." : `WARNING: does not match DEPLOYER_WALLET_ADDRESS (${expected})`
    );
  }
  const treasury = getPlatformTreasuryAddress();
  if (treasury) console.log("Platform fee treasury:", treasury);
  console.log("Secret key bytes:", skLen);
  console.log("Public key bytes:", pkLen);
  console.log("\nFee treasury env: DEPLOYER_WALLET_ADDRESS / PLATFORM_TREASURY_ADDRESS");
  if (!treasury) console.log(`  e.g. DEPLOYER_WALLET_ADDRESS=0x...`);
  if (!process.env.DEPLOYER_SECRET_KEY && process.env.DEPLOYER_PRIVATE_KEY) {
    console.log("# DEPLOYER_PRIVATE_KEY is set (wallet export)");
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
