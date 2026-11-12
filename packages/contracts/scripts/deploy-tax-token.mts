/** Deploy the fixed tax token (creator = user's wallet) + admin-register it. */
import { config } from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AsentumClient, AsentumWallet } from "@asentum/sdk";
import { getAsentumNetworkFromEnv } from "@asentrise/config";
import { resolveDeployerKeyMaterial } from "./deployer-keys.js";
import { buildTaxTokenSource } from "../dist/browser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", "..", "..", ".env") });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const FACTORY = process.env.CONTRACT_ARC20_FACTORY!;
const DEX = process.env.CONTRACT_ASEDEX!;
const DEX2 = "0x63f640a9b98b6f28e06cb5cc0fce5d72b6c0eabd";
// Same params as the bricked TTAX — creator/taxWallet = the user's wallet.
const USER = "0x8d8a3c5aa01a46b4ae9e248e1b6beb40dc0ed435";
const GEN = {
  name: "Tax Token", symbol: "TTAX", decimals: "18",
  supply: "1000000000000000000000000000", creator: USER, metadata: "{}",
  dex: DEX, dex2: DEX2,
  buyTaxBps: "100", sellTaxBps: "100", taxWallet: USER
};

async function waitTx(client: AsentumClient, hash: string, label: string) {
  const end = Date.now() + 240_000;
  while (Date.now() < end) {
    const r = await client.getReceipt(hash);
    if (r) { if (!r.success) throw new Error(`${label} reverted`); return r; }
    await sleep(3000);
  }
  throw new Error(`${label} not mined in time`);
}

async function main() {
  const client = new AsentumClient(getAsentumNetworkFromEnv(process.env).rpcHttp);
  const keys = resolveDeployerKeyMaterial();
  const wallet = AsentumWallet.fromSecretKey(client, keys.secretKeyHex, keys.publicKeyHex);
  const source = buildTaxTokenSource(GEN);

  console.log("deploying fixed TTAX (creator", USER + ")…");
  const dep = await wallet.deploy({ source, gasLimit: 15_000_000n });
  const r = await waitTx(client, dep.deployTx!.hash, "tax token deploy");
  const token = String(r.recipient).toLowerCase();
  const code = await client.getCode(token);
  if (!code || code === "0x") throw new Error("no code at " + token);
  console.log("token:", token);

  const { hash } = await wallet.sendCall({
    to: FACTORY, method: "registerToken",
    args: [token, "TAX", USER, JSON.stringify({ name: GEN.name, symbol: GEN.symbol, decimals: 18, totalSupply: "1000000000", buyTaxBps: 100, sellTaxBps: 100, taxWallet: USER })],
    gasLimit: 500_000n
  });
  await waitTx(client, hash, "factory registration");
  console.log("registered:", JSON.stringify(await client.viewCall(FACTORY, "getTokenByAddress", [token]).then(x => x.returnValue)));

  const v = (m: string, a: unknown[] = []) => client.viewCall(token, m, a).then(x => x.returnValue);
  console.log("buyTax:", await v("buyTaxBps"), "| sellTax:", await v("sellTaxBps"), "| taxWallet:", await v("taxWallet"), "| userBal:", await v("balanceOf", [USER]));
}

main().catch((e) => { console.error(e); process.exit(1); });
