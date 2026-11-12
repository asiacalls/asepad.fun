// Build-time pool reads for the [[...slug]] layout metadata. Raw RPC view
// calls, no client lib. Covers both venues the terminal lists: AseDex pools
// and legacy AuraDex pairs.

const RPC = process.env.NEXT_PUBLIC_ASENTUM_RPC_HTTP || "https://explorer.asentum.com/rpc";
const DEX = process.env.NEXT_PUBLIC_CONTRACT_ASEDEX || "";
const PAD = process.env.NEXT_PUBLIC_CONTRACT_ASEPAD || "";
const LEGACY = "0x63f640a9b98b6f28e06cb5cc0fce5d72b6c0eabd";
const AURAS = process.env.NEXT_PUBLIC_AURAS_API || "https://auras.asentum.com";
const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

async function view(contract: string, method: string, args: unknown[] = []): Promise<string> {
  const res = await fetch(`${RPC.replace(/\/$/, "")}/view`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contract, method, args })
  });
  if (!res.ok) throw new Error(`view ${method} -> HTTP ${res.status}`);
  const body = (await res.json()) as { ok?: boolean; returnValue?: string };
  if (!body.ok) throw new Error(`view ${method} failed`);
  return String(body.returnValue ?? "");
}

const metaStr = (v: unknown) => (typeof v === "string" ? v.replace(/^"|"$/g, "") : "");
const isNative = (a: string) => a.toLowerCase() === NATIVE;

type RawPool = { id?: string; token0?: string; token1?: string };

const slugDex = (s?: string) => (s === "asedex" ? DEX : s === "auras" || s === "aura" || s === "auradex" ? LEGACY : null);

async function poolRecord(dex: string, id: string): Promise<RawPool | null> {
  try {
    const pool = JSON.parse(await view(dex, "getPool", [String(id)])) as RawPool | null;
    return pool?.token0 && pool.token1 ? pool : null;
  } catch { return null; }
}

/** ["terminal",<venue>,<poolId>] for every pool the terminal lists —
 *  same shape the app writes into the address bar for pair links. */
export async function dexPoolSlugs(): Promise<string[][]> {
  const slugs: string[][] = [];
  // AseDex: ids are contiguous 1..poolCount.
  const count = Math.min(Number(await view(DEX, "poolCount").catch(() => "0")) || 0, 300);
  for (let id = 1; id <= count; id++) {
    const pool = await poolRecord(DEX, String(id));
    if (pool) slugs.push(["terminal", "asedex", String(id)]);
  }
  // AURAS: the old contract has no poolCount — pool ids come from the
  // Auras indexer, same as the app.
  try {
    const res = await fetch(`${AURAS}/api/pairs`, { signal: AbortSignal.timeout(8000) });
    const data = res.ok ? (await res.json()) as { pairs?: { amm?: string; poolId?: string | number }[] } : null;
    for (const p of data?.pairs ?? []) {
      if (String(p.amm || "").toLowerCase() !== LEGACY) continue;
      const pool = await poolRecord(LEGACY, String(p.poolId));
      if (pool) slugs.push(["terminal", "auras", String(p.poolId)]);
    }
  } catch { /* indexer down: asedex slugs only */ }
  return slugs;
}

export type PoolMeta = {
  poolId: string;
  symbol: string;
  name: string;
  quote: string;
  logoUrl?: string;
};

export const isTerminalPoolSlug = (slug?: string[]) =>
  !!slug && slug[0] === "terminal" && !!slugDex(slug[1]) && !!slug[2];

// Each generated page + og image asks for the same pool — fetch once per slug.
const poolMetaCache = new Map<string, Promise<PoolMeta | null>>();

/** Pool + token metadata for a terminal pair slug. Null when the pool id or
 *  venue isn't real (bad links get the generic card). */
export function fetchPoolMeta(slug?: string[]): Promise<PoolMeta | null> {
  return isTerminalPoolSlug(slug) ? fetchPoolMetaByRef(slug![1], String(slug![2])) : Promise.resolve(null);
}

/** Same lookup keyed by venue + pool id. */
export function fetchPoolMetaByRef(venue: string, poolId: string): Promise<PoolMeta | null> {
  const key = slugDex(venue) ? `${venue}/${poolId}` : "";
  if (!key) return Promise.resolve(null);
  let cached = poolMetaCache.get(key);
  if (!cached) {
    cached = loadPoolMeta(venue, poolId);
    poolMetaCache.set(key, cached);
  }
  return cached;
}

async function loadPoolMeta(venue: string, poolId: string): Promise<PoolMeta | null> {
  try {
    const dex = slugDex(venue);
    const pool = dex ? await poolRecord(dex, poolId) : null;
    if (!pool) return null;
    const native0 = isNative(pool.token0!);
    const token = native0 ? pool.token1! : pool.token0!;
    const quote = native0 || isNative(pool.token1!) ? "ASE" : null;
    const [symbolRaw, nameRaw, logoRaw, launchRaw, quoteSym] = await Promise.all([
      view(token, "symbol").catch(() => null),
      view(token, "name").catch(() => null),
      view(token, "logoUrl").catch(() => ""),
      PAD ? view(PAD, "getLaunch", [token]).catch(() => "null") : Promise.resolve("null"),
      quote ? Promise.resolve(null) : view(native0 ? pool.token0! : pool.token1!, "symbol").catch(() => null)
    ]);
    const symbol = metaStr(symbolRaw) || `TKN${token.slice(-4).toUpperCase()}`;
    const name = metaStr(nameRaw) || symbol;
    let logoUrl: string | undefined;
    try {
      const launch = JSON.parse(launchRaw) as { meta?: string } | null;
      const meta = JSON.parse(String(launch?.meta ?? "null")) as { logoUrl?: string } | null;
      const v = meta?.logoUrl?.trim();
      if (v) logoUrl = /^https?:\/\//i.test(v) ? v : `https://${v}`;
    } catch { /* no launch meta */ }
    // Token Studio tokens (standard, tax, pad) expose logoUrl on the contract
    // itself — this covers create-token coins on either venue. AuraDex-native
    // tokens lack the view and fall back to the letter coin.
    const tokenLogo = metaStr(logoRaw);
    if (!logoUrl && /^https?:\/\//i.test(tokenLogo)) logoUrl = tokenLogo;
    return {
      poolId: String(pool.id ?? poolId),
      symbol, name,
      quote: quote ?? (metaStr(quoteSym) || "TOKEN"),
      logoUrl
    };
  } catch {
    return null;
  }
}
