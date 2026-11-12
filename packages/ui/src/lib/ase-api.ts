// DB API client — /api/* backed by sharded Cloudflare D1 indexers. Each
// account owns one contract domain (see apps/indexer/wrangler.toml):
//   peradox = pad (launches/gate/pad vol)
//   api2    = factory (token registry/meta/search)
//   api     = dex (pools/dex vol/positions)
//   api4    = ops (orders/locks/wallet)
// Requests route to the owning shard first, then fall back across lanes;
// every consumer still keeps its chain-read path for when APIs are dark.
import { isLivePaused } from "./live-session";
export const UNIFIED_API = (process.env.NEXT_PUBLIC_ASE_API_URL || "").replace(/\/$/, "");
const TIMEOUT_MS = 6_000;
// AWS unified API serves every domain — the old per-domain Cloudflare worker
// shards are retired; "" keeps same-origin /api/* Pages functions as a lane.
const AWS_API = UNIFIED_API;
const BASES = { pad: AWS_API, factory: AWS_API, dex: AWS_API, ops: AWS_API };
// "" = same-origin /api/* Pages functions — real only in production deploys;
// on a dev origin it just spams Next 404s, so the lane is skipped there.
const SAME_ORIGIN = typeof location === "undefined" || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) ? null : "";
const ALL_BASES = [AWS_API, ...(SAME_ORIGIN === null ? [] : [SAME_ORIGIN])];
/** Path prefix → owning shard. First match wins; default tries all lanes. */
const ROUTES: [RegExp, keyof typeof BASES][] = [
  [/^\/(launches|gate)/, "pad"],
  [/^\/(tokens|token|search|resolve)/, "factory"],
  [/^\/(pools|pool|trending)/, "dex"],
  [/^\/(orders|locks|wallet|trades)/, "ops"],
];
const COOL_MS = 30_000;
const COOL_KEY = "asepad:api-cool";
const failAt = (() => {
  const m = new Map<string, number>();
  try {
    if (typeof localStorage !== "undefined") {
      const raw = JSON.parse(localStorage.getItem(COOL_KEY) ?? "{}") as Record<string, number>;
      const now = Date.now();
      for (const [b, t] of Object.entries(raw)) if (t > now) m.set(b, t);
    }
  } catch {}
  return m;
})();
const persist = () => {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(COOL_KEY, JSON.stringify(Object.fromEntries(failAt)));
  } catch {}
};
const cooled = (b: string) => (failAt.get(b) ?? 0) > Date.now();
const cool = (b: string) => { failAt.set(b, Date.now() + COOL_MS); persist(); };
const ok = (b: string) => { if (failAt.delete(b)) persist(); };
let cursor = 0;

const orderedBases = (path: string) => {
  const owner = ROUTES.find(([re]) => re.test(path))?.[1];
  const list = ALL_BASES.filter((b) => !cooled(b));
  const pool = list.length ? list : ALL_BASES;
  // Owning shard first (it has the data), then round-robin the rest —
  // a shard 404s domains it doesn't own, so failover order matters.
  const ordered = owner ? [BASES[owner], ...pool.filter((b) => b !== BASES[owner])] : pool;
  if (UNIFIED_API && !cooled(UNIFIED_API)) return [UNIFIED_API, ...ordered];
  if (!owner) { cursor = (cursor + 1) % ordered.length; return [...ordered.slice(cursor), ...ordered.slice(0, cursor)]; }
  return ordered;
};

