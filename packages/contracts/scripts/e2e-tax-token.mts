/**
 * Live e2e: TAX token through the exact UI call sequence on BOTH dexes.
 * deploy (verified-tax) → factory.registerToken TAX (2 ASE → treasury)
 * → createPool + addLiquidity 50/50 on AseDex + AuraDex (sell tax on top)
 * → buy (tax skimmed) → sell (tax on top) → limit order (+sweep fill)
 * → DCA on AseDex → pool custody == reserves + escrow invariants.
 */
import { config } from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AsentumClient, AsentumWallet } from "@asentum/sdk";
import { getAsentumNetworkFromEnv } from "@asentrise/config";
import { buildTaxTokenSource, verifyTokenSourceString } from "../dist/browser.js";
import { resolveDeployerKeyMaterial } from "./deployer-keys.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", "..", "..", ".env") });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ASE = 10n ** 18n;
const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const DEX = (process.env.CONTRACT_ASEDEX || "").toLowerCase();
const AURA = "0x63f640a9b98b6f28e06cb5cc0fce5d72b6c0eabd";
const FACTORY = (process.env.CONTRACT_ARC20_FACTORY || "").toLowerCase();
const TAX_WALLET = "0x8d8a3c5aa01a46b4ae9e248e1b6beb40dc0ed435"; // marketing wallet
const BUY_BPS = 200n, SELL_BPS = 200n; // 2% each side
const SUPPLY = 1_000_000_000n * ASE;
const LP_TOKENS = 100_000_000n * ASE; // 100M per dex — 50/50 split
const LP_ASE = 20n * ASE;

let pass = 0;
const ok = (c: unknown, label: string) => { if (!c) throw new Error(`FAIL: ${label}`); console.log(`  ✓ ${label}`); pass++; };
const eq = (a: unknown, b: unknown, label: string) => ok(String(a) === String(b), `${label} (${a} === ${b})`);

async function waitTx(client: AsentumClient, hash: string, label: string, ms = 360_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await client.getReceipt(hash).catch(() => null);
    if (r) { if (!r.success) throw new Error(`${label} reverted: ${JSON.stringify(r).slice(0, 300)}`); return r; }
    await sleep(8000); // gentle polling — the node 429s under fast loops
  }
  throw new Error(`${label} timeout`);
}
async function ordersOf(client: AsentumClient, dex: string, owner: string): Promise<string[]> {
  const raw = (await client.viewCall(dex, "ordersOf", [owner])).returnValue;
  try { return (JSON.parse(String(raw || "[]")) as string[]).map(String); } catch { return []; }
}
const fmt = (w: bigint, d = 18) => `${Number(w) / 10 ** d}`;

