// Full-system simulation: AsePad + AseDex + ARC-20 factory + pad/standard
// tokens wired together in the in-memory runtime (scripts/sim/world.mjs).
// Run: pnpm --filter @asentrise/contracts sim   (after `build` — tokens are built
// with the same dist/browser.js source builder the web app ships)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { World, ZERO, NATIVE, ASE, ok, eq, reverts, section, passedCount } from "./world.mjs";
import { buildPadTokenSource, buildStandardTokenSource, buildTaxTokenSource } from "../../dist/browser.js";

const __dirname2 = dirname(fileURLToPath(import.meta.url));

const w = new World();
const admin = w.account("admin");
const treasury = w.account("treasury", 0n);
const treasury2 = w.account("treasury2", 0n);
const creator = w.account("creator");
const alice = w.account("alice");
const bob = w.account("bob");
const carol = w.account("carol");
const evil = w.account("evil");
const keeper = w.account("keeper");

const S = (v) => String(v);
const tb = (token, who) => BigInt(w.view(token, "balanceOf", [who]));
const launchOf = (token) => w.json(pad, "getLaunch", [token]);
const poolOf = (d, id) => w.json(d, "getPool", [id]);
const SUP = 1_000_000_000n * ASE;
const TARGET = 100n * ASE;

// ── deploy + init ─────────────────────────────────────────────────────────
section("deploy + init");
const dex = w.deploy("asedex.js", undefined, "asedex1");
const pad = w.deploy("asepad.js", undefined, "asepad");
const factory = w.deploy("arc20-factory.js", undefined, "factory");
w.tx(admin, dex, "init", [admin, pad, treasury, "30"]);
w.tx(admin, pad, "init", [admin, treasury, ZERO, dex, S(ASE), "100", S(TARGET), "100", S(30n * ASE), true]);
w.tx(admin, factory, "init", [admin, treasury, pad]);
reverts(() => w.tx(evil, dex, "init", [evil, pad, evil, "30"]), /already initialised/, "AseDex init replay");
reverts(() => w.tx(evil, pad, "init", [evil, evil, ZERO, dex, "0", "0", "1", "0", "1", true]), /already initialised/, "AsePad init replay");
eq(w.view(pad, "aseDex"), dex, "AsePad points at AseDex v1");

const padInvariant = (label) => {
  const cfg = w.json(pad, "config");
  eq(w.bal(pad), BigInt(cfg.heldWei), `${label}: pad native balance == heldWei ledger`);
};
const dexInvariant = (d, label) => {
  // Native + token custody must equal pool reserves + reward pots + open order escrow.
  const pools = Number(w.view(d, "poolCount"));
  const want = new Map();
  const addTo = (t, v) => want.set(t, (want.get(t) ?? 0n) + BigInt(v));
  for (let i = 1; i <= pools; i++) { const p = poolOf(d, S(i)); addTo(p.token0, p.reserve0); addTo(p.token1, p.reserve1); addTo(p.token0, p.pot0 || "0"); addTo(p.token1, p.pot1 || "0"); }
  for (const id of JSON.parse(w.view(d, "openOrders"))) { const o = w.json(d, "getOrder", [id]); addTo(o.tokenIn, o.amountLeft); }
  for (const [t, v] of want) {
    const have = t === NATIVE ? w.bal(d) : tb(t, d);
    eq(have, v, `${label}: AseDex ${t === NATIVE ? "ASE" : "token " + t.slice(0, 10)} custody == reserves + escrow`);
  }
};

// ── AsePad launch (2 signatures: deploy + createLaunch) ─────────────────
section("AsePad launch");
const DOGE_META = {
  description: "DogeAse — the first dog on Asentum.",
  logoUrl: "https://i.postimg.cc/7YQdJHVd/dogease.png",
  website: "https://dogease.example",
  twitter: "@dogease",
  telegram: "dogease"
};
const padToken = (name, symbol, who, p = pad, meta = {}) =>
  w.deploySource(buildPadTokenSource({ name, symbol, decimals: "18", supply: S(SUP), pad: p, creator: who, metadata: JSON.stringify(meta) }), symbol, "arc20-pad.js");
const doge = padToken("DogeAse", "DOGE", creator, pad, DOGE_META);
eq(tb(doge, pad), SUP, "genesis: full supply held by AsePad before any tx");
eq(tb(doge, creator), 0n, "genesis: creator holds nothing yet");

