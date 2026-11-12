/** Local sign bridge for UI e2e: browser's injected window.asentum provider
 * POSTs callContract params here; we sign with the deployer key and send. */
import { createServer } from "node:http";
import { config } from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AsentumClient, AsentumWallet } from "@asentum/sdk";
import { getAsentumNetworkFromEnv } from "@asentrise/config";
import { buildStandardTokenSource } from "../dist/browser.js";
import { resolveDeployerKeyMaterial } from "./deployer-keys.js";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", "..", "..", ".env") });
const client = new AsentumClient(getAsentumNetworkFromEnv(process.env).rpcHttp);
const keys = resolveDeployerKeyMaterial(process.env);
const wallet = AsentumWallet.fromSecretKey(client, keys.secretKeyHex, keys.publicKeyHex);
const me = wallet.address;
console.log("sign-server wallet:", me);
createServer(async (req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type");
  if (req.method === "OPTIONS") { res.end(); return; }
  try {
    const body = JSON.parse(await new Promise((r) => { let s = ""; req.on("data", (c) => s += c); req.on("end", () => r(s)); }) || "{}");
    if (req.url === "/address") { res.end(JSON.stringify({ address: me })); return; }
    if (req.url === "/deploy") {
      const metadata = JSON.stringify({ description: "ui e2e", logoUrl: "https://i.postimg.cc/7YQdJHVd/dogease.png" });
      const source = buildStandardTokenSource({ name: "UiSpeed", symbol: body.symbol || "UISPD", decimals: "18", supply: (10_000n * 10n ** 18n).toString(), creator: me.toLowerCase(), metadata });
      const dep = await wallet.deploy({ source, gasLimit: 8_000_000n });
      res.end(JSON.stringify({ hash: dep.deployTx!.hash })); return;
    }
    if (req.url === "/sign") {
      const r = await wallet.sendCall({ to: body.to, method: body.method, args: body.args ?? [], value: BigInt(body.value || 0), gasLimit: BigInt(body.gasLimit || 2_000_000) });
      res.end(JSON.stringify({ hash: r.hash })); return;
    }
    res.statusCode = 404; res.end("{}");
  } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: String(e) })); }
}).listen(3999, () => console.log("sign-server on :3999"));
