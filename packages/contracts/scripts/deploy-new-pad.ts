import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AsentumClient, AsentumWallet } from "@asentum/sdk";
import { getAsentumNetworkFromEnv } from "@asentrise/config";
import { resolveDeployerKeyMaterial } from "./deployer-keys.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", "..", "..", ".env") });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const TREASURY = "0x1893731bb05cae5ae3bce6a1e5521e44f17e908d";
const FACTORY = process.env.CONTRACT_ARC20_FACTORY || "";
const INIT = { creationFee: "1000000000000000000", feeBps: "30", target: "100000000000000000000", creatorBps: "100", virtualAse: "1170275014628437682855", aseUsd: "3418000" };

async function waitTx(client: AsentumClient, hash: string, label: string) {
  const end = Date.now() + 240_000;
  while (Date.now() < end) {
    const r = await client.getReceipt(hash);
    if (r) {
      if (!r.success) throw new Error(`${label} reverted: ${JSON.stringify(r).slice(0, 400)}`);
      return r;
    }
    await sleep(3000);
  }
  throw new Error(`${label} not mined in time`);
}

// dep.address is a PREDICTION — the canonical address is the deploy receipt's recipient.
async function deployReal(client: AsentumClient, wallet: AsentumWallet, source: string, gas: bigint, label: string) {
  const dep = await wallet.deploy({ source, gasLimit: gas });
  const r = await waitTx(client, dep.deployTx!.hash, `${label} deploy`);
  const addr = String(r.recipient).toLowerCase();
  const code = await client.getCode(addr);
  if (!code || code === "0x" || code.length < 10) throw new Error(`${label}: no code at ${addr}`);
  console.log(`  ${label}: ${addr} (predicted ${dep.address} — ignored)`);
  return addr;
}

async function main() {
  const client = new AsentumClient(getAsentumNetworkFromEnv(process.env).rpcHttp);
  const keys = resolveDeployerKeyMaterial(process.env);
  const wallet = AsentumWallet.fromSecretKey(client, keys.secretKeyHex, keys.publicKeyHex);
  const src = (f: string) => readFileSync(join(__dirname, "..", "src", "sources", f), "utf8");

  console.log("\n1/6 deploy asedex.js…");
  const dexAddr = await deployReal(client, wallet, src("asedex.js"), 15_000_000n, "asedex");
  await waitTx(client, (await wallet.sendCall({ to: dexAddr, method: "init", args: [wallet.address, wallet.address, TREASURY, "30"], gasLimit: 500_000n })).hash, "asedex init");
  console.log("  ✓ init (placeholder pad = deployer)");

  console.log("\n2/6 deploy asepad.js…");
  const padAddr = await deployReal(client, wallet, src("asepad.js"), 20_000_000n, "asepad");
  await waitTx(client, (await wallet.sendCall({ to: padAddr, method: "init", args: [wallet.address, TREASURY, "0x0000000000000000000000000000000000000000", dexAddr, INIT.creationFee, INIT.feeBps, INIT.target, INIT.creatorBps, INIT.virtualAse, true, INIT.aseUsd], gasLimit: 1_000_000n })).hash, "asepad init");
  console.log("  ✓ init (target 100 ASE)");

  console.log("\n3/6 bind asedex → asepad");
  await waitTx(client, (await wallet.sendCall({ to: dexAddr, method: "setAsePad", args: [padAddr], gasLimit: 300_000n })).hash, "setAsePad");
  await waitTx(client, (await wallet.sendCall({ to: dexAddr, method: "untrustPad", args: [wallet.address], gasLimit: 300_000n })).hash, "untrustPad placeholder");

  console.log("\n4/6 factory.setAsePad (fixes dead pointer)");
  if (!FACTORY) console.log("  ⚠ CONTRACT_ARC20_FACTORY unset — repoint manually");
  else {
    await waitTx(client, (await wallet.sendCall({ to: FACTORY, method: "setAsePad", args: [padAddr], gasLimit: 300_000n })).hash, "factory setAsePad");
    console.log("  ✓ factory →", padAddr);
  }

  console.log("\n5/6 verify views");
  const view = async (to: string, m: string, a: unknown[] = []) => (await client.viewCall(to, m, a)).returnValue;
  console.log("  pad.config:", String(await view(padAddr, "config")).slice(0, 200));
  console.log("  dex.asePad:", await view(dexAddr, "asePad"));

  console.log("\n6/6 ══ ENV UPDATES ══");
  console.log(`CONTRACT_ASEDEX=${dexAddr}`);
  console.log(`NEXT_PUBLIC_CONTRACT_ASEDEX=${dexAddr}`);
  console.log(`CONTRACT_ASEPAD=${padAddr}`);
  console.log(`NEXT_PUBLIC_CONTRACT_ASEPAD=${padAddr}`);
}
main().catch(e => { console.error(e); process.exit(1); });
