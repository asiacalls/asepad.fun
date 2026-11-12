/**
 * Live e2e: standard token through the exact UI call sequence on BOTH dexes.
 * deploy → factory.registerToken → createPool ×2 → addLiquidity ×2 (half/half)
 * → swapExactIn ×2 → createLimitOrder ×2 (+sweep fill) → createDcaOrder (AseDex).
 */
import { config } from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AsentumClient, AsentumWallet } from "@asentum/sdk";
import { getAsentumNetworkFromEnv } from "@asentrise/config";
import { buildStandardTokenSource, verifyTokenSourceString } from "../dist/browser.js";
import { resolveDeployerKeyMaterial } from "./deployer-keys.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", "..", "..", ".env") });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ASE = 10n ** 18n;
const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const DEX = (process.env.CONTRACT_ASEDEX || "").toLowerCase();          // new AseDex
const AURA = "0x63f640a9b98b6f28e06cb5cc0fce5d72b6c0eabd";            // legacy AuraDex venue
const FACTORY = (process.env.CONTRACT_ARC20_FACTORY || "").toLowerCase();
const SUPPLY = 1_000_000_000n * ASE;
const LP_TOKENS = SUPPLY / 2n;      // half supply per dex
const LP_ASE = 20n * ASE;           // ASE side per pool

let pass = 0;
const ok = (c: unknown, label: string) => { if (!c) throw new Error(`FAIL: ${label}`); console.log(`  ✓ ${label}`); pass++; };
const eq = (a: unknown, b: unknown, label: string) => ok(String(a) === String(b), `${label} (${a} === ${b})`);

async function waitTx(client: AsentumClient, hash: string, label: string, ms = 240_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await client.getReceipt(hash);
    if (r) {
      if (!r.success) throw new Error(`${label} reverted: ${JSON.stringify(r).slice(0, 300)}`);
      return r;
    }
    await sleep(3000);
  }
  throw new Error(`${label} timeout`);
}