section("token branding + creator socials");
const dogeSrc = w.sources.get(doge).split("\n");
eq(dogeSrc[1], "// $DOGE · DogeAse", "explorer header line 1: ticker + name");
ok(dogeSrc.includes("// Website: https://dogease.example"), "header shows creator website");
ok(dogeSrc.includes("// X: https://x.com/dogease"), "header shows creator X (handle → URL)");
ok(dogeSrc.includes("// Telegram: https://t.me/dogease"), "header shows creator Telegram");
ok(dogeSrc.includes("// Logo: https://i.postimg.cc/7YQdJHVd/dogease.png"), "header shows logo link");
ok(dogeSrc.some((l) => l.startsWith("// Creator: ")), "header shows creator address");
ok(dogeSrc.includes("// Launched with AsePad — https://asepad.fun"), "header: launched with asepad.fun");
ok(dogeSrc.includes("// Website: https://asepad.fun · X: https://x.com/asepadfun · Telegram: https://t.me/asepadfun"), "header: AsePad socials");
eq(`${w.view(doge, "website")}|${w.view(doge, "twitter")}|${w.view(doge, "telegram")}`, "https://dogease.example|@dogease|dogease", "creator socials readable from the token contract");
eq(w.view(doge, "logoUrl"), DOGE_META.logoUrl, "token logoUrl() view");
eq(w.view(doge, "description"), DOGE_META.description, "token description() view");
const dLinks = w.json(doge, "links");
eq(`${dLinks.asepad.website}|${dLinks.asepad.x}|${dLinks.asepad.telegram}`, "https://asepad.fun|https://x.com/asepadfun|https://t.me/asepadfun", "token links() carries AsePad socials");
eq(w.json(doge, "deploymentBrand").launchedWith, "https://asepad.fun", "token deploymentBrand: launched with asepad.fun");
for (const [c, label] of [[pad, "AsePad"], [dex, "AseDex"], [factory, "factory"]]) {
  const b = w.json(c, "deploymentBrand");
  eq(`${b.website}|${b.x}|${b.telegram}`, "https://asepad.fun|https://x.com/asepadfun|https://t.me/asepadfun", `${label} deploymentBrand carries AsePad socials`);
}
// Hostile metadata must not escape the header comment into executable code.
const hostile = { description: "gm\n}); storage.set('pwn','1'); ({\u2028x $& $'", website: "evil.example\r\nfunction balanceOf(){return '1'}" };
const hx = padToken("Hostile", "HSTL", creator, pad, hostile);
const hxLines = w.sources.get(hx).split("\n");
const hits = hxLines.filter((l) => /pwn|function balanceOf\(\)\{/.test(l));
ok(hits.every((l) => l.startsWith("// ") || l.startsWith("const GENESIS = ")), "injected text only in header comments or the genesis literal");
ok(!/[\u2028\u2029]/.test(w.sources.get(hx)), "no raw U+2028/U+2029 anywhere in the source");
const gLine = hxLines.find((l) => l.startsWith("const GENESIS = "));
eq(JSON.parse(gLine.slice("const GENESIS = ".length, -1)).metadata, JSON.stringify(hostile), "genesis literal round-trips the exact metadata");
eq(w.store(hx).get("pwn"), undefined, "injection executed nothing");
eq(tb(hx, pad), SUP, "hostile-metadata token still behaves normally");
eq(w.view(hx, "description"), hostile.description, "raw metadata preserved in storage view");
reverts(() => w.tx(evil, doge, "setMetadata", ["{}"]), /not token creator/, "only the creator edits socials");
reverts(() => w.tx(creator, doge, "setMetadata", ["[1]"]), /metadata must be an object/, "metadata must be a JSON object");
const launchArgs = (t, name, symbol, meta = { logoUrl: "https://i.postimg.cc/7YQdJHVd/dogease.png" }) =>
  [t, name, symbol, S(SUP), S(SUP), "0", JSON.stringify(meta)];
reverts(() => w.tx(evil, pad, "createLaunch", launchArgs(doge, "DogeAse", "DOGE", DOGE_META), 6n * ASE), /only the token creator/, "stranger cannot launch someone else's token");
reverts(() => w.tx(creator, pad, "createLaunch", launchArgs(doge, "Fake", "DOGE", DOGE_META), 6n * ASE), /name differs/, "name must match token");
reverts(() => w.tx(creator, pad, "createLaunch", launchArgs(doge, "DogeAse", "DOGE", DOGE_META), 0n), /creation fee required/, "creation fee enforced");
const otherPad = w.addr("otherpad");
const foreign = padToken("Foreign", "FRGN", creator, otherPad);
reverts(() => w.tx(creator, pad, "createLaunch", launchArgs(foreign, "Foreign", "FRGN"), 6n * ASE), /not bound to AsePad/, "token bound to another pad rejected");
const trBefore = w.bal(treasury);
w.tx(creator, pad, "createLaunch", launchArgs(doge, "DogeAse", "DOGE", DOGE_META), 6n * ASE);
let L = launchOf(doge);
eq(L.status, "BONDING", "launch is BONDING");
eq(L.aseDex, dex, "launch snapshots AseDex v1");
const meta = JSON.parse(L.meta);
eq(meta.logoUrl, DOGE_META.logoUrl, "DOGE logo URL stored on-chain");
eq(`${meta.website}|${meta.twitter}|${meta.telegram}`, `${DOGE_META.website}|${DOGE_META.twitter}|${DOGE_META.telegram}`, "DOGE socials stored on-chain");
eq(w.view(doge, "name") + "/" + w.view(doge, "symbol"), "DogeAse/DOGE", "token name/symbol from genesis");
eq(w.view(doge, "aseDex"), dex, "token bound to AseDex v1");
ok(tb(doge, creator) > 0n, "creator received initial-buy tokens");
eq(tb(doge, creator), BigInt(L.initialBuyTokens), "creator tokens == initial buy output");
eq(w.bal(treasury) - trBefore, ASE + (5n * ASE) / 100n, "treasury got 1 ASE creation fee + 1% of initial buy");
eq(tb(doge, pad), BigInt(L.tokenReserve), "pad token custody == curve reserve");
reverts(() => w.tx(creator, pad, "createLaunch", launchArgs(doge, "DogeAse", "DOGE", DOGE_META), 6n * ASE), /already launched/, "double launch");
reverts(() => w.tx(evil, doge, "init", ["x", "x", "18", "1", evil]), /no method init/, "token has no init to hijack");
padInvariant("after launch");

section("pre-migration AseDex gates");
reverts(() => w.tx(evil, dex, "createPool", [NATIVE, doge, "30"]), /locked until migration/, "user cannot create DOGE pool while BONDING");
reverts(() => w.tx(alice, doge, "approve", [dex, "1"]), /locked until migration/, "user cannot approve AseDex while BONDING");
// the LP lock lives in the token itself — bonding tokens cannot be LP'd on ANY dex
reverts(() => w.tx(alice, doge, "approve", [w.addr("foreigndex"), "1"]), /locked until migration/, "no approval to a foreign dex while BONDING");
reverts(() => w.tx(alice, doge, "approve", [bob, "1"]), /locked until migration/, "no approvals at all while BONDING");
reverts(() => w.tx(alice, doge, "transferFrom", [alice, bob, "1"]), /locked until migration/, "no token pulls while BONDING");
w.tx(alice, doge, "approve", [pad, S(ASE)]);
ok(true, "approving the pad itself still works while locked (UI sell flow)");
w.tx(alice, doge, "approve", [pad, "0"]);

// ── bonding-curve trading ──────────────────────────────────────────────
section("bonding curve buy / 1-signature sell");
const aliceBuy = JSON.parse(w.tx(alice, pad, "buy", [doge, "0"], 10n * ASE));
const aliceTokens = tb(doge, alice);
eq(aliceTokens, BigInt(aliceBuy.tokensOut), "alice received quoted tokens");
reverts(() => w.tx(alice, pad, "buy", [doge, S(aliceTokens * 10n)], 1n * ASE), /slippage/, "buy slippage guard");
const sellAmt = aliceTokens / 2n;
const q = w.json(pad, "quoteSell", [doge, S(sellAmt)]);
eq(w.view(doge, "allowance", [alice, pad]), "0", "alice never approved AsePad");
const aBefore = w.bal(alice), tBefore = w.bal(treasury);
w.tx(alice, pad, "sell", [doge, S(sellAmt), S(q.netAseOutWei)]);
eq(w.bal(alice) - aBefore, BigInt(q.netAseOutWei), "approve-free sell paid quoted net ASE in one tx");
eq(w.bal(treasury) - tBefore, BigInt(q.protocolFeeWei), "sell fee to treasury");
eq(tb(doge, alice), aliceTokens - sellAmt, "alice tokens debited");
const snapTokens = tb(doge, alice), snapAse = w.bal(alice);
reverts(() => w.tx(alice, pad, "sell", [doge, S(1000n * ASE), S(1000n * ASE)]), /slippage/, "sell slippage guard");
eq(tb(doge, alice), snapTokens, "reverted sell rolled back tokens");
eq(w.bal(alice), snapAse, "reverted sell rolled back ASE");
reverts(() => w.tx(evil, pad, "sell", [doge, S(ASE), "0"]), /insufficient balance/, "cannot sell tokens you don't hold");
w.tx(alice, doge, "transfer", [bob, S(ASE)]);
eq(tb(doge, bob), ASE, "holder-to-holder transfer");
padInvariant("after trades");

section("pause + admin guards");
reverts(() => w.tx(evil, pad, "pause"), /not admin/, "only admin pauses");
w.tx(admin, pad, "pause");
reverts(() => w.tx(alice, pad, "buy", [doge, "0"], ASE), /paused/, "buy blocked while paused");
w.tx(admin, pad, "unpause");
reverts(() => w.tx(admin, pad, "setVirtualAseWei", [S(ASE)]), /locked after first launch/, "virtual cap locked after first launch");
reverts(() => w.tx(admin, pad, "rescueToken", [doge, admin, "1"]), /active launch token protected/, "admin cannot rescue an active curve's tokens");

// ── bond + migration: pool, liquidity, LP burn ─────────────────────────
section("bond → atomic migration → LP burn");
const creatorBefore = w.bal(creator);
const bobBefore = tb(doge, bob);
const bondBuy = JSON.parse(w.tx(bob, pad, "buy", [doge, "0"], 150n * ASE));
L = launchOf(doge);
eq(L.status, "MIGRATED", "bonding buy completes the entire migration in one tx");
eq(tb(doge, bob) - bobBefore, BigInt(bondBuy.tokensOut), "bonding buyer still receives their curve tokens in the same tx");
eq(w.bal(creator) - creatorBefore, (TARGET * 100n) / 10000n, "creator reward (1% of target) paid inside the bonding buy");
reverts(() => w.tx(alice, pad, "buy", [doge, "0"], ASE), /not bonding/, "no buys after migration");
reverts(() => w.tx(alice, pad, "sell", [doge, "1", "0"]), /not bonding/, "no curve sells after migration");
reverts(() => w.tx(evil, dex, "createPool", [NATIVE, doge, "30"]), /pool exists/, "pair already migrated to AseDex");
reverts(() => w.tx(keeper, pad, "migrate", [doge]), /not bonded/, "migrate cannot re-run after completion");
const pid = w.view(dex, "poolForPair", [NATIVE, doge]);
eq(L.aseDexPoolId, pid, "launch records its AseDex pool id");
let P = poolOf(dex, pid);
eq(P.token0, NATIVE, "pool token0 = ASE");
eq(P.reserve0, L.migrationAseWei, "pool ASE reserve == migrated ASE");
eq(P.reserve1, L.migrationTokenWei, "pool token reserve == migrated tokens");
eq(w.view(dex, "sharesOf", [pid, pad]), "0", "AsePad keeps no LP");
eq(w.view(dex, "sharesOf", [pid, ZERO]), L.lpSharesBurned, "all migration LP burned to 0x0");
eq(P.totalShares, L.lpSharesBurned, "burned LP == total LP supply");
eq(tb(doge, pad), 0n, "AsePad holds no DOGE after migration");
eq(w.view(doge, "aseDexLocked"), false, "token unlocked for AseDex");
reverts(() => w.tx(keeper, pad, "advanceMigration", [doge]), /not migrating/, "migration cannot be re-run");
padInvariant("after migration");
dexInvariant(dex, "after migration");

// ── AseDex swaps on the migrated pool ──────────────────────────────────
section("AseDex swaps (migrated token, no approvals)");
eq(w.view(doge, "trustedSpender", [dex]), true, "token trusts its bound AseDex");
w.tx(alice, doge, "approve", [dex, "1"]);
ok(true, "approvals open after migration — dex LP/swaps unlocked");
let amt = tb(doge, alice) / 4n;
let quoted = BigInt(w.view(dex, "quote", [pid, doge, S(amt)]));
let fee = amt - (amt * 9970n) / 10000n;
const trDoge = tb(doge, treasury);
const aAse = w.bal(alice);
w.tx(alice, dex, "swapExactIn", [pid, doge, S(amt), S(quoted)]);
eq(w.bal(alice) - aAse, quoted, "sell DOGE → ASE pays the quote (no approve)");
eq(tb(doge, treasury) - trDoge, fee, "migration LP is 100% burned → full 0.30% fee goes to treasury");
const kBefore = BigInt(P.reserve0) * BigInt(P.reserve1);
const bobTok = tb(doge, bob);
quoted = BigInt(w.view(dex, "quote", [pid, NATIVE, S(5n * ASE)]));
w.tx(bob, dex, "swapExactIn", [pid, NATIVE, S(5n * ASE), S(quoted)], 5n * ASE);
eq(tb(doge, bob) - bobTok, quoted, "buy ASE → DOGE");
const bobAse = w.bal(bob);
w.tx(bob, dex, "swapExactIn", [pid, NATIVE, S(ASE), "0"], 3n * ASE);
eq(bobAse - w.bal(bob), ASE, "excess msg.value refunded");
reverts(() => w.tx(bob, dex, "swapExactIn", [pid, NATIVE, S(2n * ASE), "0"], ASE), /insufficient native value/, "underpaid swap");
reverts(() => w.tx(bob, dex, "swapExactIn", [pid, NATIVE, S(ASE), S(10n ** 40n)], ASE), /insufficient output/, "swap slippage guard");
P = poolOf(dex, pid);
ok(BigInt(P.reserve0) * BigInt(P.reserve1) > kBefore, "net input still grows k (fees no longer compound into reserves)");
const hist = w.json(dex, "recentSwaps", [pid, "10"]);
eq(hist.totalCount, "3", "swap history records every swap");
dexInvariant(dex, "after swaps");

// ── liquidity: add, remove, user LP burn ───────────────────────────────
section("AseDex liquidity: add / remove / burn");
w.tx(carol, dex, "swapExactIn", [pid, NATIVE, S(20n * ASE), "0"], 20n * ASE);
P = poolOf(dex, pid);
const cTok = tb(doge, carol);
const addAse = 10n * ASE;
const addTok = (addAse * BigInt(P.reserve1)) / BigInt(P.reserve0);
ok(cTok >= addTok, "carol holds enough DOGE to pair");
reverts(() => w.tx(carol, dex, "addLiquidity", [pid, S(addAse), S(addTok), S(10n ** 40n)], addAse), /minimum LP shares/, "add-liquidity min-shares guard");
w.tx(carol, dex, "addLiquidity", [pid, S(addAse), S(addTok), "0"], addAse);
const cShares = BigInt(w.view(dex, "sharesOf", [pid, carol]));
ok(cShares > 0n, "carol minted LP without approving DOGE");
ok(BigInt(w.view(dex, "lpSince", [pid, carol])) > 0n, "lpSince entry snapshot recorded");
// snapshot rewards: carol is the ONLY live LP now — a swap's LP fee accrues to her index
const feeSide = P.token0 === NATIVE ? "0" : "1"; // bob swaps ASE in → fee lands on the native side
const potKey = "pot" + feeSide, rpsKey = "rps" + feeSide;
w.tx(bob, dex, "swapExactIn", [pid, NATIVE, S(4n * ASE), "0"], 4n * ASE);
const preSwapP = poolOf(dex, pid);
ok(BigInt(preSwapP[potKey]) > 0n, "LP fee now accrues to the rewards pot (live LP exists)");
ok(BigInt(preSwapP[rpsKey]) > 0n, "reward-per-share index advanced");
const cPend = JSON.parse(w.view(dex, "lpPendingRewards", [pid, carol]));
ok(BigInt(cPend["amount" + feeSide]) > 0n, "carol's pending rewards ≈ 100% of the LP fee (sole live LP)");
const half = cShares / 2n;
P = poolOf(dex, pid);
const exp0 = (half * BigInt(P.reserve0)) / BigInt(P.totalShares);
const exp1 = (half * BigInt(P.reserve1)) / BigInt(P.totalShares);
reverts(() => w.tx(carol, dex, "removeLiquidity", [pid, S(half), S(exp0 + 1n), "0"]), /minimum liquidity output/, "remove-liquidity min-out guard");
const cAse0 = w.bal(carol), cTok0 = tb(doge, carol);
w.tx(carol, dex, "removeLiquidity", [pid, S(half), S(exp0), S(exp1)]);
eq(w.bal(carol) - cAse0, exp0 + BigInt(cPend["amount" + feeSide]), "remove returns pro-rata ASE + auto-claimed LP rewards");
eq(tb(doge, carol) - cTok0, exp1, "remove returns pro-rata DOGE");
eq(JSON.parse(w.view(dex, "lpPendingRewards", [pid, carol]))["amount" + feeSide], "0", "rewards zeroed after auto-claim");
reverts(() => w.tx(evil, dex, "transferSharesFrom", [pid, carol, evil, "1"]), /share allowance exceeded/, "cannot move someone else's LP");
const rest = BigInt(w.view(dex, "sharesOf", [pid, carol]));
const zeroBefore = BigInt(w.view(dex, "sharesOf", [pid, ZERO]));
const rBefore = poolOf(dex, pid);
w.tx(carol, dex, "transferShares", [pid, ZERO, S(rest)]);
eq(w.view(dex, "sharesOf", [pid, carol]), "0", "carol burned her remaining LP");
eq(BigInt(w.view(dex, "sharesOf", [pid, ZERO])) - zeroBefore, rest, "burned LP sits at 0x0");
const rAfter = poolOf(dex, pid);
eq(rAfter.reserve0 + "/" + rAfter.reserve1, rBefore.reserve0 + "/" + rBefore.reserve1, "burning LP leaves reserves locked in the pool");
reverts(() => w.tx(carol, dex, "removeLiquidity", [pid, "1", "0", "0"]), /insufficient shares/, "burned LP can't be withdrawn");
dexInvariant(dex, "after liquidity");

// ── limit orders + DCA ─────────────────────────────────────────────────
section("limit orders (buy + sell), auto-fill on swap, cancel");
const aTokBal = tb(doge, alice);
const sellIn = aTokBal / 3n;
const spotOut = BigInt(w.view(dex, "quote", [pid, doge, S(sellIn)]));
const limitMin = (spotOut * 110n) / 100n; // +10% above current
const limId = w.tx(alice, dex, "createLimitOrder", [pid, doge, S(sellIn), S(limitMin)]);
eq(tb(doge, alice), aTokBal - sellIn, "limit SELL escrowed DOGE without an approve");
ok(JSON.parse(w.view(dex, "openOrders")).includes(limId), "limit order is open");
w.tx(keeper, dex, "sweepOrders", [pid]);
eq(w.json(dex, "getOrder", [limId]).status, "open", "sweep leaves an out-of-range limit order open");
const aAseL = w.bal(alice);
w.tx(bob, dex, "swapExactIn", [pid, NATIVE, S(40n * ASE), "0"], 40n * ASE);
let O = w.json(dex, "getOrder", [limId]);
eq(O.status, "filled", "price move → limit SELL filled inside bob's swap (no crank)");
ok(BigInt(O.filledOut) >= limitMin, "fill respected the limit price");
eq(w.bal(alice) - aAseL, BigInt(O.filledOut), "alice received the filled ASE");
const buyId = w.tx(alice, dex, "createLimitOrder", [pid, NATIVE, S(2n * ASE), S(10n ** 40n)], 2n * ASE);
reverts(() => w.tx(evil, dex, "cancelOrder", [buyId]), /not order owner/, "only owner cancels");
const aAseC = w.bal(alice);
w.tx(alice, dex, "cancelOrder", [buyId]);
eq(w.bal(alice) - aAseC, 2n * ASE, "cancel refunds the full ASE escrow");
eq(w.json(dex, "getOrder", [buyId]).status, "cancelled", "status cancelled");
reverts(() => w.tx(alice, dex, "cancelOrder", [buyId]), /order not open/, "no double cancel");
const buyId2 = w.tx(alice, dex, "createLimitOrder", [pid, NATIVE, S(ASE), S(1n)], ASE);
w.tx(keeper, dex, "sweepOrders", [pid]);
eq(w.json(dex, "getOrder", [buyId2]).status, "filled", "limit BUY fills via sweep");
reverts(() => w.tx(alice, dex, "createLimitOrder", [pid, "0x" + "12".repeat(20), "1", "1"]), /token not in pool/, "limit order on wrong token");
dexInvariant(dex, "after limit orders");

section("DCA (buy + sell), slicing, stuck-slice isolation");
reverts(() => w.tx(bob, dex, "createDcaOrder", [pid, NATIVE, S(3n * ASE), "1", "60", "0"], 3n * ASE), /slices out of range/, "DCA needs ≥2 slices");
reverts(() => w.tx(bob, dex, "createDcaOrder", [pid, NATIVE, S(3n * ASE), "3", "10", "0"], 3n * ASE), /interval too short/, "DCA min interval");
reverts(() => w.tx(bob, dex, "createDcaOrder", [pid, NATIVE, S(3n * ASE), "3", "60", S(10n ** 40n)], 3n * ASE), /insufficient output/, "unfillable DCA rejected at creation");
const bTok0 = tb(doge, bob);
const dcaBuy = w.tx(bob, dex, "createDcaOrder", [pid, NATIVE, S(3n * ASE), "3", "60", "0"], 3n * ASE);
O = w.json(dex, "getOrder", [dcaBuy]);
eq(O.slicesDone, "1", "DCA BUY slice 1 executes immediately");
ok(tb(doge, bob) > bTok0, "bob received slice-1 tokens");
w.tx(keeper, dex, "sweepOrders", [pid]);
eq(w.json(dex, "getOrder", [dcaBuy]).slicesDone, "1", "slice 2 waits for its interval");
w.advance(60); w.tx(keeper, dex, "sweepOrders", [pid]);
eq(w.json(dex, "getOrder", [dcaBuy]).slicesDone, "2", "slice 2 after 60s");
w.advance(60); w.tx(keeper, dex, "sweepOrders", [pid]);
O = w.json(dex, "getOrder", [dcaBuy]);
eq(O.status + "/" + O.slicesDone + "/" + O.amountLeft, "filled/3/0", "DCA BUY completes, no escrow left");
const aTok1 = tb(doge, alice);
const dcaSellTotal = aTok1 / 4n;
const slice = dcaSellTotal / 2n;
const sliceMin = (BigInt(w.view(dex, "quote", [pid, doge, S(slice)])) * 99n) / 100n;
const dcaSell = w.tx(alice, dex, "createDcaOrder", [pid, doge, S(dcaSellTotal), "2", "30", S(sliceMin)]);
eq(w.json(dex, "getOrder", [dcaSell]).slicesDone, "1", "DCA SELL slice 1 (no approve)");
// dump the price so slice 2 can no longer meet its min, and queue a fillable limit behind it
w.tx(carol, dex, "swapExactIn", [pid, doge, S(tb(doge, carol)), "0"]);
const limAfter = w.tx(bob, dex, "createLimitOrder", [pid, NATIVE, S(ASE / 2n), S(1n)], ASE / 2n);
w.advance(30);
w.tx(keeper, dex, "sweepOrders", [pid]);
eq(w.json(dex, "getOrder", [dcaSell]).status, "open", "slice below its min is skipped, order stays open");
eq(w.json(dex, "getOrder", [limAfter]).status, "filled", "a stuck DCA slice does not block other fills");
const aTokBeforeCancel = tb(doge, alice);
const left = BigInt(w.json(dex, "getOrder", [dcaSell]).amountLeft);
w.tx(alice, dex, "cancelOrder", [dcaSell]);
eq(tb(doge, alice) - aTokBeforeCancel, left, "cancelling a DCA refunds the unspent escrow");
const mine = JSON.parse(w.view(dex, "ordersOf", [alice]));
ok(mine.includes(limId) && mine.includes(dcaSell), "ordersOf indexes every alice order");
dexInvariant(dex, "after DCA");

// ── treasury routing ───────────────────────────────────────────────────
section("treasury: changeable any time, fees follow it");
reverts(() => w.tx(evil, dex, "setTreasury", [evil]), /not admin/, "only admin sets DEX treasury");
w.tx(admin, dex, "setTreasury", [treasury2]);
const t1 = w.bal(treasury), t2 = w.bal(treasury2);
w.tx(bob, dex, "swapExactIn", [pid, NATIVE, S(10n * ASE), "0"], 10n * ASE);
fee = 10n * ASE - (10n * ASE * 9970n) / 10000n;
eq(w.bal(treasury2) - t2, fee, "LP fully burned → 100% of the fee goes to the NEW treasury");
eq(w.bal(treasury) - t1, 0n, "old treasury receives nothing");
w.tx(admin, dex, "setTreasuryShareBps", ["0"]);
const t2b = w.bal(treasury2);
w.tx(bob, dex, "swapExactIn", [pid, NATIVE, S(ASE), "0"], ASE);
eq(w.bal(treasury2) - t2b, ASE - (ASE * 9970n) / 10000n, "no live LP → treasury keeps the whole fee regardless of share bps");
w.tx(admin, dex, "setTreasuryShareBps", ["6667"]);
w.tx(admin, pad, "setTreasury", [treasury2]);
eq(w.view(pad, "treasury"), treasury2, "AsePad treasury also repointable");
dexInvariant(dex, "after treasury change");

// ── ARC-20 factory + standard (external) tokens ────────────────────────
section("ARC-20 factory + standard token (2 signatures: deploy + register)");
const std = w.deploySource(buildStandardTokenSource({ name: "Stable", symbol: "STD", decimals: "6", supply: "1000000000000", creator: carol, metadata: JSON.stringify({ logoUrl: "https://x/std.png", website: "stable.example", twitter: "@stable" }) }), "STD", "arc20-base.js");
const stdSrc = w.sources.get(std).split("\n");
ok(stdSrc.includes("// $STD · Stable") && stdSrc.includes("// Created with AsePad Token Studio — https://asepad.fun"), "standard token header: ticker + created with asepad.fun");
eq(`${w.view(std, "website")}|${w.view(std, "twitter")}`, "stable.example|@stable", "standard token socials on-chain");
eq(tb(std, carol), 1000000000000n, "standard token: supply at creator from genesis");
eq(w.view(std, "logoUrl"), "https://x/std.png", "metadata logo readable");
w.tx(admin, factory, "setFee", ["token_deploy:STANDARD", S(2n * ASE)]);
reverts(() => w.tx(carol, factory, "registerToken", [std, "STANDARD", carol, "{}"], ASE), /insufficient token creation fee/, "registration fee enforced");
const fTre = w.bal(treasury), cAseF = w.bal(carol);
w.tx(carol, factory, "registerToken", [std, "STANDARD", evil, "{}"], 3n * ASE);
eq(w.bal(treasury) - fTre, 2n * ASE, "factory fee paid to treasury");
eq(cAseF - w.bal(carol), 2n * ASE, "overpayment refunded");
const rec = w.json(factory, "getTokenByAddress", [std]);
eq(rec.creator, carol, "non-admin registration forces creator = caller");
reverts(() => w.tx(carol, factory, "registerToken", [std, "STANDARD", carol, "{}"], 2n * ASE), /already registered/, "no duplicate registration");
w.tx(admin, factory, "registerToken", [doge, "ASEPAD", creator, "{}"]);
eq(w.json(factory, "getTokenByAddress", [doge]).archetype, "ASEPAD", "AsePad token registers (pad binding verified)");
reverts(() => w.tx(admin, factory, "registerToken", [foreign, "ASEPAD", creator, "{}"]), /not bound to AsePad/, "foreign-pad token rejected as ASEPAD");
reverts(() => w.tx(evil, factory, "setAsePad", [evil]), /not admin/, "only admin repoints factory");

// ── Tax ARC-20: standard token + genesis-locked ≤4% buy/sell tax ──────────
section("ARC-20 tax token (works at deploy; registration only lists it)");
const taxw = w.account("taxw", 0n);
const LEGACY_DEX = "0x63f640a9b98b6f28e06cb5cc0fce5d72b6c0eabd";
const TAXSUP = 100_000_000n * ASE;
const tax = w.deploySource(buildTaxTokenSource({
  name: "TaxMe", symbol: "TAXM", decimals: "18", supply: S(TAXSUP), creator: carol, metadata: "{}",
  dex, dex2: LEGACY_DEX, buyTaxBps: "200", sellTaxBps: "300", taxWallet: taxw
}), "TAXM", "arc20-tax.js");
eq(tb(tax, carol), TAXSUP, "tax token: supply at creator from genesis");
eq(`${w.view(tax, "buyTaxBps")}|${w.view(tax, "sellTaxBps")}|${w.view(tax, "taxWallet")}`, `200|300|${taxw}`, "tax rates + wallet locked at genesis");
eq(w.view(tax, "boundDexes"), JSON.stringify([dex, LEGACY_DEX]), "both dexes bound");
w.tx(carol, tax, "transfer", [bob, "1000"]);
eq(tb(tax, bob), 1000n, "tax token transfers work immediately — no registration gate");
w.tx(admin, factory, "setFee", ["token_deploy:TAX", S(2n * ASE)]);
reverts(() => w.tx(carol, factory, "registerToken", [tax, "TAX", carol, "{}"], ASE), /insufficient token creation fee/, "tax registration needs the 2 ASE fee");
const fTre2 = w.bal(treasury);
w.tx(carol, factory, "registerToken", [tax, "TAX", carol, "{}"], 2n * ASE);
eq(w.bal(treasury) - fTre2, 2n * ASE, "tax registration fee to treasury");
eq(w.json(factory, "getTokenByAddress", [tax]).archetype, "TAX", "TAX archetype recorded");
w.tx(carol, tax, "transfer", [bob, S(1_000_000n)]);
eq(tb(tax, bob), 1_001_000n, "wallet-to-wallet transfer untaxed after activation");
const twSell0 = tb(tax, taxw);
w.tx(bob, tax, "transfer", [dex, "10000"]);
// Grossed-up tax: 10000*300/9700 = 309.27 → 309, i.e. 3% of the 10309 total moved.
eq(tb(tax, taxw) - twSell0, 309n, "sell into dex: 3% of total moved to tax wallet");
eq(tb(tax, dex), 10000n, "sell: dex still receives the exact amount");
eq(tb(tax, bob), 1_001_000n - 10_309n, "sell: sender pays amount+grossed-up tax");
const twBuy0 = tb(tax, taxw);
w.tx(dex, tax, "transfer", [alice, "1000"]);
eq(tb(tax, alice), 980n, "buy from dex: 2% skimmed");
eq(tb(tax, taxw) - twBuy0, 20n, "buy tax routed to tax wallet");
w.tx(dex, tax, "transfer", [carol, "1000"]);
eq(tb(tax, carol), TAXSUP - 1_001_000n + 1000n, "buy to exempt creator: no tax");
w.tx(bob, tax, "transfer", [alice, "500"]);
eq(tb(tax, alice), 980n + 500n, "plain transfer stays untaxed");

section("external ARC-20 pool: permissionless, approve-based");
reverts(() => w.tx(carol, dex, "createPool", [NATIVE, std, "7"]), /unsupported fee tier/, "only 0.01/0.05/0.30/1.00% tiers");
w.tx(carol, dex, "createPool", [NATIVE, std, "100"]);
const spid = w.view(dex, "poolForPair", [NATIVE, std]);
ok(spid, "anyone can create a pool for a non-AsePad ARC-20");
eq(poolOf(dex, spid).feeBps, "100", "creator-chosen 1.00% fee tier applied");
eq(poolOf(dex, pid).feeBps, "30", "migration pool fixed at 0.30%");
reverts(() => w.tx(carol, dex, "createPool", [std, NATIVE, "30"]), /pool exists/, "duplicate pair (either order)");
reverts(() => w.tx(carol, dex, "createPool", [std, std, "30"]), /identical tokens/, "identical tokens");
reverts(() => w.tx(carol, dex, "addLiquidity", [spid, S(10n * ASE), "1000000000", "0"], 10n * ASE), /allowance exceeded/, "standard token still needs an approve");
reverts(() => w.view(std, "trustedSpender", [dex]), /no method/, "standard token has no trusted spenders");
w.tx(carol, std, "approve", [dex, "1000000000"]);
w.tx(carol, dex, "addLiquidity", [spid, S(10n * ASE), "1000000000", "0"], 10n * ASE);
ok(BigInt(w.view(dex, "sharesOf", [spid, carol])) > 0n, "first LP on external pool");
w.tx(alice, dex, "swapExactIn", [spid, NATIVE, S(ASE), "0"], ASE);
const aStd = tb(std, alice);
ok(aStd > 0n, "buy external token");
reverts(() => w.tx(alice, dex, "swapExactIn", [spid, std, S(aStd), "0"]), /allowance exceeded/, "sell external token needs approve");
w.tx(alice, std, "approve", [dex, S(aStd)]);
w.tx(alice, dex, "swapExactIn", [spid, std, S(aStd), "0"]);
eq(tb(std, alice), 0n, "sell external token after approve");
dexInvariant(dex, "after external pool");

// ── ARC-20 / ARC-20 pools + LP fee earnings ────────────────────────────
section("ARC-20/ARC-20 pool lifecycle + LP earns its fee share");
const tkb = w.deploySource(buildStandardTokenSource({ name: "TokenB", symbol: "TKB", decimals: "18", supply: S(SUP), creator: bob, metadata: "{}" }), "TKB", "arc20-base.js");
w.tx(carol, dex, "createPool", [std, tkb, "30"]);
const ppid2 = w.view(dex, "poolForPair", [std, tkb]);
ok(ppid2, "ARC-20/ARC-20 pool created (no ASE leg)");
reverts(() => w.tx(bob, dex, "addLiquidity", [ppid2, "0", "0", "0"]), /invalid liquidity amounts/, "zero LP rejected");
// bob seeds the STD/TKB pool — needs STD first, buys it on the ASE pool
w.tx(bob, dex, "swapExactIn", [spid, NATIVE, S(2n * ASE), "0"], 2n * ASE);
const bobStd = tb(std, bob);
ok(bobStd > 0n, "bob bought STD on its ASE pool");
w.tx(bob, std, "approve", [dex, S(bobStd)]);
w.tx(bob, tkb, "approve", [dex, S(2000n * ASE)]);
const seedStd = bobStd / 2n;
w.tx(bob, dex, "addLiquidity", [ppid2, S(seedStd), S(1000n * ASE), "0"]);
ok(BigInt(w.view(dex, "sharesOf", [ppid2, bob])) > 0n, "first LP on token/token pool");
// alice adds proportional liquidity — ratio-quoted like the UI does
// (bob funds her with both tokens first since alice sold all her STD)
w.tx(bob, tkb, "transfer", [alice, S(500n * ASE)]);
const aliceStdIn = seedStd / 2n;
w.tx(bob, std, "transfer", [alice, S(aliceStdIn)]);
const aliceTkbNeed = aliceStdIn * BigInt(poolOf(dex, ppid2).reserve1) / BigInt(poolOf(dex, ppid2).reserve0);
w.tx(alice, std, "approve", [dex, S(aliceStdIn)]);
w.tx(alice, tkb, "approve", [dex, S(aliceTkbNeed)]);
w.tx(alice, dex, "addLiquidity", [ppid2, S(aliceStdIn), S(aliceTkbNeed), "0"]);
ok(BigInt(w.view(dex, "sharesOf", [ppid2, alice])) > 0n, "second LP on token/token pool");
// swap TKB → STD on the token/token pool; check where the fee lands
const r0b = poolOf(dex, ppid2);
const inIs0 = r0b.token0 === tkb;
const tkIn = 10n * ASE;
w.tx(bob, tkb, "approve", [dex, S(tkIn)]);
const t2c = tb(tkb, treasury2); // treasury was repointed to treasury2 earlier
w.tx(bob, dex, "swapExactIn", [ppid2, tkb, S(tkIn), "0"]);
const r0a = poolOf(dex, ppid2);
const feeTk = tkIn - (tkIn * 9970n) / 10000n;
const treasuryFeeTk = (feeTk * 6667n) / 10000n;
eq(tb(tkb, treasury2) - t2c, treasuryFeeTk, "token/token swap pays treasury its share in TKB");
const rinKey = inIs0 ? "reserve0" : "reserve1";
const lpFeeTk = feeTk - treasuryFeeTk;
eq(BigInt(r0a[rinKey]) - BigInt(r0b[rinKey]), tkIn - feeTk, "full fee leaves reserves (snapshot rewards model)");
eq(BigInt(r0a["pot" + (inIs0 ? "0" : "1")]) - BigInt(r0b["pot" + (inIs0 ? "0" : "1")]), lpFeeTk, "LP share accrued to the rewards pot, not reserves");
ok(BigInt(r0a["rps" + (inIs0 ? "0" : "1")]) > BigInt(r0b["rps" + (inIs0 ? "0" : "1")]), "reward-per-share index advanced on the swap");
// snapshot math: rewards split by shares held WHEN the fee landed (bob + alice both held)
const aShares = BigInt(w.view(dex, "sharesOf", [ppid2, alice]));
const bShares = BigInt(w.view(dex, "sharesOf", [ppid2, bob]));
const earners = BigInt(r0b.totalShares); // no burned shares on this pool
const aPend = JSON.parse(w.view(dex, "lpPendingRewards", [ppid2, alice]));
const bPend = JSON.parse(w.view(dex, "lpPendingRewards", [ppid2, bob]));
const aPendIn = BigInt(aPend["amount" + (inIs0 ? "0" : "1")]);
const bPendIn = BigInt(bPend["amount" + (inIs0 ? "0" : "1")]);
ok(aPendIn >= aShares * lpFeeTk / earners - 2n && aPendIn <= aShares * lpFeeTk / earners + 2n, "alice's pending reward = her share of the fee (snapshot)");
ok(bPendIn >= bShares * lpFeeTk / earners - 2n && bPendIn <= bShares * lpFeeTk / earners + 2n, "bob's pending reward = his share of the fee (snapshot)");
ok(aPendIn + bPendIn <= lpFeeTk, "total owed never exceeds the pot");
// latecomer earns nothing from a fee that landed before their entry
const dave = w.account("dave");
w.tx(bob, dex, "transferShares", [ppid2, dave, "1"]);
eq(JSON.parse(w.view(dex, "lpPendingRewards", [ppid2, dave]))["amount" + (inIs0 ? "0" : "1")], "0", "transferred-in shares start at the current index — no retroactive rewards");
// remove anytime — no lock — and rewards auto-claim on the way out
const aIn0 = tb(tkb, alice);
const remOut = JSON.parse(w.tx(alice, dex, "removeLiquidity", [ppid2, S(aShares / 2n), "0", "0"]));
ok(BigInt(remOut.amount0) > 0n && BigInt(remOut.amount1) > 0n, "remove returns both pool tokens");
const remIn = BigInt(remOut[inIs0 ? "amount0" : "amount1"]);
eq(remIn, (aShares / 2n) * BigInt(r0a[rinKey]) / BigInt(r0a.totalShares), "withdrawal is pure pro-rata (fee never entered reserves)");
ok(tb(tkb, alice) - aIn0 - remIn >= aPendIn - 1n, "accrued LP rewards auto-claimed on remove");
dexInvariant(dex, "after token/token pool");

section("owner-settable ASE/USD reference rate");
eq(w.view(pad, "aseUsdScaled"), "0", "rate unset at init");
reverts(() => w.tx(evil, pad, "setAseUsdScaled", ["3418000"]), /not admin/, "only owner sets ASE/USD rate");
w.tx(admin, pad, "setAseUsdScaled", ["3418000"]);
eq(w.view(pad, "aseUsdScaled"), "3418000", "owner sets ASE/USD rate (3.418)");
ok(JSON.parse(w.view(pad, "config")).aseUsdScaled === "3418000", "rate exposed in config() for the UI");
reverts(() => w.tx(admin, pad, "setAseUsdScaled", [S(2000000n * 10n ** 6n)]), /out of range/, "absurd rate rejected");

// snapshot rewards on a zero-live-LP pool: full fee routes to treasury (covered above)
// and a direct claim on nothing reverts cleanly
reverts(() => w.tx(evil, dex, "claimLpRewards", [ppid2]), /no LP rewards/, "no shares → no rewards → claim reverts");

// ── repoint AsePad to AseDex v2: new launches move, old stay ───────────
section("AsePad repoint: new launches → AseDex v2, old launches stay on v1");
const dex2 = w.deploy("asedex.js", undefined, "asedex2");
w.tx(admin, dex2, "init", [admin, pad, treasury2, "30"]);
reverts(() => w.tx(evil, pad, "setAseDex", [dex2]), /not admin/, "only admin repoints AsePad");
w.tx(admin, pad, "setAseDex", [dex2]);
eq(w.view(pad, "aseDex"), dex2, "AsePad now points at v2 (allowed after launches)");
eq(launchOf(doge).aseDex, dex, "DOGE launch still bound to v1");
const pepe = padToken("Pepe", "PEPE", alice);
w.tx(alice, pad, "createLaunch", launchArgs(pepe, "Pepe", "PEPE"), ASE);
eq(launchOf(pepe).aseDex, dex2, "new PEPE launch snapshots v2");
eq(w.view(pepe, "aseDex"), dex2, "PEPE token bound to v2");
reverts(() => w.tx(evil, dex2, "createPool", [NATIVE, pepe, "30"]), /locked until migration/, "v2 gate: PEPE locked while BONDING");
reverts(() => w.tx(evil, dex, "createPool", [NATIVE, pepe, "30"]), /locked until migration/, "v1 gate: PEPE locked there too");
w.tx(bob, pad, "buy", [pepe, "0"], 120n * ASE);
eq(launchOf(pepe).status, "MIGRATED", "PEPE bonds and migrates on v2 in one tx");
ok(w.view(dex2, "poolForPair", [NATIVE, pepe]), "PEPE pool lives on v2");
eq(w.view(dex, "poolForPair", [NATIVE, pepe]), "", "no PEPE pool on v1");
const ppid = w.view(dex2, "poolForPair", [NATIVE, pepe]);
eq(w.view(dex2, "sharesOf", [ppid, ZERO]), poolOf(dex2, ppid).totalShares, "PEPE LP fully burned on v2");
w.tx(bob, dex2, "swapExactIn", [ppid, pepe, S(tb(pepe, bob) / 10n), "0"]);
ok(true, "PEPE sells on v2 without approve");
w.tx(bob, dex, "swapExactIn", [pid, NATIVE, S(ASE), "0"], ASE);
ok(true, "DOGE keeps trading on v1");
padInvariant("final");
dexInvariant(dex, "final v1");
dexInvariant(dex2, "final v2");

// ── edge: an initial buy that fills the curve migrates inside createLaunch ──
section("createLaunch initial buy → instant migration");
const bonk = padToken("Bonk", "BONK", carol);
const carolBefore = w.bal(carol);
w.tx(carol, pad, "createLaunch", launchArgs(bonk, "Bonk", "BONK"), ASE + 150n * ASE);
const bonkL = launchOf(bonk);
eq(bonkL.status, "MIGRATED", "initial buy filling the curve migrates inside createLaunch");
eq(w.view(pad, "getLaunchStatus", [bonk]), "MIGRATED", "status view agrees on instant migration");
const bonkDex = bonkL.aseDex;
const bonkPid = w.view(bonkDex, "poolForPair", [NATIVE, bonk]);
ok(bonkPid, "BONK pool created on its bound AseDex by the create tx");
const bonkPool = poolOf(bonkDex, bonkPid);
eq(w.view(bonkDex, "sharesOf", [bonkPid, ZERO]), bonkPool.totalShares, "BONK LP burned to 0x0 in the same tx");
eq(bonkPool.reserve0, bonkL.migrationAseWei, "BONK pool ASE reserve == migrated ASE");
ok(tb(bonk, carol) > 0n, "creator received initial-buy + non-curve tokens");
eq(w.bal(carol), carolBefore - 150n * ASE, "creator reward settled inside the create tx (paid 151, got 1% back)");
reverts(() => w.tx(bob, pad, "buy", [bonk, "0"], ASE), /not bonding/, "instant-migrated token has no curve trading");
w.tx(carol, bonk, "transfer", [alice, S(ASE)]);
ok(tb(bonk, alice) > 0n, "instant-migrated token transfers freely");
padInvariant("after instant migration");
dexInvariant(dex2, "after instant migration");

// ── edge: exact-threshold boundary — reserve == target migrates ─────────
section("exact-threshold bond → migration");
const wif = padToken("Wif", "WIF", creator);
w.tx(creator, pad, "createLaunch", launchArgs(wif, "Wif", "WIF"), ASE);
const wifL = launchOf(wif);
eq(BigInt(wifL.aseReserve), 0n, "fresh launch starts at zero reserve");
// fee = gross/100 → send 100 ASE gives net 99 ASE; a follow-up exact-top-up buy lands reserve == target
w.tx(alice, pad, "buy", [wif, "0"], TARGET);
let wifMid = launchOf(wif);
eq(wifMid.status, "BONDING", "99 ASE net is still under the 100 ASE target");
const remaining = TARGET - BigInt(wifMid.aseReserve);
const topUpGross = (remaining * 10000n) / 9900n; // gross such that net covers the gap exactly
w.tx(bob, pad, "buy", [wif, "0"], topUpGross);
wifMid = launchOf(wif);
eq(wifMid.status, "MIGRATED", "buy reaching the threshold migrates in the same tx");
ok(BigInt(wifMid.finalAseReserve) >= TARGET, "final ASE reserve >= target");
const wifPid = w.view(wifMid.aseDex, "poolForPair", [NATIVE, wif]);
eq(w.view(wifMid.aseDex, "sharesOf", [wifPid, ZERO]), poolOf(wifMid.aseDex, wifPid).totalShares, "WIF LP fully burned");
padInvariant("after threshold migration");
dexInvariant(dex2, "after threshold migration");

// ── pad upgrade: export BONDING launches to a successor pad ─────────────
section("pad upgrade → successor pad import");
const pad2 = w.deploy("asepad.js", undefined, "asepad2");
w.tx(admin, pad2, "init", [admin, treasury, ZERO, dex, S(ASE), "100", S(TARGET), "100", S(30n * ASE), true]);
const pad2Invariant = (label) => {
  const c = w.json(pad2, "config");
  eq(w.bal(pad2), BigInt(c.heldWei), `${label}: pad2 native balance == heldWei ledger`);
};
const move = padToken("Move", "MOVE", creator);
w.tx(creator, pad, "createLaunch", launchArgs(move, "Move", "MOVE"), ASE);
w.tx(alice, pad, "buy", [move, "0"], 20n * ASE);
const moveBefore = launchOf(move);
eq(moveBefore.status, "BONDING", "MOVE still bonding before export");
reverts(() => w.tx(evil, pad, "exportLaunch", [move]), /not admin/, "only admin exports launches");
reverts(() => w.tx(admin, pad, "exportLaunch", [move]), /no upgrade pad/, "export blocked before upgrade pad set");
w.tx(admin, pad2, "setLegacyPad", [pad]);
w.tx(admin, pad, "setUpgradePad", [pad2]);
eq(w.view(pad, "upgradePad"), pad2, "upgrade pad configured");
reverts(() => w.tx(evil, pad2, "importLaunch", [JSON.stringify(moveBefore)]), /not legacy pad/, "import only from configured legacy pad");
reverts(() => w.tx(evil, dex2, "trustPad", [pad2]), /not admin/, "only admin trusts a successor pad");
// migrated launches export as record-only tombstones — no funds move, the
// token rebinds, and the new pad keeps the complete launch history/counts
w.tx(admin, pad, "exportLaunch", [doge]);
eq(launchOf(doge).status, "EXPORTED", "old pad tombstones the migrated record");
eq(w.json(pad2, "getLaunch", [doge]).status, "MIGRATED", "new pad keeps the migrated launch record");
eq(w.view(doge, "pad"), pad2, "migrated token re-bound to the new pad");
w.tx(alice, dex, "swapExactIn", [pid, doge, S(tb(doge, alice) / 10n), "0"]);
ok(true, "DOGE still trades on its pool after the pad upgrade — status follows the token");
const padBalBefore = w.bal(pad), pad2BalBefore = w.bal(pad2);
w.tx(admin, pad, "exportLaunch", [move]);
const moveOld = launchOf(move);
eq(moveOld.status, "EXPORTED", "old pad marks the launch EXPORTED");
eq(moveOld.exportedTo, pad2, "old pad records the export target");
eq(moveOld.aseReserve, "0", "old pad ASE reserve cleared");
reverts(() => w.tx(bob, pad, "buy", [move, "0"], ASE), /not bonding/, "exported launch cannot trade on old pad");
reverts(() => w.tx(admin, pad, "exportLaunch", [move]), /not exportable/, "double export rejected");
eq(w.bal(pad2) - pad2BalBefore, BigInt(moveBefore.aseReserve), "new pad received the exact ASE reserve");
eq(w.bal(pad), padBalBefore - BigInt(moveBefore.aseReserve), "old pad ASE custody dropped by the reserve");
eq(tb(move, pad), 0n, "old pad holds no MOVE after export");
eq(tb(move, pad2), BigInt(moveBefore.tokenReserve), "new pad received the exact curve tokens");
eq(w.view(move, "pad"), pad2, "token re-bound to the new pad");
eq(w.view(move, "trustedSpender", [pad2]), true, "new pad gained pull privilege");
eq(w.view(move, "trustedSpender", [pad]), false, "old pad lost pull privilege");
const move2 = w.json(pad2, "getLaunch", [move]);
eq(move2.status, "BONDING", "imported launch is BONDING on the new pad");
eq(move2.aseReserve, moveBefore.aseReserve, "imported ASE reserve unchanged");
eq(move2.tokenReserve, moveBefore.tokenReserve, "imported token reserve unchanged");
eq(move2.creator, moveBefore.creator, "imported creator unchanged");
eq(move2.aseDex, dex2, "imported launch keeps the token-bound dex (not pad2's default)");
eq(move2.importedFrom, pad, "import provenance recorded");
padInvariant("old pad after export");
pad2Invariant("new pad after import");

// trading continues seamlessly on the new pad — buys and sells, no re-approve
const moveBobBefore = tb(move, bob);
w.tx(bob, pad2, "buy", [move, "0"], 30n * ASE);
ok(tb(move, bob) > moveBobBefore, "buy on the new pad after import");
w.tx(bob, pad2, "sell", [move, S(ASE), "0"]);
ok(true, "sell on the new pad after import (trusted pull)");
// the token-bound dex2 doesn't know pad2 yet — migration must fail until trusted
reverts(() => w.tx(carol, pad2, "buy", [move, "0"], 150n * ASE), /not AsePad|locked until migration/, "untrusted pad cannot migrate on the token's dex");
w.tx(admin, dex2, "trustPad", [pad2]);
eq(w.view(dex2, "trustedPad", [pad2]), "1", "dex2 now trusts the successor pad");
w.tx(carol, pad2, "buy", [move, "0"], 150n * ASE);
eq(w.json(pad2, "getLaunch", [move]).status, "MIGRATED", "imported launch migrates on the new pad in one buy");
const movePid = w.view(dex2, "poolForPair", [NATIVE, move]);
ok(movePid, "imported launch migrated onto the token-bound dex2");
ok(!w.view(dex, "poolForPair", [NATIVE, move]) || w.view(dex, "poolForPair", [NATIVE, move]) === "null", "no pool on pad2's default dex — token binding wins");
eq(w.view(dex2, "sharesOf", [movePid, ZERO]), poolOf(dex2, movePid).totalShares, "MOVE LP burned on dex2");
eq(w.view(move, "aseDexLocked"), false, "new pad unlocked the token for AseDex");
pad2Invariant("after imported migration");
dexInvariant(dex2, "after imported migration");

// repointable pad binding: the dex survives pad upgrades — no redeploy ever
w.tx(admin, dex2, "setAsePad", [pad2]);
eq(w.view(dex2, "asePad"), pad2, "dex repointed to the successor pad with live pools");
eq(w.view(dex2, "trustedPad", [pad]), "1", "outgoing pad auto-trusted after repoint");
w.tx(alice, dex2, "swapExactIn", [movePid, move, S(tb(move, alice) / 10n), "0"]);
ok(true, "pool keeps trading after a pad repoint");

// batch export: every remaining launch (bonding + migrated tombstones) moves
const btch = padToken("Batch", "BTCH", creator);
w.tx(creator, pad, "createLaunch", launchArgs(btch, "Batch", "BTCH"), ASE + 10n * ASE);
eq(w.tx(admin, pad, "exportLaunches", ["50"]), "4", "exportLaunches sweeps bonding + migrated records");
eq(launchOf(btch).status, "EXPORTED", "batch export marks the old record");
eq(w.json(pad2, "getLaunch", [btch]).status, "BONDING", "batch import lands on the new pad");
eq(w.view(btch, "pad"), pad2, "BTCH re-bound by batch export");
for (const [t, s] of [[pepe, "MIGRATED"], [bonk, "MIGRATED"], [wif, "MIGRATED"]]) {
  eq(w.json(pad2, "getLaunch", [t]).status, s, `new pad holds ${s} tombstone`);
}
eq(Number(w.view(pad2, "launchCount")), 6, "new pad launch count mirrors the old pad");
reverts(() => w.tx(evil, btch, "migratePad", [evil]), /only AsePad/, "wallets cannot rebind a token's pad directly");
reverts(() => w.tx(evil, pad2, "exportLaunch", [btch]), /not admin/, "only admin exports on the new pad too");
padInvariant("after batch export");
pad2Invariant("after batch import");

console.log(`\nALL ${passedCount()} CHECKS PASSED`);
