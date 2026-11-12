// Build-time launch reads for the token layout. Raw RPC view calls —
// keeps the client lib out of the server bundle.
import { toHexAddress } from "@asentrise/utils";

const RPC = process.env.NEXT_PUBLIC_ASENTUM_RPC_HTTP || "https://explorer.asentum.com/rpc";
const PAD = process.env.NEXT_PUBLIC_CONTRACT_ASEPAD || "";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Build-time reads run under heavy RPC pressure — retry 429/5xx/network
// failures with backoff instead of letting one blip fail the whole sweep.
export async function padView(method: string, args: unknown[] = []): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    let body: { ok?: boolean; returnValue?: string };
    try {
      const res = await fetch(`${RPC.replace(/\/$/, "")}/view`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contract: PAD, method, args }),
        signal: AbortSignal.timeout(15_000)
      });
      if (!res.ok) throw new Error(`view ${method} -> HTTP ${res.status}`);
      body = (await res.json()) as { ok?: boolean; returnValue?: string };
    } catch (e) {
      lastErr = e;
      await sleep(600 * 2 ** attempt + Math.random() * 400);
      continue;
    }
    // A contract revert is a real answer — retrying won't change it.
    if (!body.ok) throw new Error(`view ${method} failed`);
    return String(body.returnValue ?? "");
  }
  throw lastErr;
}


export type LaunchMeta = {
  symbol: string;
  name: string;
  status: string;
  logoUrl?: string;
};

// Both param encodings generate static pages (hex for old shared links, ase1
// canonical) — memoize the contract read so dual params cost one RPC.
const metaCache = new Map<string, Promise<LaunchMeta | null>>();

export async function fetchLaunchMeta(address: string): Promise<LaunchMeta | null> {
  const hex = toHexAddress(address);
  let p = metaCache.get(hex);
  if (!p) { p = fetchLaunchMetaInner(hex); metaCache.set(hex, p); }
  return p;
}

async function fetchLaunchMetaInner(address: string): Promise<LaunchMeta | null> {
  try {
    const raw = await padView("getLaunch", [address]);
    const launch = JSON.parse(raw) as { symbol?: string; name?: string; status?: string; meta?: string } | null;
    if (!launch?.symbol) return null;
    let logoUrl: string | undefined;
    try {
      const meta = JSON.parse(String(launch.meta ?? "null")) as { logoUrl?: string } | null;
      const v = meta?.logoUrl?.trim();
      logoUrl = v ? (/^https?:\/\//i.test(v) ? v : `https://${v}`) : undefined;
    } catch { /* no meta */ }
    return {
      symbol: String(launch.symbol),
      name: String(launch.name || launch.symbol),
      status: String(launch.status || "BONDING"),
      logoUrl
    };
  } catch {
    return null;
  }
}
