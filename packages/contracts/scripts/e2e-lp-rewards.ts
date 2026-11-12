/** Live e2e: seed LP if needed → swap for fees → claim rewards → removeLiquidity, on both dexes (UI call paths). */
import { config } from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AsentumClient, AsentumWallet } from "@asentum/sdk";
import { getAsentumNetworkFromEnv } from "@asentrise/config";
import { resolveDeployerKeyMaterial } from "./deployer-keys.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", "..", "..", ".env") });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ASE = 10n ** 18n, NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const DEX = (process.env.CONTRACT_ASEDEX || "").toLowerCase();
const AURA = "0x63f640a9b98b6f28e06cb5cc0fce5d72b6c0eabd";
const TOKEN = "0xd086604c4ef80e0946e3b3501b574a089fcf14ec";
let pass = 0;
const ok = (c: unknown, l: string) => { if (!c) throw new Error(`FAIL: ${l}`); console.log(`  ✓ ${l}`); pass++; };
const eq = (a: unknown, b: unknown, l: string) => ok(String(a) === String(b), `${l} (${a} === ${b})`);

async function waitTx(client: AsentumClient, hash: string, label: string, ms = 300_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await client.getReceipt(hash);
    if (r) {
      if (!r.success) throw new Error(`${label} reverted: ${JSON.stringify(r).slice(0, 300)}`);
      return r;
    }
    await sleep(3000);
  }
  throw new Error(`${label} timeout (${hash})`);
}

async function main() {
  const client = new AsentumClient(getAsentumNetworkFromEnv(process.env).rpcHttp);
  const keys = resolveDeployerKeyMaterial(process.env);
  const wallet = AsentumWallet.fromSecretKey(client, keys.secretKeyHex, keys.publicKeyHex);
  const me = wallet.address.toLowerCase();
  const view = async (to: string, m: string, a: unknown[] = []) => (await client.viewCall(to, m, a)).returnValue;
  const call = async (to: string, method: string, args: unknown[], gas: bigint, valueWei = 0n) =>
    waitTx(client, (await wallet.sendCall({ to, method, args, value: valueWei, gasLimit: gas })).hash, method);
  const aseBal = async () => BigInt((await client.getBalance(me)).balance);
  const tokBal = async () => BigInt(await view(TOKEN, "balanceOf", [me]));

  // ── AseDex: re-seed LP if the position is gone, then swap to accrue fees ──
  console.log("── AseDex");
  const dexPid = String(await view(DEX, "poolForPair", [TOKEN, NATIVE]));
  let shares = BigInt(String(await view(DEX, "sharesOf", [dexPid, me])));
  if (shares === 0n) {
    console.log("  position empty — re-seeding 100M DUAL + 5 ASE…");
    const addTok = 100_000_000n * ASE, addAse = 5n * ASE;
    const pool = JSON.parse(String(await view(DEX, "getPool", [dexPid])));
    const nativeIs0 = String(pool.token0).toLowerCase() === NATIVE;
    await call(TOKEN, "approve", [DEX, addTok.toString()], 700_000n);
    await call(DEX, "addLiquidity", [dexPid, (nativeIs0 ? addAse : addTok).toString(), (nativeIs0 ? addTok : addAse).toString(), "0"], 3_000_000n, addAse);
    shares = BigInt(String(await view(DEX, "sharesOf", [dexPid, me])));
  }
  ok(shares > 0n, `LP shares held: ${shares}`);
  await call(DEX, "swapExactIn", [dexPid, NATIVE, (ASE / 2n).toString(), "0"], 2_000_000n, ASE / 2n); // generates LP fee

  const pend = JSON.parse(String(await view(DEX, "lpPendingRewards", [dexPid, me])));
  ok(BigInt(pend.amount0 || "0") > 0n || BigInt(pend.amount1 || "0") > 0n, `LP rewards accrued (${JSON.stringify(pend)})`);
  const aseB0 = await aseBal(), tokB0 = await tokBal();
  await call(DEX, "claimLpRewards", [dexPid], 500_000n);
  const pendAfter = JSON.parse(String(await view(DEX, "lpPendingRewards", [dexPid, me])));
  ok(BigInt(pendAfter.amount0 || "0") === 0n && BigInt(pendAfter.amount1 || "0") === 0n, "pending cleared after claim");
  const aseGain = (await aseBal()) - aseB0, tokGain = (await tokBal()) - tokB0;
  ok(aseGain > 0n || tokGain > 0n, `rewards paid out (+${aseGain} wei ASE, +${tokGain} wei DUAL)`);

  // ── AseDex: removeLiquidity half then rest (UI: poolId, shares, min0, min1) ──
  const pool = JSON.parse(String(await view(DEX, "getPool", [dexPid])));
  const total = BigInt(pool.totalShares);
  const burn = shares / 2n;
  const min0 = burn * BigInt(pool.reserve0) / total * 95n / 100n;
  const min1 = burn * BigInt(pool.reserve1) / total * 95n / 100n;
  const aseR0 = await aseBal(), tokR0 = await tokBal();
  await call(DEX, "removeLiquidity", [dexPid, burn.toString(), min0.toString(), min1.toString()], 2_000_000n);
  ok((await aseBal()) - aseR0 > 0n || (await tokBal()) - tokR0 > 0n, "half LP withdrawn");
  eq(await view(DEX, "sharesOf", [dexPid, me]), (shares - burn).toString(), "shares decremented");
  const rest = BigInt(String(await view(DEX, "sharesOf", [dexPid, me])));
  await call(DEX, "removeLiquidity", [dexPid, rest.toString(), "0", "0"], 2_000_000n);
  eq(await view(DEX, "sharesOf", [dexPid, me]), "0", "remaining LP fully withdrawn");

  // ── AuraDex: removeLiquidity (UI: poolId, shares — predates minouts) ──
  console.log("── AuraDex");
  const auraPid = String(await view(AURA, "poolForPair", [TOKEN, NATIVE]));
  const aShares = BigInt(String(await view(AURA, "sharesOf", [auraPid, me])));
  ok(aShares > 0n, `AuraDex LP shares held: ${aShares}`);
  const aAse0 = await aseBal(), aTok0 = await tokBal();
  await call(AURA, "removeLiquidity", [auraPid, (aShares / 2n).toString()], 2_000_000n);
  const aGain = (await aseBal()) - aAse0, aTokGain = (await tokBal()) - aTok0;
  ok(aGain > 0n || aTokGain > 0n, `AuraDex half withdrawn (+${aTokGain} DUAL, +${aGain} wei ASE)`);
  eq(await view(AURA, "sharesOf", [auraPid, me]), (aShares - aShares / 2n).toString(), "AuraDex shares decremented");

  const r = await client.viewCall(AURA, "claimLpRewards", [auraPid]).catch(e => ({ ok: false, reason: String(e) }));
  ok((r as { ok?: boolean }).ok === false, "AuraDex has no claimLpRewards — fees compound in the pool (expected)");

  console.log(`\n══ ALL ${pass} LIVE CHECKS PASSED ══`);
}
main().catch(e => { console.error("\n✗", e.message || e); process.exit(1); });