async function apiJsonOn<T>(base: string, path: string): Promise<T | null> {
  if (typeof window === "undefined" || isLivePaused()) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${base}/api${path}`, { signal: ctrl.signal, headers: { accept: "application/json" } });
    const type = r.headers.get("content-type") ?? "";
    // A 404 is a healthy "not my domain" answer (the shard is alive), not a
    // lane failure — don't cool it, or every wrong-domain probe poisons lanes.
    if (!r.ok) { if (r.status !== 404) cool(base); return null; }
    if (!type.includes("json")) { cool(base); return null; }
    ok(base);
    return (await r.json()) as T;
  } catch {
    if (!isLivePaused()) cool(base);
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function apiJson<T>(path: string): Promise<T | null> {
  for (const base of orderedBases(path)) {
    const r = await apiJsonOn<T>(base, path);
    if (r !== null) return r;
  }
  return null;
}

export type ApiLock = { lock_id: string; kind: string | null; token: string | null; pool_dex: string | null; pool_id: string | null; amount: string | null; owner: string | null; unlock_ts: number | null; raw_json: string | null };
export type ApiPool = { dex: string; pool_id: string; token0: string; token1: string; reserve0: string | null; reserve1: string | null; fee_bps: number | null; lp_supply: string | null; tvl_usd?: number | null; volume_24h?: number | null; state: string | null; updated_at: number | null;
  t0_name?: string | null; t0_symbol?: string | null; t0_decimals?: number | null; t0_logo?: string | null; t0_supply?: string | null; t0_card?: string | null; t0_pad?: number | null;
  t1_name?: string | null; t1_symbol?: string | null; t1_decimals?: number | null; t1_logo?: string | null; t1_supply?: string | null; t1_card?: string | null; t1_pad?: number | null;
  vol24_ase?: number | null };
export type ApiGate = { pad: boolean; locked: boolean; migrating: boolean; migrated: boolean; unknown?: boolean };
export type ApiWalletToken = { token: string; balance: string; symbol: string | null; name: string | null; decimals: number | null; logo_url: string | null; total_supply?: string | null; card_json?: string | null; pad?: number | null };
export type ApiLaunch = { token: string; creator: string; meta_json: string | null; curve_json: string | null; raised_wei: string | null; sold_supply: string | null; price_native: number | null; graduated: number; migrated: number; migration_pool: string | null; status: string; created_ts: number; name: string | null; symbol: string | null; decimals: number | null; logo_url: string | null; official: number | null; vol_ase?: number | null; idx?: number | null };
export type ApiResolve = { found: boolean; type?: string; token?: Record<string, unknown> | null; launch?: Record<string, unknown> | null; pools?: ApiPool[]; gate?: { locked: boolean; migrating: boolean; migrated: boolean } | null };
export type ApiTrade = { trader?: string; dex: string; pool_id: string; token?: string; side: string; amount_in: string; amount_out: string; price: string | null; ase_wei: string | null; tx: string; block: number; ts: number };
export type ApiTrendRow = { token?: string; dex?: string; pool_id?: string; v: number; n: number };

export const apiLocks = (token?: string, wallet?: string) =>
  apiJson<{ locks: ApiLock[] }>(`/locks${token ? `?token=${token}` : wallet ? `?wallet=${wallet}` : ""}`);
export const apiPools = (params = "") => apiJson<{ pools: ApiPool[]; total?: number }>(`/pools${params}`);
export const apiPool = (dex: string, id: string) =>
  apiJson<{ pool: ApiPool; trades: ApiTrade[] }>(`/pool/${dex}/${id}`);
export const apiGate = (token: string) => apiJson<ApiGate>(`/gate/${token}`);
export const apiWallet = (addr: string) => apiJson<{ wallet: string; native?: string; tokens: ApiWalletToken[] }>(`/wallet/${addr}`);
// Ops shard's event-maintained positions table — the instant paint while the
// wallet's live sharesOf probes verify. Held pools only; zero-share rows
// are filtered server-side.
export const apiWalletPositions = (addr: string) =>
  apiJson<{ positions: { dex: string; pool_id: string; shares: string | null; updated_at?: number | null }[] }>(`/wallet/${addr}/positions`);
export type ApiToken = { address: string; kind: string | null; name: string | null; symbol: string | null; decimals: number | null; total_supply: string | null; logo_url: string | null; creator: string | null; official: number | null; card_json: string | null; meta_at: number | null; deploy_tx: string | null; deploy_block: number | null };
export const apiTokens = (params: { creator?: string; kind?: string; q?: string; limit?: number; official?: boolean } = {}) => {
  const p = new URLSearchParams();
  if (params.creator) p.set("creator", params.creator);
  if (params.kind) p.set("kind", params.kind);
  if (params.q) p.set("q", params.q);
  if (params.official) p.set("official", "1");
  p.set("limit", String(params.limit ?? 200));
  return apiJson<{ tokens: ApiToken[] }>(`/tokens?${p}`);
};
export const apiLaunches = (state: string, limit = 60, slim = false) =>
  apiJson<{ launches: ApiLaunch[] }>(`/launches?state=${state}&limit=${limit}${slim ? "&slim=1" : ""}`);
// Server-paged board fetch — the caller assembles state/minp/sort/q/offset so
// the home grid only ever holds one page of launches in memory.
export const apiLaunchPage = (query: string) =>
  apiJson<{ launches: ApiLaunch[]; total: number }>(`/launches?${query}`);
export const apiResolve = (input: string) => apiJson<ApiResolve>(`/resolve/${encodeURIComponent(input)}`);
// Batch token+launch resolve — one call for a whole surface's asset list,
// replacing N per-token /resolve hits (Markets, wallet sweeps).
export const apiResolveBatch = (addrs: string[]) =>
  apiJson<{ resolves: Record<string, { found: boolean; type: string; token: Record<string, unknown> | null; launch: Record<string, unknown> | null }> }>(
    `/tokens?addrs=${addrs.map((a) => encodeURIComponent(a)).join(",")}`);
export const apiTrades = (params: { pool?: string; wallet?: string; limit?: number; before?: number }) =>
  apiJson<{ trades: ApiTrade[] }>(`/trades?${params.pool ? `pool=${params.pool}` : `wallet=${params.wallet}`}${params.limit ? `&limit=${params.limit}` : ""}${params.before ? `&before=${params.before}` : ""}`);
export const apiOrders = (params: { pool?: string; wallet?: string; status?: string }) =>
  apiJson<{ orders: Record<string, unknown>[] }>(`/orders?${params.pool ? `pool=${params.pool}` : `wallet=${params.wallet}`}${params.status ? `&status=${params.status}` : ""}`);
// Cross-domain endpoints: trending's pad rows live on the pad shard and pool
// rows on the dex shard — fetch both and merge. Same for stats counters,
// which are per-domain (each shard counts its own tables).
export const apiStats = () => apiJson<Record<string, number>>("/stats");

// ── Blue badges (verified tokens) — DB-backed, managed from /admin ────────
export type ApiVerifiedToken = { address: string; note: string | null; added_at: number; name?: string | null; symbol?: string | null; logo_url?: string | null };
export const apiVerified = () => apiJson<{ tokens: ApiVerifiedToken[] }>("/verified");
/** Mirror one token's on-chain official flag into the API DB — POST is keyless
 *  by design (the server re-reads the flag; it can only write chain truth). */
export async function apiVerifiedWrite(token: string, wallet?: string, note?: string): Promise<boolean> {
  const r = await fetch(`${AWS_API}/api/verified`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(wallet ? { "x-admin-wallet": wallet } : {}) },
    body: JSON.stringify({ token, note })
  }).catch(() => null);
  return Boolean(r?.ok);
}
export const apiTrending = () =>
  apiJson<{ window_ms: number; complete: boolean; pad: ApiTrendRow[]; pools: ApiTrendRow[]; pad_day?: ApiTrendRow[]; pools_day?: ApiTrendRow[] }>("/trending");
