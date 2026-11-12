/**
 * Live e2e: replays the exact UI call sequence on the new pad+dex.
 * deploy pad-token → createLaunch → buy → approve+sell → threshold buy
 * → verify MIGRATED + pool + LP burn + creator reward → dex swap.
 */
import { config } from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AsentumClient, AsentumWallet } from "@asentum/sdk";
import { getAsentumNetworkFromEnv } from "@asentrise/config";
import { buildPadTokenSource, verifyTokenSourceString } from "../dist/browser.js";
import { resolveDeployerKeyMaterial } from "./deployer-keys.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", "..", "..", ".env") });
config({ path: join(__dirname, "..", "..", "..", "apps", "web", ".env"), override: false });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ASE = 10n ** 18n;
const PAD = (process.env.CONTRACT_ASEPAD || "").toLowerCase();
const DEX = (process.env.CONTRACT_ASEDEX || "").toLowerCase();
const SUPPLY = 1_000_000_000n * ASE;

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
  const me = wallet.address;
  const view = async (to: string, m: string, a: unknown[] = []) => (await client.viewCall(to, m, a)).returnValue;
  const call = async (to: string, method: string, args: unknown[], gas: bigint, valueWei = 0n) =>
    waitTx(client, (await wallet.sendCall({ to, method, args, value: valueWei, gasLimit: gas })).hash, method);
  console.log("wallet:", me, "| pad:", PAD, "| dex:", DEX);

  // ── 1. Deploy the pad token exactly like the create page ──
  const meta = JSON.stringify({ description: "e2e ui-wiring test token", logoUrl: "https://i.postimg.cc/7YQdJHVd/dogease.png" });
  const source = buildPadTokenSource({ name: "E2ETest", symbol: "E2E", decimals: "18", supply: SUPPLY.toString(), pad: PAD, creator: me, metadata: meta });
  eq(verifyTokenSourceString(source), "verified-pad", "generated source verifies (same check as UI)");
  const dep = await wallet.deploy({ source, gasLimit: 10_000_000n });
  const depR = await waitTx(client, dep.deployTx!.hash, "token deploy");
  const token = String(depR.recipient).toLowerCase(); // canonical address lives on the receipt, not dep.address
  console.log("  token:", token);
  eq(await view(token, "pad"), PAD, "token bound to new pad");

  // ── 2. createLaunch — creationFee + small initial buy, like the UI ──
  const clGas = 6_000_000n;
  await call(PAD, "createLaunch", [token, "E2ETest", "E2E", SUPPLY.toString(), SUPPLY.toString(), "0", meta], clGas, ASE + 5n * ASE);
  let launch = JSON.parse(String(await view(PAD, "getLaunch", [token])));
  eq(launch.status, "BONDING", "launch live on the curve");
  eq(launch.aseDex, DEX, "launch bound to new dex");

  // ── 3. buy through the pad (UI: buy(token, minOut) + msg.value) ──
  const balBefore = BigInt(await view(token, "balanceOf", [me]));
  await call(PAD, "buy", [token, "0"], 4_000_000n, 10n * ASE);
  const balAfter = BigInt(await view(token, "balanceOf", [me]));
  ok(balAfter > balBefore, `buyer received ${balAfter - balBefore} tokens`);

  // ── 4. sell like the UI: approve(pad) → sell(token, amt, minOut) ──
  const sellAmt = (balAfter - balBefore) / 4n;
  const qSell = JSON.parse(String(await view(PAD, "quoteSell", [token, sellAmt.toString()])));
  await call(token, "approve", [PAD, sellAmt.toString()], 200_000n);
  const sellBalBefore = BigInt((await client.getBalance(me)).balance);
  await call(PAD, "sell", [token, sellAmt.toString(), qSell.netAseOutWei], 900_000n);
  const sellGain = BigInt((await client.getBalance(me)).balance) - sellBalBefore;
  ok(sellGain > 0n, `sell paid out (+${sellGain} wei)`);

  // ── 5. threshold buy → migration must complete inside THIS tx ──
  console.log("  → threshold buy (110 ASE > 100 target)…");
  const threshR = await call(PAD, "buy", [token, "0"], 8_000_000n, 110n * ASE);
  console.log("    bonding buy gasUsed:", threshR.gasUsed);
  launch = JSON.parse(String(await view(PAD, "getLaunch", [token])));
  eq(launch.status, "MIGRATED", "threshold buy completed the whole migration in one tx");
  eq(await view(PAD, "getLaunchStatus", [token]), "MIGRATED", "status view agrees");
  eq(launch.creatorRewardPaid === true || launch.creatorRewardPaid === "true", true, "creator reward paid in the bonding tx");

  // ── 6. pool + LP burn checks on the new dex ──
  const pid = String(await view(DEX, "poolForPair", ["0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", token]));
  ok(pid && pid !== "null" && pid !== "", `pool ${pid} created on new dex`);
  const pool = JSON.parse(String(await view(DEX, "getPool", [pid])));
  eq(pool.totalShares, launch.lpSharesBurned, "all LP burned");
  eq(await view(DEX, "sharesOf", [pid, "0x0000000000000000000000000000000000000000"]), pool.totalShares, "burned shares at 0x0");
  eq(await view(DEX, "sharesOf", [pid, PAD]), "0", "pad keeps no LP");
  eq(await view(token, "aseDexLocked"), false, "token unlocked for dex");
  ok(BigInt(pool.reserve0) > 0n && BigInt(pool.reserve1) > 0n, "pool seeded with real reserves");

  // ── 7. dex swap on the migrated pool (like the terminal does) ──
  const tBefore = BigInt(await view(token, "balanceOf", [me]));
  await call(DEX, "swapExactIn", [pid, "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", (ASE / 2n).toString(), "0"], 2_000_000n, ASE / 2n);
  ok(BigInt(await view(token, "balanceOf", [me])) > tBefore, "dex swap paid out tokens");

  // ── 8. pad still can't trade it (curve closed) ──
  let reverted = false;
  try { await call(PAD, "buy", [token, "0"], 1_000_000n, ASE); } catch { reverted = true; }
  ok(reverted, "post-migration curve buy reverts");

  console.log(`\n══ ALL ${pass} LIVE CHECKS PASSED ══`);
  console.log(`token: ${token}\npool:  ${pid} on dex ${DEX}`);
}
main().catch(e => { console.error("\n✗", e.message || e); process.exit(1); });
