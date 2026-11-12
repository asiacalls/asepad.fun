import { AsentumClient } from "@asentum/sdk";
const client = new AsentumClient("https://testnet.asentum.com");
const TOKEN = "0x0ea6ef16cc8d8151cf168b9fcfbc643c6276487f";
const TAXW = "0x8d8a3c5aa01a46b4ae9e248e1b6beb40dc0ed435";
const AURA = "0x63f640a9b98b6f28e06cb5cc0fce5d72b6c0eabd";
const DEX = "0xc3833b73eb30242289e533b3e97c4b72b97e24e9";
const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const jv = (v: unknown) => (typeof v === "string" ? (v ? JSON.parse(v) : null) : v) as Record<string, string>;
const fmt = (w: unknown) => `${Number(BigInt(String(w))) / 1e18}`;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const v = async (to: string, m: string, a: unknown[] = []) => { await sleep(4000); return (await client.viewCall(to, m, a)).returnValue; };
console.log("taxWallet TAXP balance:", fmt(await v(TOKEN, "balanceOf", [TAXW])), "TAXP");
for (const [name, dex] of [["AseDex", DEX], ["AuraDex", AURA]] as const) {
  const p = String(await v(dex, "poolForPair", [TOKEN, NATIVE]));
  const pool = jv(await v(dex, "getPool", [p]));
  const t0 = String(pool.token0).toLowerCase() === TOKEN;
  console.log(`${name} pool ${p}: ${t0 ? "token r0" : "token r1"}=${fmt(t0 ? pool.reserve0 : pool.reserve1)} TAXP | ASE=${fmt(t0 ? pool.reserve1 : pool.reserve0)} | swaps=${pool.swapCount} vol=${fmt(pool.volumeAseWei)} ASE`);
}