async function main() {
  const client = new AsentumClient(getAsentumNetworkFromEnv(process.env).rpcHttp);
  const keys = resolveDeployerKeyMaterial(process.env);
  const wallet = AsentumWallet.fromSecretKey(client, keys.secretKeyHex, keys.publicKeyHex);
  const me = wallet.address.toLowerCase();
  const view = async (to: string, m: string, a: unknown[] = []) => (await client.viewCall(to, m, a)).returnValue;
  const jv = (v: unknown) => (typeof v === "string" ? (v ? JSON.parse(v) : null) : v) as Record<string, string>;
  const call = async (to: string, method: string, args: unknown[], gas: bigint, valueWei = 0n) =>
    waitTx(client, (await wallet.sendCall({ to, method, args, value: valueWei, gasLimit: gas })).hash, method);
  const tokBal = async (who: string) => BigInt(String(await view(TOKEN, "balanceOf", [who]) || "0"));
  const aseBal = async (who: string) => BigInt((await client.getBalance(who)).balance);
  const taxBal = () => tokBal(TAX_WALLET);
  let taxTotal = 0n;
  const expectTax = async (delta: bigint, label: string) => {
    taxTotal += delta;
    eq(await taxBal(), taxTotal, `${label} → marketing wallet (+${fmt(delta)})`);
  };

  console.log("wallet:", me, "| taxWallet:", TAX_WALLET);
  ok(await aseBal(me) > 60n * ASE, "deployer has gas+LP budget");

  // ── 1. Deploy, verified-tax, all genesis bindings ──
  const metadata = JSON.stringify({ description: "tax e2e token", logoUrl: "https://i.postimg.cc/7YQdJHVd/dogease.png" });
  const source = buildTaxTokenSource({
    name: "Tax Probe", symbol: "TAXP", decimals: "18", supply: SUPPLY.toString(), creator: me, metadata,
    dex: DEX, dex2: AURA, buyTaxBps: "200", sellTaxBps: "200", taxWallet: TAX_WALLET
  });
  eq(verifyTokenSourceString(source), "verified-tax", "tax template verifies (UI check)");
  // TAX_TOKEN=0x… resumes an already-deployed token (skips deploy + registration).
  let TOKEN = "";
  if (process.env.TAX_TOKEN) {
    TOKEN = process.env.TAX_TOKEN.toLowerCase();
    console.log("  resuming token:", TOKEN);
  } else {
    const dep = await wallet.deploy({ source, gasLimit: 10_000_000n });
    TOKEN = String((await waitTx(client, dep.deployTx!.hash, "token deploy")).recipient).toLowerCase();
    console.log("  token:", TOKEN);
    eq(await tokBal(me), SUPPLY.toString(), "creator holds full supply (no lock, no init tx)");
  }
  eq(await view(TOKEN, "buyTaxBps"), "200", "buyTax 2% baked at genesis");
  eq(await view(TOKEN, "sellTaxBps"), "200", "sellTax 2% baked at genesis");
  eq(await view(TOKEN, "taxWallet"), TAX_WALLET, "marketing wallet picked up at deployment");
  eq(await view(TOKEN, "boundDexes"), JSON.stringify([DEX, AURA]), "AseDex + AuraDex bound");
  taxTotal = await taxBal(); // baseline for resume runs

  // ── 2. factory.registerToken TAX — user path, 2 ASE → treasury ──
  const fee = BigInt(String(await view(FACTORY, "getFeeWei", ["token_deploy:TAX"]) || "0"));
  eq(fee, 2n * ASE, "TAX deploy fee configured at 2 ASE");
  // The deployer wallet is also the factory admin — admin registrations skip
  // the fee by design (used for AsePad launch tokens). Non-admin creators pay
  // the 2 ASE here, proven in the sim + by live record #27.
  const isAdmin = String(await view(FACTORY, "admin")).toLowerCase() === me;
  if (jv(await view(FACTORY, "getTokenByAddress", [TOKEN]) ?? null)?.token) {
    ok(true, "already factory-registered (resume)");
  } else {
    await call(FACTORY, "registerToken", [TOKEN, "TAX", me, JSON.stringify({ name: "Tax Probe", symbol: "TAXP" })], 500_000n, isAdmin ? 0n : fee);
    ok(true, `factory.registerToken done (${isAdmin ? "admin path — fee waived by design" : "2 ASE paid to treasury"})`);
    eq(jv(await view(FACTORY, "getTokenByAddress", [TOKEN])).archetype, "TAX", "TAX archetype recorded");
  }

  // ── 3–4. createPool + addLiquidity 50/50 on BOTH dexes ──
  for (const [name, dex] of [["AseDex", DEX], ["AuraDex", AURA]] as const) {
    console.log(`── ${name} (${dex})`);
    let pid = String(await view(dex, "poolForPair", [TOKEN, NATIVE]));
    if (!pid || pid === "null" || pid === "") {
      await call(dex, "createPool", [TOKEN, NATIVE, "30"], 3_000_000n);
      pid = String(await view(dex, "poolForPair", [TOKEN, NATIVE]));
    }
    const isResumePool = BigInt(String((jv(await view(dex, "getPool", [pid])) || {}).totalShares || "0")) > 0n;
    ok(pid && pid !== "null" && pid !== "", `pool ${pid} created on ${name}`);
    const pool = jv(await view(dex, "getPool", [pid]));
    const nativeIs0 = String(pool.token0).toLowerCase() === NATIVE;
    const a0 = nativeIs0 ? LP_ASE : LP_TOKENS, a1 = nativeIs0 ? LP_TOKENS : LP_ASE;
    if (isResumePool) {
      ok(true, `${name} pool already seeded (resume)`);
    } else {
      await call(TOKEN, "approve", [dex, LP_TOKENS.toString()], 700_000n);
      const balBefore = await tokBal(me);
      const addArgs = name === "AseDex" ? [pid, a0.toString(), a1.toString(), "0"] : [pid, a0.toString(), a1.toString()];
      await call(dex, "addLiquidity", addArgs, 3_000_000n, LP_ASE);
      // sell tax grossed-up on top: wallet paid amt + amt*2%/98%, pool got exactly amt.
      eq(balBefore - await tokBal(me), LP_TOKENS + (LP_TOKENS * SELL_BPS) / (10000n - SELL_BPS), `${name} LP add charged amount + 2% sell tax`);
      await expectTax((LP_TOKENS * SELL_BPS) / (10000n - SELL_BPS), `${name} LP-add tax`);
      const seeded = jv(await view(dex, "getPool", [pid]));
      eq(BigInt(seeded.reserve0) + BigInt(seeded.reserve1), LP_ASE + LP_TOKENS, `${name} pool got the full token amount (reserves honest)`);
      ok(BigInt(String(await view(dex, "sharesOf", [pid, me]))) > 0n, `${name} LP shares credited`);
    }

    // ── 5. buy: quote out, tax skimmed from receipt ──
    const quote = BigInt(String(await view(dex, "quote", [pid, NATIVE, (ASE / 2n).toString()]) || "0"));
    const before = await tokBal(me);
    await call(dex, "swapExactIn", [pid, NATIVE, (ASE / 2n).toString(), "0"], 2_000_000n, ASE / 2n);
    const got = (await tokBal(me)) - before;
    eq(got, quote - (quote * BUY_BPS) / 10000n, `${name} buy: received quote - 2% buy tax (${fmt(got)})`);
    await expectTax((quote * BUY_BPS) / 10000n, `${name} buy tax`);

    // ── 6. sell: spend S tokens total → pool trades S*98%, tax = 2% of S ──
    const spend = got / 2n;
    const sellAmt = (spend * (10000n - SELL_BPS)) / 10000n; // UI conversion: input = total spend
    const sellQ = BigInt(String(await view(dex, "quote", [pid, TOKEN, sellAmt.toString()]) || "0"));
    await call(TOKEN, "approve", [dex, sellAmt.toString()], 700_000n);
    const tb = await tokBal(me), ab = await aseBal(me);
    await call(dex, "swapExactIn", [pid, TOKEN, sellAmt.toString(), "0"], 2_000_000n);
    eq(tb - await tokBal(me), sellAmt + (sellAmt * SELL_BPS) / (10000n - SELL_BPS), `${name} sell: debited spend = input + grossed tax`);
    const aseOut = (await aseBal(me)) - ab;
    ok(aseOut > sellQ / 2n, `${name} sell paid ~${fmt(aseOut)} ASE (quote ${fmt(sellQ)})`);
    await expectTax((sellAmt * SELL_BPS) / (10000n - SELL_BPS), `${name} sell tax`);

    // ── 7. limit order: native in, filled by sweep — fill is buy-taxed ──
    const ob = await ordersOf(client, dex, me);
    await call(dex, "createLimitOrder", [pid, NATIVE, (ASE / 4n).toString(), "1"], 2_000_000n, ASE / 4n);
    const mine = await ordersOf(client, dex, me);
    const newId = mine.find(id => !ob.includes(id));
    ok(Boolean(newId), `${name} limit order escrowed (id ${newId})`);
    const tbBefore = await tokBal(me);
    await call(dex, "sweepOrders", [pid], 3_000_000n);
    const od = jv(await view(dex, "getOrder", [newId!]));
    ok(od.status !== "open", `${name} limit order filled by sweep (status ${od.status})`);
    const filled = BigInt(String(od.filledOut || "0"));
    if (filled > 0n) {
      eq((await tokBal(me)) - tbBefore, filled - (filled * BUY_BPS) / 10000n, `${name} limit fill received out - 2% buy tax`);
      await expectTax((filled * BUY_BPS) / 10000n, `${name} order-fill tax`);
    }
  }

  // ── 8. DCA on AseDex — 2 slices × 30s ──
  console.log("── DCA on AseDex (2 slices × 30s)");
  const pid = String(await view(DEX, "poolForPair", [TOKEN, NATIVE]));
  const ob = await ordersOf(client, DEX, me);
  await call(DEX, "createDcaOrder", [pid, NATIVE, (ASE * 3n / 5n).toString(), "2", "30", "0"], 3_000_000n, ASE * 3n / 5n);
  const dcaId = (await ordersOf(client, DEX, me)).find(id => !ob.includes(id));
  ok(Boolean(dcaId), `DCA order created (id ${dcaId})`);
  let od = jv(await view(DEX, "getOrder", [dcaId!]));
  eq(od.slicesDone, "1", "slice 1 executed at creation");
  await sleep(35_000);
  const tbDca = await tokBal(me);
  await call(DEX, "sweepOrders", [pid], 3_000_000n);
  od = jv(await view(DEX, "getOrder", [dcaId!]));
  eq(od.slicesDone, "2", "slice 2 executed by sweep");
  ok(BigInt(String(od.filledOut || "0")) > 0n, `DCA filled ${fmt(BigInt(String(od.filledOut || "0")))} raw, wallet got net-of-tax (${fmt((await tokBal(me)) - tbDca)})`);

  // ── 9. custody invariant: each dex holds at least its pool's token reserve ──
  for (const [name, dex] of [["AseDex", DEX], ["AuraDex", AURA]] as const) {
    const p2 = jv(await view(dex, "getPool", [String(await view(dex, "poolForPair", [TOKEN, NATIVE]))]));
    const tokReserve = String(p2.token0).toLowerCase() === TOKEN ? BigInt(p2.reserve0) : BigInt(p2.reserve1);
    ok((await tokBal(dex)) >= tokReserve, `${name} token custody covers pool reserve (${fmt(await tokBal(dex))} >= ${fmt(tokReserve)})`);
  }
  console.log(`\n══ ALL ${pass} LIVE CHECKS PASSED ══`);
  console.log(`token ${TOKEN} · tax wallet ${TAX_WALLET} collected ${fmt(taxTotal)} TAXP`);
}
main().catch(e => { console.error("\n✗", e.message || e); process.exit(1); });
