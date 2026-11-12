// Adversarial scenarios against AsePad / AseDex / factory in the in-memory runtime.
// Each scenario is independent; any "VULNERABLE" line fails the run.
// Run: pnpm --filter @asentrise/contracts sim:attacks   (after `build`)
import { World, ZERO, NATIVE, ASE, ok, eq, reverts, section, passedCount } from "./world.mjs";
import { buildPadTokenSource, buildStandardTokenSource, verifyTokenSourceString } from "../../dist/browser.js";

const S = (v) => String(v);
const SUP = 1_000_000_000n * ASE;
const failures = [];
function run(title, fn) {
  section(title);
  try { fn(); } catch (e) { failures.push(title); console.log("  ✗ VULNERABLE:", e.message.split("\n")[0]); }
}
function setup() {
  const w = new World();
  const a = Object.fromEntries(["admin", "treasury", "creator", "alice", "bob", "evil", "keeper"].map((t) => [t, w.account(t)]));
  const dex = w.deploy("asedex.js", undefined, "asedex");
  const pad = w.deploy("asepad.js", undefined, "asepad");
  const factory = w.deploy("arc20-factory.js", undefined, "factory");
  w.tx(a.admin, dex, "init", [a.admin, pad, a.treasury, "30"]);
  w.tx(a.admin, pad, "init", [a.admin, a.treasury, ZERO, dex, S(ASE), "100", S(100n * ASE), "100", S(30n * ASE), false]);
  w.tx(a.admin, factory, "init", [a.admin, a.treasury, pad]);
  const std = (who, sym) => w.deploySource(buildStandardTokenSource({ name: sym, symbol: sym, decimals: "18", supply: S(SUP), creator: who, metadata: "{}" }), sym, "arc20-base.js");
  const pool = (who, token, ase, tok) => {
    w.tx(who, dex, "createPool", [NATIVE, token, "30"]);
    const id = w.view(dex, "poolForPair", [NATIVE, token]);
    w.tx(who, token, "approve", [dex, S(tok)]);
    w.tx(who, dex, "addLiquidity", [id, S(ase), S(tok), "0"], ase);
    return id;
  };
  return { w, ...a, dex, pad, factory, std, pool };
}
// Counts order records a contract call reads — a proxy for its gas cost.
function countOrderReads(w, contract, fn) {
  const store = w.contracts.get(contract).store;
  const get = store.get.bind(store);
  let reads = 0;
  store.get = (k) => { if (String(k).startsWith("order:")) reads++; return get(k); };
  try { fn(); } finally { store.get = get; }
  return reads;
}

run("order-book spam cannot DoS swaps", () => {
  const { w, alice, bob, evil, dex, std, pool } = setup();
  const tkn = std(alice, "TKN");
  const pid = pool(alice, tkn, 100n * ASE, 100_000n * ASE);
  let placed = 0;
  for (let i = 0; i < 400; i++) {
    try { w.tx(evil, dex, "createLimitOrder", [pid, NATIVE, S(ASE), S(10n ** 40n)], ASE); placed++; } catch { break; }
  }
  ok(placed < 400, `spam is capped (evil placed ${placed} unfillable orders from one wallet)`);
  const reads = countOrderReads(w, dex, () => w.tx(bob, dex, "swapExactIn", [pid, NATIVE, S(ASE), "0"], ASE));
  ok(reads <= 16, `a swap reads a bounded slice of the book (${reads} order reads)`);
  reverts(() => w.tx(w.account("dust"), dex, "createLimitOrder", [pid, NATIVE, "1", "1"], 1n), /order too small/, "dust orders rejected");
});

