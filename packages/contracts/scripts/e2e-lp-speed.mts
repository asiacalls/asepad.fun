/** Minimal live e2e: deploy small token → createPool → approve → addLiquidity.
 * Times every step so we can see the real create+deposit latency. */
import { config } from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AsentumClient, AsentumWallet } from "@asentum/sdk";
import { getAsentumNetworkFromEnv } from "@asentrise/config";
import { buildStandardTokenSource } from "../dist/browser.js";
import { resolveDeployerKeyMaterial } from "./deployer-keys.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", "..", "..", ".env") });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ASE = 10n ** 18n;
const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const DEX = process.env.CONTRACT_ASEDEX!.toLowerCase();
const SUPPLY = 10_000n * ASE;
const LP_TOKENS = SUPPLY / 2n;
const LP_ASE = 1n * ASE; // 1 ASE — tiny pool

const t0 = Date.now();
const lap = (label: string, t: number) => console.log(`  ${label}: ${((Date.now() - t) / 1000).toFixed(1)}s`);

async function waitTx(client: AsentumClient, hash: string, label: string, ms = 120_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await client.getReceipt(hash);
    if (r) { if (!r.success) throw new Error(`${label} reverted: ${JSON.stringify(r).slice(0, 300)}`); return r; }
    await sleep(1500);
  }
  throw new Error(`${label} timeout`);
}

const client = new AsentumClient(getAsentumNetworkFromEnv(process.env).rpcHttp);
const keys = resolveDeployerKeyMaterial(process.env);
const wallet = AsentumWallet.fromSecretKey(client, keys.secretKeyHex, keys.publicKeyHex);
const me = wallet.address.toLowerCase();
const view = async (to: string, m: string, a: unknown[] = []) => (await client.viewCall(to, m, a)).returnValue;
const timed = async <T>(label: string, fn: () => Promise<T>): Promise<T> => { const t = Date.now(); const r = await fn(); lap(label, t); return r; };
const call = (to: string, method: string, args: unknown[], gas: bigint, valueWei = 0n) =>
  timed(`${method} mined`, async () => waitTx(client, (await wallet.sendCall({ to, method, args, value: valueWei, gasLimit: gas })).hash, method));

console.log("wallet:", me, "| dex:", DEX);

// 1. deploy a small standard token
const metadata = JSON.stringify({ description: "lp speed test", logoUrl: "https://i.postimg.cc/7YQdJHVd/dogease.png" });
const source = buildStandardTokenSource({ name: "SpeedTest", symbol: "SPEED", decimals: "18", supply: SUPPLY.toString(), creator: me, metadata });
const dep = await timed("token deploy mined", async () => waitTx(client, (await wallet.deploy({ source, gasLimit: 8_000_000n })).deployTx!.hash, "deploy"));
const token = String(dep.recipient).toLowerCase();
console.log("  token:", token);

// 2. createPool → receipt → pool id instantly
const createR = await call(DEX, "createPool", [token, NATIVE, "30"], 3_000_000n);
const pid = String((createR as { events?: { name?: string; data?: { poolId?: string } }[] }).events?.find((e) => e?.name === "PoolCreated")?.data?.poolId
  ?? await view(DEX, "poolForPair", [token, NATIVE]));
console.log("  pool id:", pid);

// 3. approve → 4. addLiquidity (1 ASE + half supply)
const pool = JSON.parse(String(await view(DEX, "getPool", [pid])));
const nativeIs0 = String(pool.token0).toLowerCase() === NATIVE;
const a0 = nativeIs0 ? LP_ASE : LP_TOKENS, a1 = nativeIs0 ? LP_TOKENS : LP_ASE;
await call(token, "approve", [DEX, LP_TOKENS.toString()], 700_000n);
await call(DEX, "addLiquidity", [pid, a0.toString(), a1.toString(), "0"], 3_000_000n, LP_ASE);

const seeded = JSON.parse(String(await view(DEX, "getPool", [pid])));
console.log("  seeded reserves:", seeded.reserve0, "/", seeded.reserve1, "| shares:", await view(DEX, "sharesOf", [pid, me]));
console.log(`TOTAL: ${((Date.now() - t0) / 1000).toFixed(1)}s — deploy→create→approve→addLP`);
