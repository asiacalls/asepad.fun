/** Admin: configure the factory's token_deploy:TAX registration fee (2 ASE). */
import { config } from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AsentumClient, AsentumWallet } from "@asentum/sdk";
import { getAsentumNetworkFromEnv } from "@asentrise/config";
import { resolveDeployerKeyMaterial } from "./deployer-keys.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", "..", "..", ".env") });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const FACTORY = process.env.CONTRACT_ARC20_FACTORY!;
const TAX_FEE_WEI = "2000000000000000000"; // 2 ASE

async function main() {
  const client = new AsentumClient(getAsentumNetworkFromEnv(process.env).rpcHttp);
  const keys = resolveDeployerKeyMaterial();
  const wallet = AsentumWallet.fromSecretKey(client, keys.secretKeyHex, keys.publicKeyHex);
  console.log(`factory ${FACTORY} · admin ${wallet.address}`);
  console.log(`before: token_deploy:TAX = ${(await client.viewCall(FACTORY, "getFeeWei", ["token_deploy:TAX"])).returnValue} wei`);

  const { hash } = await wallet.sendCall({
    to: FACTORY, method: "setFee", args: ["token_deploy:TAX", TAX_FEE_WEI], gasLimit: 300_000n
  });
  const end = Date.now() + 240_000;
  let r;
  while (Date.now() < end) {
    r = await client.getReceipt(hash);
    if (r) break;
    await sleep(3000);
  }
  if (!r?.success) throw new Error(`setFee reverted/not mined: ${JSON.stringify(r).slice(0, 300)}`);
  console.log(`after:  token_deploy:TAX = ${(await client.viewCall(FACTORY, "getFeeWei", ["token_deploy:TAX"])).returnValue} wei`);
}

main().catch((e) => { console.error(e); process.exit(1); });