run("a hostile token's orders cannot brick other pools", () => {
  const { w, alice, bob, evil, dex, std, pool } = setup();
  const good = std(alice, "GOOD");
  const gid = pool(alice, good, 100n * ASE, 100_000n * ASE);
  // TRAP token: transfer() reverts once armed, so any payout in TRAP fails.
  const trap = w.deploySource(`
    function _n(v){return String(v).toLowerCase();}
    ({
      name(){return 'Trap';}, symbol(){return 'TRAP';}, decimals(){return '18';}, totalSupply(){return '${SUP}';},
      balanceOf(a){return storage.get('b:'+_n(a))||'0';},
      mint(to,v){storage.set('b:'+_n(to),String(BigInt(storage.get('b:'+_n(to))||'0')+BigInt(v)));return true;},
      arm(){storage.set('armed','1');return true;},
      approve(){return true;},
      transferFrom(f,t,v){const fb=BigInt(storage.get('b:'+_n(f))||'0');assert(fb>=BigInt(v),'bal');storage.set('b:'+_n(f),String(fb-BigInt(v)));storage.set('b:'+_n(t),String(BigInt(storage.get('b:'+_n(t))||'0')+BigInt(v)));return true;},
      transfer(t,v){assert(storage.get('armed')!=='1','trap sprung');const s=_n(msg.sender);const fb=BigInt(storage.get('b:'+s)||'0');storage.set('b:'+s,String(fb-BigInt(v)));storage.set('b:'+_n(t),String(BigInt(storage.get('b:'+_n(t))||'0')+BigInt(v)));return true;}
    })`, "TRAP");
  w.tx(evil, trap, "mint", [evil, S(SUP)]);
  w.tx(evil, dex, "createPool", [NATIVE, trap, "30"]);
  const tid = w.view(dex, "poolForPair", [NATIVE, trap]);
  w.tx(evil, dex, "addLiquidity", [tid, S(10n * ASE), S(10_000n * ASE), "0"], 10n * ASE);
  // A fillable ASE→TRAP order whose TRAP payout reverts once the trap is armed.
  w.tx(evil, dex, "createLimitOrder", [tid, NATIVE, S(ASE), "1"], ASE);
  w.tx(evil, trap, "arm");
  w.tx(bob, dex, "swapExactIn", [gid, NATIVE, S(ASE), "0"], ASE);
  ok(true, "swaps on GOOD still work while TRAP's order is poisoned");
  w.tx(alice, good, "approve", [dex, S(1000n * ASE)]);
  w.tx(alice, dex, "addLiquidity", [gid, S(ASE), S(1000n * ASE), "0"], ASE);
  ok(true, "liquidity on GOOD still works");
  w.tx(bob, dex, "sweepOrders", [gid]);
  ok(true, "keeper sweep of GOOD unaffected by TRAP");
});

run("factory registry cannot be hijacked", () => {
  const { w, admin, alice, evil, factory, std } = setup();
  w.tx(admin, factory, "setFee", ["token_deploy:STANDARD", S(ASE)]);
  const tkn = std(alice, "ALI");
  reverts(() => w.tx(evil, factory, "registerToken", [tkn, "STANDARD", evil, "{}"], ASE), /only the token creator/, "evil cannot register alice's token as his own");
  w.tx(alice, factory, "registerToken", [tkn, "STANDARD", alice, "{}"], ASE);
  eq(w.json(factory, "getTokenByAddress", [tkn]).creator, alice, "real creator registers it");
});

run("source verification catches tampered tokens", () => {
  const { pad, alice } = setup();
  const good = buildPadTokenSource({ name: "Real", symbol: "REAL", decimals: "18", supply: S(SUP), pad, creator: alice, metadata: "{\"description\":\"hi\"}" });
  eq(verifyTokenSourceString(good), "verified-pad", "genuine generated pad source verifies");
  const std = buildStandardTokenSource({ name: "Std", symbol: "STD", decimals: "18", supply: S(SUP), creator: alice, metadata: "{}" });
  eq(verifyTokenSourceString(std), "verified-standard", "genuine standard source verifies");
  // Inject executable code right after the genesis literal — must NOT verify.
  const evil = good.replace("};", "}; globalThis.pwned = true; //");
  eq(verifyTokenSourceString(evil), "unverified", "source with code after genesis rejected");
  // Non-comment line inside the header card.
  const evilHdr = good.replace("// ───", "evilFn();\n// ───");
  eq(verifyTokenSourceString(evilHdr), "unverified", "code inside the header region rejected");
  // A hand-written look-alike (same method names, different code).
  eq(verifyTokenSourceString("({name(){return'Fake';}})"), "unverified", "look-alike source rejected");
  // Genesis string containing braces (metadata JSON) still verifies.
  const metaBraces = buildPadTokenSource({ name: "M", symbol: "M", decimals: "18", supply: S(SUP), pad, creator: alice, metadata: "{\"a\":{\"b\":1}}" });
  eq(verifyTokenSourceString(metaBraces), "verified-pad", "metadata braces inside genesis verify");
});

