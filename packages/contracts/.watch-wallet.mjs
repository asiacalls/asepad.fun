import { AsentumClient } from "@asentum/sdk";

const WALLET = "0x8d8a3c5aa01a46b4ae9e248e1b6beb40dc0ed435"; // ase13k9rck4qrfrtft57yj8pk6ltgrwqa4p4nyc6ef
const NAMES = {
  "0x0a8897fe8440d8f8643f37d2853fd7ba51a5455d": "FACTORY v2",
  "0xf8b9d9ba64e9f5aefe65624ffea9f55d3facfaba": "ROUTER",
  "0x5fb43f354ce937c42171a64f2ea0e00edbe0c706": "OLD FACTORY v1",
  "0xc3833b73eb30242289e533b3e97c4b72b97e24e9": "ASEDEX",
  "0x63f640a9b98b6f28e06cb5cc0fce5d72b6c0eabd": "AURADEX",
  "0x1d3c269e105f11cadb6ae993ee8cf403d32f162c": "ASEPAD",
};
const clients = ["https://testnet.asentum.com", "https://explorer.asentum.com/rpc"].map((u) => new AsentumClient(u));
let ci = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function rpc(fn) {
  for (let i = 0; ; i++) {
    const c = clients[ci++ % clients.length];
    try { return await fn(c); } catch (e) { if (i >= 8) throw e; await sleep(1500 * (i + 1)); }
  }
}
const ts = () => new Date().toLocaleTimeString();
const name = (a) => NAMES[String(a || "").toLowerCase()] || String(a || "");
const ase = (wei) => (Number(BigInt(wei || "0")) / 1e18).toFixed(4);

const bal0 = await rpc((c) => c.getBalance(WALLET));
console.log(`[${ts()}] watching ${WALLET}  balance ${ase(bal0.balance)} ASE  nonce ${bal0.nonce}`);
let last = (await rpc((c) => c.getChainInfo())).height;
let lastBal = bal0.balance;

for (;;) {
  try {
    const head = (await rpc((c) => c.getChainInfo())).height;
    for (let h = last + 1; h <= head; h++) {
      const b = await rpc((c) => c.getBlock(h));
      if (!b) continue;
      (b.receipts || []).forEach((r, i) => {
        if (String(r.sender).toLowerCase() !== WALLET) return;
        const t = (b.transactions || [])[i] || {};
        const what = r.kind === "deploy" ? `DEPLOY → ${r.recipient}` : `${t.call?.method || r.kind} → ${name(r.recipient)}`;
        const val = t.body?.value && t.body.value !== "0" ? `  value ${ase(t.body.value)} ASE` : "";
        console.log(`[${ts()}] block ${h}  ${r.success ? "OK  " : "FAIL"}  ${what}${val}  gas ${r.gasUsed}`);
        if (t.call?.args?.length) console.log(`           args ${JSON.stringify(t.call.args).slice(0, 300)}`);
        for (const ev of r.events || []) console.log(`           event ${ev.name} ${JSON.stringify(ev.data).slice(0, 250)}`);
        if (!r.success && r.returnValue) console.log(`           reason ${JSON.stringify(r.returnValue).slice(0, 300)}`);
      });
      last = h;
    }
    const bal = await rpc((c) => c.getBalance(WALLET));
    if (bal.balance !== lastBal) { console.log(`[${ts()}] balance ${ase(lastBal)} → ${ase(bal.balance)} ASE  nonce ${bal.nonce}`); lastBal = bal.balance; }
  } catch (e) { console.log(`[${ts()}] rpc hiccup: ${String(e.message).slice(0, 80)}`); }
  await sleep(4000);
}