async function main() {
  const client = new AsentumClient(getAsentumNetworkFromEnv(process.env).rpcHttp);
  const keys = resolveDeployerKeyMaterial(process.env);
  const wallet = AsentumWallet.fromSecretKey(client, keys.secretKeyHex, keys.publicKeyHex);
  const me = wallet.address.toLowerCase();
  const view = async (to: string, m: string, a: unknown[] = []) => (await client.viewCall(to, m, a)).returnValue;
  const call = async (to: string, method: string, args: unknown[], gas: bigint, valueWei = 0n) =>
    waitTx(client, (await wallet.sendCall({ to, method, args, value: valueWei, gasLimit: gas })).hash, method);
  const bal = async () => BigInt((await client.getBalance(me)).balance);
  console.log("wallet:", me, "| asedex:", DEX, "| auradex:", AURA);
  const startBal = await bal();
  ok(startBal > 60n * ASE, `deployer has gas+LP budget (${startBal / ASE} ASE)`);

  // ── 1. Standard token deploy, exactly like the create page ──
  const metadata = JSON.stringify({ description: "dual-dex e2e token", logoUrl: "https://i.postimg.cc/7YQdJHVd/dogease.png" });
  const source = buildStandardTokenSource({ name: "DualDex", symbol: "DUAL", decimals: "18", supply: SUPPLY.toString(), creator: me, metadata });
  eq(verifyTokenSourceString(source), "verified-standard", "standard template verifies (UI check)");
  const dep = await wallet.deploy({ source, gasLimit: 8_000_000n });
  const depR = await waitTx(client, dep.deployTx!.hash, "token deploy");
  const token = String(depR.recipient).toLowerCase();
  console.log("  token:", token);
  eq(await view(token, "balanceOf", [me]), SUPPLY.toString(), "creator holds full supply");

  // ── 2. factory.registerToken — UI's signature 2/2 ──
  const fee = BigInt(String(await view(FACTORY, "getFeeWei", ["token_deploy:STANDARD"]) || "0"));
  const regMeta = JSON.stringify({ name: "DualDex", symbol: "DUAL", decimals: 18, totalSupply: "1000000000", metadata: JSON.parse(metadata) });
  await call(FACTORY, "registerToken", [token, "STANDARD", me, regMeta], 500_000n, fee);
  ok(true, `factory.registerToken done (fee ${fee / ASE} ASE)`);

  // ── 3–4. createPool + addLiquidity on BOTH dexes (UI depositToPool flow) ──
  for (const [name, dex] of [["AseDex", DEX], ["AuraDex", AURA]] as const) {
    console.log(`── ${name} (${dex})`);
    await call(dex, "createPool", [token, NATIVE, "30"], 3_000_000n);
    const pid = String(await view(dex, "poolForPair", [token, NATIVE]));
    ok(pid && pid !== "null" && pid !== "", `pool ${pid} created on ${name}`);
    const pool = JSON.parse(String(await view(dex, "getPool", [pid])));
    // Pool token order is authoritative — map our amounts onto token0/token1.
    const nativeIs0 = String(pool.token0).toLowerCase() === NATIVE;
    const a0 = nativeIs0 ? LP_ASE : LP_TOKENS, a1 = nativeIs0 ? LP_TOKENS : LP_ASE;
    await call(token, "approve", [dex, LP_TOKENS.toString()], 700_000n); // first call runs lazy genesis — needs headroom
    // AseDex takes minShares; AuraDex predates it (UI sends 3 args there).
    const addArgs = name === "AseDex" ? [pid, a0.toString(), a1.toString(), "0"] : [pid, a0.toString(), a1.toString()];
    await call(dex, "addLiquidity", addArgs, 3_000_000n, LP_ASE);
    const seeded = JSON.parse(String(await view(dex, "getPool", [pid])));
    ok(BigInt(seeded.reserve0) > 0n && BigInt(seeded.reserve1) > 0n, `${name} pool seeded (${seeded.reserve0} / ${seeded.reserve1})`);
    ok(BigInt(await view(dex, "sharesOf", [pid, me])) > 0n, `${name} LP shares credited`);

    // ── 5. buy on the pool (UI swapExactIn, native → token) ──
    const tBefore = BigInt(await view(token, "balanceOf", [me]));
    await call(dex, "swapExactIn", [pid, NATIVE, (ASE / 2n).toString(), "0"], 2_000_000n, ASE / 2n);
    ok(BigInt(await view(token, "balanceOf", [me])) > tBefore, `buy filled on ${name}`);

    // ── 6. limit order: in-the-money, filled by the auto/manual sweep ──
    const before = await ordersOf(client, dex, me);
    await call(dex, "createLimitOrder", [pid, NATIVE, (ASE / 4n).toString(), "1"], 2_000_000n, ASE / 4n);
    const mine = await ordersOf(client, dex, me);
    const newId = mine.find(id => !before.includes(id));
    ok(Boolean(newId), `${name} limit order escrowed (id ${newId})`);
    await call(dex, "sweepOrders", [pid], 3_000_000n);
    const od = JSON.parse(String(await view(dex, "getOrder", [newId])));
    ok(od.status !== "open", `${name} limit order filled by sweep (status ${od.status})`);
  }

  // ── 7. DCA — AseDex only (UI hides it on AuraDex; min interval 30s) ──
  console.log("── DCA on AseDex (2 slices × 30s)");
  const dexPoolId = String(await view(DEX, "poolForPair", [token, NATIVE]));
  const before = await ordersOf(client, DEX, me);
  await call(DEX, "createDcaOrder", [dexPoolId, NATIVE, (ASE * 3n / 5n).toString(), "2", "30", "0"], 3_000_000n, ASE * 3n / 5n);
  const mine = await ordersOf(client, DEX, me);
  const dcaId = mine.find(id => !before.includes(id));
  ok(Boolean(dcaId), `DCA order created (id ${dcaId}), slice 1 filled instantly`);
  let od = JSON.parse(String(await view(DEX, "getOrder", [dcaId])));
  eq(od.slicesDone, "1", "slice 1 executed at creation");
  console.log("  waiting 35s for slice 2 to come due…");
  await sleep(35_000);
  await call(DEX, "sweepOrders", [dexPoolId], 3_000_000n);
  od = JSON.parse(String(await view(DEX, "getOrder", [dcaId])));
  eq(od.slicesDone, "2", "slice 2 executed by sweep");
  ok(od.status !== "open", `DCA complete (status ${od.status})`);

  console.log(`\n══ ALL ${pass} LIVE CHECKS PASSED ══`);
  console.log(`token: ${token}`);
}
async function ordersOf(client: AsentumClient, dex: string, owner: string): Promise<string[]> {
  const raw = (await client.viewCall(dex, "ordersOf", [owner])).returnValue;
  try { return (JSON.parse(String(raw || "[]")) as string[]).map(String); } catch { return []; }
}
main().catch(e => { console.error("\n✗", e.message || e); process.exit(1); });
