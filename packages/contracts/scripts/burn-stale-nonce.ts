/**
 * Burn the deployer's current nonce (0-value self-transfer) to unblock deploy / fee seed.
 * Retries when testnet drops txs (empty mempool, no receipt).
 *
 * Usage: pnpm contracts:burn-nonce
 */
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AsentumClient, AsentumWallet } from "@asentum/sdk";
import { resolveDeployerKeyMaterial } from "./deployer-keys.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
config({ path: path.join(root, ".env") });
config({ path: path.join(root, "apps", "api", ".env") });

const rpc = process.env.ASENTUM_RPC_HTTP ?? "https://testnet.asentum.com";
const explorer = (process.env.ASENTUM_EXPLORER_BASE_URL ?? "https://testnet.asentum.com").replace(
  /\/$/,
  ""
);

const POLL_MS = 5_000;
const DROP_AFTER_MS = 25_000;
const ATTEMPT_MAX_MS = 75_000;
const MAX_ATTEMPTS = 6;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForBurn(
  client: AsentumClient,
  wallet: AsentumWallet,
  nonceBefore: bigint,
  txHash: string
): Promise<"mined" | "advanced" | "dropped"> {
  const start = Date.now();
  let emptyMempoolSince: number | null = null;
  let lastLog = 0;

  while (Date.now() - start < ATTEMPT_MAX_MS) {
    const receipt = await client.getReceipt(txHash);
    const after = await wallet.getNonce();

    if (receipt?.success) {
      console.log(`  ✓ mined block ${receipt.blockNumber} · nonce now ${after}`);
      return "mined";
    }
    if (after > nonceBefore) {
      console.log(`  ✓ nonce advanced ${nonceBefore} → ${after} (receipt lag)`);
      return "advanced";
    }

    const info = await client.getChainInfo();
    if (info.mempoolSize === 0) {
      emptyMempoolSince ??= Date.now();
      if (Date.now() - emptyMempoolSince >= DROP_AFTER_MS) {
        console.log("  … mempool empty 25s — tx likely dropped, retrying");
        return "dropped";
      }
    } else {
      emptyMempoolSince = null;
    }

    const elapsed = Date.now() - start;
    if (elapsed - lastLog >= 10_000) {
      lastLog = elapsed;
      console.log(
        `  … ${Math.round(elapsed / 1000)}s · nonce ${after} · mempool ${info.mempoolSize} · ${explorer}/tx/${txHash}`
      );
    }
    await sleep(POLL_MS);
  }

  const after = await wallet.getNonce();
  if (after > nonceBefore) {
    console.log(`  ✓ nonce advanced ${nonceBefore} → ${after} (timeout but ok)`);
    return "advanced";
  }
  return "dropped";
}

async function main() {
  const keys = resolveDeployerKeyMaterial();
  const client = new AsentumClient(rpc);
  const wallet = AsentumWallet.fromSecretKey(client, keys.secretKeyHex, keys.publicKeyHex);

  if (!(await client.isHealthy())) {
    throw new Error("Asentum RPC not healthy");
  }

  const startNonce = await wallet.getNonce();
  console.log("Deployer", wallet.address);
  console.log("Nonce to burn:", startNonce.toString());
  console.log("Explorer:", explorer);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const nonceBefore = await wallet.getNonce();
    const gasLimit = 60_000n + BigInt(attempt) * 15_000n;

    console.log(`\nBurn attempt ${attempt}/${MAX_ATTEMPTS} (nonce ${nonceBefore}, gas ${gasLimit})…`);

    let tx: { hash: string };
    try {
      tx = await wallet.sendCall({
        to: wallet.address,
        method: "transfer",
        args: [wallet.address, "0"],
        nonce: nonceBefore,
        gasLimit
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("duplicate") || msg.includes("mempool")) {
        console.warn(`  submit blocked: ${msg}`);
        console.warn("  Another tx may still own this nonce — waiting 15s…");
        await sleep(15_000);
        const after = await wallet.getNonce();
        if (after > startNonce) {
          console.log(`  ✓ nonce already advanced to ${after}`);
          return;
        }
        continue;
      }
      throw e;
    }

    console.log("  tx", tx.hash);
    console.log("  ", `${explorer}/tx/${tx.hash}`);

    const outcome = await waitForBurn(client, wallet, nonceBefore, tx.hash);
    if (outcome === "mined" || outcome === "advanced") {
      const final = await wallet.getNonce();
      console.log("\nDone — deployer nonce is now", final.toString());
      return;
    }
  }

  const final = await wallet.getNonce();
  throw new Error(
    `Could not burn nonce after ${MAX_ATTEMPTS} attempts (still at ${final}). ` +
      `Testnet may be congested — wait 2–3 min and run pnpm contracts:burn-nonce again, ` +
      `or run pnpm contracts:seed-fees:unstick (auto-burn + seed).`
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
