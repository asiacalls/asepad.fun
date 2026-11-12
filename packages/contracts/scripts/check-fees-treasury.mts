/** Read-only live check: treasury + fee wiring on AsePad, AseDex, Factory. */
import { config } from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AsentumClient } from "@asentum/sdk";
import { getAsentumNetworkFromEnv } from "@asentrise/config";
import { toHexAddress, toAseAddress } from "@asentrise/utils";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", "..", "..", ".env") });

const DEX = process.env.CONTRACT_ASEDEX!;
const PAD = process.env.CONTRACT_ASEPAD!;
const FACTORY = process.env.CONTRACT_FACTORY_ARC20 || process.env.CONTRACT_FACTORY || "0x5fb43f354ce937c42171a64f2ea0e00edbe0c706";
const TREASURY_HEX = toHexAddress(process.env.PLATFORM_TREASURY_ADDRESS!).toLowerCase();

const view = async (c: AsentumClient, to: string, m: string, a: unknown[] = []) =>
  (await c.viewCall(to, m, a)).returnValue;

async function main() {
  const client = new AsentumClient(getAsentumNetworkFromEnv(process.env).rpcHttp);
  const ASE = 10n ** 18n;
  const ase = (w: string | bigint) => `${Number(BigInt(w)) / 1e18} ASE`;
  let pass = 0;
  const check = (ok: boolean, l: string, got: string, want: string) => {
    console.log(`  ${ok ? "✓" : "✗ FAIL"} ${l}: ${got}${ok ? "" : `  (want ${want})`}`);
    if (ok) pass++;
  };
  const eq = (a: unknown, b: string) => String(a).toLowerCase() === b.toLowerCase();

  console.log(`expected treasury: ${TREASURY_HEX} (${toAseAddress(TREASURY_HEX)})`);

  console.log("\n== AsePad ==");
  const cfg = JSON.parse(await view(client, PAD, "config"));
  check(eq(cfg.treasury, TREASURY_HEX), "treasury", cfg.treasury, TREASURY_HEX);
  check(eq(cfg.aseDex, DEX), "aseDex binding", cfg.aseDex, DEX);
  console.log(`  · creationFee=${ase(cfg.creationFeeWei)} feeBps=${cfg.feeBps} creatorBps=${cfg.creatorBps} target=${ase(cfg.targetWei)} testnet=${cfg.testnet}`);
  check(String(cfg.creationFeeWei) === String(ASE), "creationFee = 1 ASE", ase(cfg.creationFeeWei), "1");
  check(String(cfg.feeBps) === "30", "trade feeBps = 30", cfg.feeBps, "30");
  check(String(cfg.creatorBps) === "100", "creatorBps = 100", cfg.creatorBps, "100");
  const stats = JSON.parse(await view(client, PAD, "platformStats"));
  console.log(`  · launches=${stats.launchCount} bonded=${stats.bondedCount} migrated=${stats.migratedCount} curveVol=${ase(stats.curveVolumeWei)}`);
  const acct = JSON.parse(await view(client, PAD, "accounting"));
  check(String(acct.heldWei) === String(acct.reserveTotalWei), "heldWei == reserveTotalWei", acct.heldWei, acct.reserveTotalWei);
  console.log(`  · surplusWei=${ase(acct.surplusWei)} (fees/creator rewards retained in pad)`);

  console.log("\n== AseDex ==");
  const dt = await view(client, DEX, "treasury");
  check(eq(dt, TREASURY_HEX), "treasury", dt, TREASURY_HEX);
  check(String(await view(client, DEX, "feeBps")) === "30", "feeBps = 30", await view(client, DEX, "feeBps"), "30");
  const share = await view(client, DEX, "treasuryShareBps");
  check(String(share) === "6667", "treasuryShareBps = 6667 (≈0.20% of 0.30% swap fee)", String(share), "6667");
  check(eq(await view(client, DEX, "asePad"), PAD), "asePad binding", await view(client, DEX, "asePad"), PAD);
  const dadmin = await view(client, DEX, "admin");
  console.log(`  · admin=${dadmin} pools=${await view(client, DEX, "poolCount").catch(() => "?")}`);

  console.log("\n== Factory ==");
  const ft = await view(client, FACTORY, "treasury");
  check(eq(ft, TREASURY_HEX), "treasury", ft, TREASURY_HEX);
  check(eq(await view(client, FACTORY, "asepad"), PAD), "asepad binding", await view(client, FACTORY, "asepad"), PAD);
  for (const arch of ["STANDARD", "ASEPAD"]) {
    const fee = await view(client, FACTORY, "getFeeWei", [`token_deploy:${arch}`]);
    console.log(`  · token_deploy:${arch} fee = ${ase(fee)}`);
  }
  console.log(`  · admin=${await view(client, FACTORY, "admin")}`);

  console.log(`\n${pass} checks passed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
