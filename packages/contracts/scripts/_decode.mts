import { readFileSync } from "node:fs";
const res = await fetch("https://explorer.asentum.com/rpc", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: ["0x5911aee2cc32b3fa91a80791cc612fd3e5ef668d", "latest"] }) });
const dep = Buffer.from(String((await res.json()).result || "").replace(/^0x/, ""), "hex").toString("utf8");
const v1 = readFileSync("src/legacy/arc20-tax.v1.js", "utf8");
const cur = readFileSync("src/sources/arc20-tax.js", "utf8");
const dTail = dep.slice(dep.indexOf("const GENESIS_KEY"));
const vTail = v1.slice(v1.indexOf("const GENESIS_KEY"));
let i = 0; while (i < Math.min(dTail.length, vTail.length) && dTail[i] === vTail[i]) i++;
console.log("first diff at", i, "of", vTail.length);
console.log("DEP :", JSON.stringify(dTail.slice(Math.max(0,i-60), i+80)));
console.log("V1  :", JSON.stringify(vTail.slice(Math.max(0,i-60), i+80)));
