/** Seed 50/50 LP on AseDex + AuraDex for the live tax token (creator is tax-exempt). */
import { config } from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AsentumClient, AsentumWallet } from "@asentum/sdk";
import { getAsentumNetworkFromEnv } from "@asentrise/config";
import { resolveDeployerKeyMaterial } from "./deployer-keys.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", "..", "..", ".env") });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ASE = 10n ** 18n;
const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const DEX = (process.env.CONTRACT_ASEDEX || "").toLowerCase();
const AURA = "0x63f640a9b98b6f28e06cb5cc0fce5d72b6c0eabd";
const TOKEN = (process.env.TAX_TOKEN || "").toLowerCase();
const LP_TOKENS = 100_000_000n * ASE;
const LP_ASE = 20n * ASE;
if (!TOKEN) throw new Error("set TAX_TOKEN");

async function waitTx(client: AsentumClient, hash: string, label: string) {
  const end = Date.now() + 360_000;
  while (Date.now() < end) {
    const r = await client.getReceipt(hash).catch(() => null);
    if (r) { if (!r.success) throw new Error(`${label} reverted: ${JSON.stringify(r).slice(0, 300)}`); return r; }
    await sleep(8000);
  }
  throw new Error(`${label} timeout`);
}

async function main() {
  const client = new AsentumClient(getAsentumNetworkFromEnv(process.env).rpcHttp);
  const keys = resolveDeployerKeyMaterial(process.env);
  const wallet = AsentumWallet.fromSecretKey(client, keys.secretKeyHex, keys.publicKeyHex);
  const me = wallet.address.toLowerCase();
  const view = async (to: string, m: string, a: unknown[] = []) => (await client.viewCall(to, m, a)).returnValue;
  const jv = (v: unknown) => (typeof v === "string" ? (v ? JSON.parse(v) : null) : v) as Record<string, string>;
  const call = async (to: string, method: string, args: unknown[], gas: bigint, valueWei = 0n) =>
    waitTx(client, (await wallet.sendCall({ to, method, args, value: valueWei, gasLimit: gas })).hash, method);

  for (const [name, dex] of [["AseDex", DEX], ["AuraDex", AURA]] as const) {
    let pid = String(await view(dex, "poolForPair", [TOKEN, NATIVE]));
    if (!pid || pid === "null" || pid === "") {
      await call(dex, "createPool", [TOKEN, NATIVE, "30"], 3_000_000n);
      pid = String(await view(dex, "poolForPair", [TOKEN, NATIVE]));
      console.log(`${name}: created pool ${pid}`);
    }
    const pool = jv(await view(dex, "getPool", [pid]));
    if (BigInt(String(pool.totalShares || "0")) > 0n) { console.log(`${name}: pool ${pid} already seeded`); continue; }
    const nativeIs0 = String(pool.token0).toLowerCase() === NATIVE;
    const a0 = nativeIs0 ? LP_ASE : LP_TOKENS, a1 = nativeIs0 ? LP_TOKENS : LP_ASE;
    await call(TOKEN, "approve", [dex, LP_TOKENS.toString()], 700_000n);
    await call(dex, "addLiquidity", name === "AseDex" ? [pid, a0.toString(), a1.toString(), "0"] : [pid, a0.toString(), a1.toString()], 3_000_000n, LP_ASE);
    const seeded = jv(await view(dex, "getPool", [pid]));
    console.log(`${name}: pool ${pid} seeded — reserves ${JSON.stringify({ r0: seeded.reserve0, r1: seeded.reserve1 })}`);
  }
}

main().catch((e) => { console.error("✗", e.message || e); process.exit(1); });