run("fake 'AsePad token' contracts cannot launch", () => {
  const { w, evil, alice, pad } = setup();
  // Look-alike: claims the pad binding and a full pad balance, but transferFrom
  // always "succeeds" — would let evil sell tokens he never had.
  const fake = w.deploySource(`
    ({
      name(){return 'Scam';}, symbol(){return 'SCAM';}, decimals(){return '18';}, totalSupply(){return '${SUP}';},
      pad(){return '${pad}';}, creator(){return '${evil}';},
      balanceOf(){return '${SUP}';}, configureAseDex(){return true;}, transfer(){return true;},
      transferFrom(){return true;}, allowance(){return '0';}, approve(){return true;}
    })`, "SCAM");
  reverts(() => w.tx(evil, pad, "createLaunch", [fake, "Scam", "SCAM", S(SUP), S(SUP), "0", "{}"], ASE), /not an AsePad token/, "look-alike token rejected");
  const real = w.deploySource(buildPadTokenSource({ name: "Real", symbol: "REAL", decimals: "18", supply: S(SUP), pad, creator: alice, metadata: "{}" }), "REAL", "arc20-pad.js");
  w.tx(alice, pad, "createLaunch", [real, "Real", "REAL", S(SUP), S(SUP), "0", "{}"], ASE);
  ok(true, "genuine AsePad token launches");
});

run("privileged functions are owner-only", () => {
  const { w, evil, pad, dex, factory } = setup();
  const padAdmin = [["setTreasury", [evil]], ["setAseDex", [evil]], ["setCreationFee", ["0"]], ["setFeeBps", ["0"]], ["setTarget", ["1"]],
    ["setCreatorBps", ["0"]], ["setVirtualAseWei", ["1"]], ["pause", []], ["unpause", []], ["transferAdmin", [evil]], ["retryMigration", [evil]],
    ["rescueAse", [evil, "1"]], ["rescueAllAse", [evil]], ["rescueToken", [evil, evil, "1"]], ["rescueAllToken", [evil, evil]]];
  for (const [m, args] of padAdmin) reverts(() => w.tx(evil, pad, m, args), /not admin/, `AsePad.${m}`);
  const dexAdmin = [["setFeeBps", ["0"]], ["setPoolFeeBps", ["1", "0"]], ["setTreasuryShareBps", ["0"]], ["transferAdmin", [evil]], ["setTreasury", [evil]], ["setAsePad", [evil]]];
  for (const [m, args] of dexAdmin) reverts(() => w.tx(evil, dex, m, args), /not admin/, `AseDex.${m}`);
  reverts(() => w.tx(evil, dex, "seedLiquidity", ["1", "1", "1"]), /not AsePad/, "AseDex.seedLiquidity is AsePad-only");
  const facAdmin = [["setTreasury", [evil]], ["setAsePad", [evil]], ["setFee", ["x", "0"]], ["setFeeBps", ["x", "0"]], ["transferAdmin", [evil]], ["rescueAse", [evil, "1"]]];
  for (const [m, args] of facAdmin) reverts(() => w.tx(evil, factory, m, args), /not admin/, `factory.${m}`);
});

if (failures.length) {
  console.log(`\n${failures.length} ATTACK SCENARIO(S) VULNERABLE: ${failures.join(" | ")}`);
  process.exit(1);
}
console.log(`\nALL ${passedCount()} ATTACK CHECKS PASSED`);
