import type { AsentumClient } from "@asentum/connect";
import { aseToWei } from "@asentrise/blockchain";
import { toHexAddress } from "@asentrise/utils";
import { useWalletStore } from "@/stores/wallet";
import { isLivePaused } from "@/lib/live-session";

/** Storage key @asentum/connect uses to persist `{ address, method, sessionId }`. */
const CONNECT_STORAGE_KEY = "asentum:connect:address";

// Kept on globalThis so a dev hot-reload of this module doesn't drop the
// connected client (the provider only sets it when the client changes).
const G = globalThis as unknown as { __asentumActiveClient?: AsentumClient | null };
let activeClient: AsentumClient | null = G.__asentumActiveClient ?? null;
// The wallet's own RPC — a custom user RPC joins the read pool first.
let activeReadRpc: string | null = null;

export function setActiveAsentumClient(client: AsentumClient | null) {
  activeClient = client;
  G.__asentumActiveClient = client;
  activeReadRpc = client?.readRpc?.replace(/\/$/, "") || null;
  readRpcs = null; // rebuild the read pool so the wallet's RPC joins it
}

// ── RPC gate ────────────────────────────────────────────────────────────────
// The node rate-limits per IP, and the wallet extension shares the browser's
// IP — so our background reads can starve the wallet's own calls ("RPC GET
// /balance … 429"). Every read this app makes goes through one queue:
//   • at most MAX_INFLIGHT requests at a time, paced so queued reads drip in
//   • a 429 pauses ALL reads (streak-scaled backoff) and the read retries
//   • two lanes: interactive reads always beat bulk enumeration
//   • while the wallet is signing, background reads wait so it gets the node
//
// Web wrinkle the vault app never hits: the node's 429 responses carry no CORS
// headers, so a rate-limited fetch rejects as TypeError "Failed to fetch" and
// the status never reaches JS. Those masked 429s must cool the queue exactly
// like a visible one, or the app keeps bursting and the limiter never lifts.
// The node is slow per-call but handles concurrent batches well (measured:
// 3×75-call POSTs complete in ~2s). 8 slots lets sweep chunks overlap while
// the lane order still guarantees interactive reads win.
const MAX_INFLIGHT = 8;
const SIGNING_HOLD_MAX_MS = 45_000;
// Three lanes: interactive reads always win; "wallet" covers wallet-visible
// sweeps (balance probes, share probes) that must beat the giant background
// enumerations (pool sweep, holders) but still yield to what the user is
// actively clicking; "bulk" is everything else.
type GateLane = "ui" | "wallet" | "bulk";
type GateJob = { run: () => Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void; tries: number; urgent?: boolean };
const uiQueue: GateJob[] = [];
const walletQueue: GateJob[] = [];
const bulkQueue: GateJob[] = [];
let gateInflight = 0;
let cooldownUntil = 0;
let backoffMs = 0;
let limitStreak = 0;
let lastAcquireAt = 0;
let signingCount = 0;
let signingSince = 0;
let gateTimer: ReturnType<typeof setTimeout> | null = null;
export const isRateLimitError = (e: unknown) =>
  /\b429\b|too many requests|rate.?limit/i.test(e instanceof Error ? e.message : String(e));
// CORS-masked 429 or a dead socket — indistinguishable from a genuinely dead
// endpoint, but retrying with cooldown is correct for both (a dead endpoint's
// lanes fail fast and the gate deadline still caps the wait).
const isNetworkError = (e: unknown) => {
  if (e instanceof TypeError) return true;
  const m = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return m.includes("failed to fetch") || m.includes("networkerror") || m.includes("load failed") ||
    m.includes("all read rpcs failed") || m.includes("view read timed out");
};
export const isTransientReadError = (e: unknown) => isRateLimitError(e) || isNetworkError(e);
const signingHold = () => signingCount > 0 && Date.now() - signingSince < SIGNING_HOLD_MAX_MS;
/** True while reads are paused (rate-limit cooldown or a wallet signature in progress). */
export const rpcPaused = () => isLivePaused() || Date.now() < cooldownUntil || signingHold();
/** Debug snapshot for the Playwright probes — queue depths, inflight, cooldown. */
export const gateDebug = () => ({ ui: uiQueue.length, wallet: walletQueue.length, bulk: bulkQueue.length, inflight: gateInflight, cooldownMs: Math.max(0, cooldownUntil - Date.now()) });
if (typeof window !== "undefined") (window as unknown as { __gateDebug?: typeof gateDebug }).__gateDebug = gateDebug;
function gateSchedule(ms: number) {
  if (gateTimer) return;
  gateTimer = setTimeout(() => { gateTimer = null; gatePump(); }, Math.max(50, ms));
}
// Lane tracking: job objects carry their lane so a put-back or retry lands
// back in the same queue instead of jumping the interactive line.
const jobLane = new WeakMap<GateJob, GateLane>();
function requeue(job: GateJob) { ((jobLane.get(job) ?? "ui") === "bulk" ? bulkQueue : (jobLane.get(job) ?? "ui") === "wallet" ? walletQueue : uiQueue).unshift(job); }
// Interactive reads still win, but a continuously-refilling ui queue must not
// starve the wallet lane forever — every third acquired slot goes to a queued
// wallet job (wallet sweeps carry ~150 calls each, so a couple of slots
// finishes a whole balance scan; without this they could wait for minutes).
let uiStreak = 0;
function nextJob(): GateJob | undefined {
  if (walletQueue.length && (uiStreak >= 2 || !uiQueue.length)) { uiStreak = 0; return walletQueue.shift(); }
  if (uiQueue.length) { uiStreak += 1; return uiQueue.shift(); }
  return bulkQueue.shift();
}
function gatePump() {
  for (;;) {
    const job = nextJob();
    if (!job) return;
    if (isLivePaused()) { job.reject(new DOMException("Live market updates paused", "AbortError")); continue; }
    if (gateInflight >= MAX_INFLIGHT) { requeue(job); return; }
    const now = Date.now();
    // A user's own click (pre-sign quote/allowance reads) jumps a cooldown on
    // its FIRST attempt — the wallet prompt must not wait out a background
    // limiter pause. If it still 429s it joins normal backoff on the retry.
    if (now < cooldownUntil && !(job.urgent && job.tries === 0)) { requeue(job); return gateSchedule(cooldownUntil - now); }
    if (signingHold()) { requeue(job); return gateSchedule(400); }
    // Pace slot acquisition: when a limit window opens, every parked read
    // would fire at once and re-trip the 429. A small gap drips them back in —
    // and while the node is actively limiting, the drip stretches so the
    // burst volume can't keep the limiter tripped.
    const gap = (100 + limitStreak * 150) - (now - lastAcquireAt);
    if (gap > 0) { requeue(job); return gateSchedule(gap); }
    lastAcquireAt = now;
    gateInflight += 1;
    // Hard deadline: a hung HTTP read must reject rather than wedge this gate
    // lane forever — four stalled reads would otherwise deadlock every query.
    Promise.race([
      job.run(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("RPC call timed out")), 45_000))
    ]).then(
      (v) => { backoffMs = 0; limitStreak = 0; job.resolve(v); },
      (e) => {
        if (isTransientReadError(e) && job.tries < 5) {
          // Adaptive shared backoff — consecutive failures stretch the pause
          // (a hard-limiting node re-trips on every fixed window otherwise).
          limitStreak = Math.min(limitStreak + 1, 5);
          backoffMs = Math.min(Math.max(backoffMs * 2, 1200 * limitStreak), 15_000);
          cooldownUntil = Date.now() + backoffMs + Math.random() * 1500;
          job.tries += 1;
          requeue(job);
        } else job.reject(e);
      }
    ).finally(() => { gateInflight -= 1; gatePump(); });
  }
}
/** Run an RPC request through the shared rate-aware queue. `opts.bulk` marks
 *  background enumeration (sweeps, holder counts) — it yields to interactive
 *  reads so a page sweep can never starve what the user is looking at.
 *  `opts.wallet` marks wallet-visible sweeps: ahead of bulk, behind ui.
 *  `opts.urgent` marks a user's own click — its first attempt ignores the
 *  rate-limit cooldown so the wallet prompt fires instantly. */
export function gated<T>(run: () => Promise<T>, opts?: { bulk?: boolean; wallet?: boolean; urgent?: boolean }): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const job: GateJob = { run, resolve: resolve as (v: unknown) => void, reject, tries: 0, urgent: opts?.urgent };
    const lane: GateLane = opts?.bulk ? "bulk" : opts?.wallet ? "wallet" : "ui";
    jobLane.set(job, lane);
    (lane === "bulk" ? bulkQueue : lane === "wallet" ? walletQueue : uiQueue).push(job);
    gatePump();
  });
}
/** fetch() through the gate — a 429 response is retried after the cooldown. */
export function gatedFetch(url: string, init?: RequestInit, opts?: { bulk?: boolean; wallet?: boolean; urgent?: boolean }): Promise<Response> {
  return gated(async () => {
    const res = await fetch(url, init);
    // Same-origin function paths ("/rpc/...") get the dead-function cooldown
    // too — REST helpers like tx-resolve would otherwise pay a 405 round-trip
    // per call while Pages fails open to statics.
    noteEndpointStatus(endpointKey(url), res);
    // A same-origin 429 means the Workers quota just died mid-session —
    // endpoint-cool it like a 404/405 rather than throwing, or every poll
    // tick that rotates through it re-trips the shared gate cooldown and the
    // whole app freezes on a dead endpoint. Remote 429s still gate-cool.
    if (res.status === 429 && url.startsWith("/")) { coolEndpoint(endpointKey(url), 60 * 60_000); return res; }
    if (res.status === 429) throw new Error(`${url} -> HTTP 429`);
    if (res.status >= 500) throw new TypeError(`${url} -> HTTP ${res.status}`);
    return res;
  }, opts);
}
/** "/rpc/block/5" → "/rpc", "https://x/rpc/chain" → "https://x/rpc" — cooldown
 *  bookkeeping keys an endpoint's base, not the full REST path. */
const endpointKey = (url: string) => {
  if (url.startsWith("/")) return `/${url.slice(1).split("/")[0]}`;
  try { const u = new URL(url); return `${u.origin}/${u.pathname.split("/")[1] ?? ""}`.replace(/\/$/, "") || u.origin; }
  catch { return url; }
};
/** Read-path cooldown check for helpers that pick their own base list. */
export const readEndpointCooled = (base: string) => endpointCooled(endpointKey(base)) || endpointCooled(base);
async function withSigningHold<T>(fn: () => Promise<T>): Promise<T> {
  if (signingCount === 0) signingSince = Date.now();
  signingCount += 1;
  try { return await fn(); }
  finally { signingCount = Math.max(0, signingCount - 1); gatePump(); }
}

const pendingGasEstimates = new Map<string, { key: string; floor: bigint; limit: bigint }>();
const GAS_LIMIT_FLOORS: Record<string, bigint> = {
  // The first approve on a standard token also runs its lazy genesis init
  // (~10 storage writes + emits) — 150k is not enough for that first call.
  approve: 700_000n,
  // A bonding buy runs the whole migration inline (pool create, seed, LP
  // burn, creator reward) — the floor must cover that worst case.
  buy: 4_000_000n,
  sell: 900_000n,
  createLaunch: 4_000_000n,
  migrate: 4_000_000n,
  advanceMigration: 4_000_000n,
  retryMigration: 4_000_000n,
  // AseDex price-moving methods each run _sweepOrders afterwards — up to 16
  // scanned entries and 20 fills, every fill a full swap + payout + emits —
  // on top of _assertDexOpen's external pad status calls and token pulls
  // whose first transfer lazy-inits (~10 writes). 500k OOG-reverts on any
  // pool with a live book; the observed-gas buffer only helps after a first
  // success, which fresh wallets never reach at the floor.
  addLiquidity: 6_000_000n,
  removeLiquidity: 6_000_000n,
  swapExactIn: 6_000_000n,
  seedLiquidity: 2_000_000n,
  sweepOrders: 8_000_000n,
  createPool: 1_000_000n,
  createLimitOrder: 1_000_000n,
  createDcaOrder: 1_000_000n,
  cancelOrder: 1_000_000n,
  claimLpRewards: 1_000_000n
};
const DEFAULT_GAS_FLOOR = 500_000n;
const MAX_GAS_LIMIT = 30_000_000n;

function gasEstimateKey(to: string, method: string) {
  return `asepad:gas-estimate:${to.toLowerCase()}:${method}`;
}

function dynamicGasLimit(to: string, method: string, explicit?: bigint): { limit: bigint; key: string; floor: bigint } {
  const key = gasEstimateKey(to, method);
  const floor = GAS_LIMIT_FLOORS[method] ?? DEFAULT_GAS_FLOOR;
  let estimate = explicit ?? floor;
  if (!explicit && typeof window !== "undefined") {
    try {
      const observed = BigInt(window.localStorage.getItem(key) || "0");
      if (observed > 0n) {
        const buffered = (observed * 135n) / 100n + 25_000n;
        estimate = buffered > floor ? buffered : floor;
      }
    } catch {
      estimate = floor;
    }
  }
  return { limit: estimate > MAX_GAS_LIMIT ? MAX_GAS_LIMIT : estimate, key, floor };
}

// In-flight dedupe — pages fire many identical views at once (pool lists,
// token meta, holders), so concurrent identical calls share one request.
const readInflight = new Map<string, Promise<unknown>>();
// Reads go straight to the stock nodes — they send CORS headers, and the
// same-origin /asentum-rpc edge proxy is gone (every proxied call burned a
// Workers invocation, which exhausted the free-plan quota). In-flight dedupe
// above plus the read pool's hedging keep browsers off the upstream rate
// limit. Env vars can still point anywhere.
const proxiedRpc = (u: string) => u.replace(/\/$/, "");
const RPC_HTTP = proxiedRpc(process.env.NEXT_PUBLIC_ASENTUM_RPC_HTTP || "https://explorer.asentum.com/rpc");
// Public reads round-robin across the public HTTPS nodes — browsers cap
// connections per origin, so pooling origins is real parallelism for
// view-heavy pages. No validator-IP relays and no same-origin /rpc worker:
// CORS-open public endpoints only; wallets bring their own RPC if they want.
const READ_RPCS = [...new Set([
  proxiedRpc(process.env.NEXT_PUBLIC_ASENTUM_RPC_HTTP || "https://explorer.asentum.com/rpc"),
  "https://testnet.asentum.com",
  ...(process.env.NEXT_PUBLIC_ASENTUM_RPC_READS || `https://testnet.asentum.com`)
    .split(",").map((s) => proxiedRpc(s.trim().replace(/\/$/, ""))).filter(Boolean),
  // Worker proxy lanes are opt-in only (NEXT_PUBLIC_ASENTUM_RPC_PROXIES).
  // As defaults they absorbed every public-node 429 failover from every
  // browser and exhausted all four accounts' 100k/day Workers quota (1027) —
  // and they forward to the same public nodes anyway.
  ...(process.env.NEXT_PUBLIC_ASENTUM_RPC_PROXIES || "")
    .split(",").map((s) => proxiedRpc(s.trim())).filter(Boolean)
])];
// Deduped read pool — plain RPC URLs; reads go straight over JSON-RPC.
let readRpcs: string[] | null = null;
function readRpcPool(): string[] {
  if (!readRpcs) {
    const seen = new Set<string>();
    const list = (activeReadRpc ? [activeReadRpc, ...READ_RPCS] : READ_RPCS).filter((u) => {
      const k = u.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    readRpcs = list.length ? list : [RPC_HTTP];
  }
  return readRpcs;
}
// Index of the read client that answered last — the fast node stays primary so
// each view call is one request; the others are only hedged when it stalls.
let fastIdx = 0;
// Same-origin paths (if ever reintroduced) stay primary whenever healthy —
// otherwise the last hedge winner becomes sticky and a remote endpoint that
// won one race absorbs every subsequent read (the old explorer 429 storm).
function primaryIndex(list: string[]): number {
  for (let i = 0; i < list.length; i++) {
    if (list[i]!.startsWith("/") && !endpointCooled(list[i]!)) return i;
  }
  return fastIdx % list.length;
}
// Per-endpoint health: after repeated consecutive failures (dead endpoint,
// broken socket) cool it so reads stop feeding it. Success clears it.
// Cooldowns escalate per trip (30s → 1m → 2m … 15m cap) — a permanently dead
// validator endpoint ends up probed once per quarter-hour instead of every
// half-minute, which is what kept the console error drip alive.
const endpointFails = new Map<string, number>();
const endpointCoolUntil = new Map<string, number>();
const endpointCoolTrips = new Map<string, number>();
// Cooldowns persist across reloads — a lane throttled at the edge (CF 1027
// pages carry no CORS, so it fails every probe) shouldn't get re-probed on
// every page load. Entries are timestamps; stale ones drop on hydrate.
const COOL_STORE_KEY = "asepad:endpoint-cool";
const coolPersist = () => {
  try {
    const now = Date.now();
    localStorage.setItem(COOL_STORE_KEY, JSON.stringify(
      [...endpointCoolUntil].filter(([, t]) => t > now)
    ));
  } catch { }
};
const coolEndpoint = (rpc: string, ms: number) => {
  endpointCoolUntil.set(rpc, Date.now() + ms);
  coolPersist();
};
try {
  const saved = JSON.parse(localStorage.getItem(COOL_STORE_KEY) || "[]") as [string, number][];
  const now = Date.now();
  for (const [k, t] of saved) if (t > now) endpointCoolUntil.set(k, t);
} catch { }
const ENDPOINT_FAIL_TRIP = 3;
const ENDPOINT_COOL_MS = 30_000;
const ENDPOINT_COOL_MAX_MS = 15 * 60_000;
const endpointCooled = (rpc: string) => (endpointCoolUntil.get(rpc) ?? 0) > Date.now();
const noteEndpointOk = (rpc: string) => {
  endpointFails.delete(rpc);
  // A recovered endpoint restarts at the short cool — only consecutive trips
  // escalate.
  if ((endpointCoolUntil.get(rpc) ?? 0) <= Date.now()) endpointCoolTrips.delete(rpc);
};
const noteEndpointFail = (rpc: string) => {
  const n = (endpointFails.get(rpc) ?? 0) + 1;
  endpointFails.set(rpc, n);
  if (n >= ENDPOINT_FAIL_TRIP) {
    endpointFails.delete(rpc);
    const trips = (endpointCoolTrips.get(rpc) ?? 0) + 1;
    endpointCoolTrips.set(rpc, trips);
    coolEndpoint(rpc, Math.min(ENDPOINT_COOL_MS * 2 ** (trips - 1), ENDPOINT_COOL_MAX_MS));
  }
};
// A same-origin function path answering 404/405 is Pages failing open to
// statics while the free Workers quota is exhausted — a stable state, not a
// transient blip. Cool it for an hour so reads don't each pay a dead
// round-trip before the HTTPS pool takes over.
const noteEndpointStatus = (rpc: string, res: Response) => {
  if (!res.ok && rpc.startsWith("/") && (res.status === 404 || res.status === 405)) {
    coolEndpoint(rpc, 60 * 60_000);
  }
};
/** Current best read-RPC base — live-chain pollers re-evaluate it per tick so
 *  they ride the pool's health/cooldown rotation instead of a fixed URL. */
export function primaryReadRpc(): string {
  const list = readRpcPool();
  return list[primaryIndex(list)]!;
}
/** Healthy read-RPC bases ordered primary-first — for standalone pollers that
 *  walk endpoints until one answers within a single tick (the head poll), so a
 *  dead lane can't wedge the whole indicator on a retry timer. */
export function readRpcCandidates(): string[] {
  const list = readRpcPool();
  const pi = primaryIndex(list);
  const ordered = [...list.slice(pi), ...list.slice(0, pi)];
  const healthy = ordered.filter((u) => !endpointCooled(u));
  // Everything cooled — still try in order; a cooled endpoint may have
  // recovered and only a fresh attempt can clear its cooldown.
  return healthy.length ? healthy : ordered;
}
/** Feed a standalone poller's outcome back into the shared health map — without
 *  it a permanently dead endpoint ("/rpc" on Pages, where Functions never run)
 *  stayed primary forever and every tick failed. 404/405 on a same-origin path
 *  earns the hour-long dead-function cool like the view path gives it. */
export function noteReadPoll(rpc: string, ok: boolean, status?: number) {
  if (ok) { noteEndpointOk(rpc); return; }
  noteEndpointFail(rpc);
  if (rpc.startsWith("/") && (status === 404 || status === 405)) {
    coolEndpoint(rpc, 60 * 60_000);
  }
}
// Hedge only on a genuinely stalled lane — a short hedge doubles traffic
// whenever the lane is merely busy (burst congestion used to fan bursts into
// the backup endpoint's own rate limiter).
const HEDGE_MS = 2500;
// A view read must never hang forever: a dead lane stalls streaming loaders
// mid-list and keeps fetchStatus 'fetching', so the persister never writes.
const VIEW_DEADLINE_MS = 25_000;
/** One contract view over plain JSON-RPC — same eth_call wire encoding the
 *  batch path uses ({method,args} JSON → hex → call → hex JSON result). */
async function viewViaRpc<T>(rpc: string, hex: string, method: string, args: unknown[]): Promise<T> {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "eth_call",
      params: [{ to: hex, data: jsonToHex(JSON.stringify({ method, args })) }, "latest"]
    })
  });
  if (res.status === 429) throw new Error(`${rpc} -> HTTP 429`);
  noteEndpointStatus(rpc, res);
  if (!res.ok) throw new TypeError(`${rpc} -> HTTP ${res.status}`);
  const r = (await res.json()) as { result?: string; error?: { message?: string } };
  if (r.error || typeof r.result !== "string" || !r.result.startsWith("0x")) {
    throw new Error(r.error?.message || `${rpc} -> empty view result`);
  }
  return JSON.parse(hexToUtf8(r.result)) as T;
}
async function hedgedView<T>(list: string[], hex: string, method: string, args: unknown[]): Promise<T> {
  const allCooled = list.every((c) => endpointCooled(c));
  let primaryIdx = primaryIndex(list);
  // Prefer a non-cooled primary so a tripped node stops getting every read.
  if (!allCooled && endpointCooled(list[primaryIdx]!)) {
    for (let k = 0; k < list.length; k++) {
      const i = (fastIdx + k) % list.length;
      if (!endpointCooled(list[i]!)) { primaryIdx = i; break; }
    }
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false, pending = 0, rateLimited = false;
    const deadline = Date.now() + VIEW_DEADLINE_MS;
    const launched = new Set<number>([primaryIdx]);
    const tryHedge = () => {
      // Walk lanes ONE at a time — fanning out to the whole pool on a 429
      // turned a single upstream rate-limit into a 7x request burst (every
      // lane ultimately hits the same node). A stalled primary still gets
      // incremental coverage, one extra lane per HEDGE_MS tick.
      if (settled || rpcPaused()) return;
      for (let k = 1; k < list.length; k++) {
        const i = (primaryIdx + k) % list.length;
        if (launched.has(i)) continue;
        if (!allCooled && endpointCooled(list[i]!)) continue;
        launched.add(i);
        launch(i);
        return;
      }
    };
    const launch = (i: number) => {
      pending += 1;
      viewViaRpc<T>(list[i]!, hex, method, args).then(
        (v) => { noteEndpointOk(list[i]!); if (!settled) { settled = true; fastIdx = i; resolve(v); } },
        (e) => {
          pending -= 1;
          if (settled) return;
          const limited = isRateLimitError(e);
          const firstLimit = limited && !rateLimited;
          if (limited) rateLimited = true;
          else noteEndpointFail(list[i]!); // a 429 is upstream health, not lane health
          // Dead lanes hedge freely (a lane can be dead while others live).
          // A 429 hedges ONCE — that covers a per-source-IP limiter, but a
          // second 429 means the shared upstream is saturated and every extra
          // lane just adds pressure inside the limit window.
          if (!limited || firstLimit) tryHedge();
          if (pending === 0) {
            settled = true;
            fastIdx = (primaryIdx + 1) % list.length; // next call tries a different node first
            reject(rateLimited ? new Error("RPC rate limited (HTTP 429)") : new Error("all read RPCs failed"));
          }
        });
    };
    // The old one-shot setTimeout(hedge) skipped hedging entirely when it fired
    // during a rate-limit pause — a hung primary then stalled the call forever.
    // The tick keeps retrying the hedge once unpaused and enforces the deadline.
    const tick = () => {
      if (settled) return;
      if (Date.now() >= deadline) { settled = true; reject(new Error("view read timed out")); return; }
      tryHedge();
      setTimeout(tick, HEDGE_MS);
    };
    setTimeout(tick, HEDGE_MS);
    launch(primaryIdx);
  });
}
/** POST a JSON-RPC body across the read pool with failover — a lane that
 *  errors, times out, or 429s just marks itself sick and the next lane takes
 *  over; the rate-limit error only propagates when EVERY lane failed (which
 *  is when the gate should actually pause). */
export async function rpcBatchPost(list: string[], body: string): Promise<Response> {
  let res: Response | null = null;
  let lastErr: Error | null = null;
  const allCooled = list.every((c) => endpointCooled(c));
  // Cap the walk — during an upstream rate-limit burst, trying all ~7 lanes
  // fires that many upstream hits per chunk and the retries self-DDoS the
  // node. Four attempts cover both direct nodes + the freshest proxies;
  // past that the caller's gate backoff is the smarter retry anyway.
  const walk = Math.min(list.length, 4);
  let saw429 = false;
  for (let attempt = 0; attempt < walk && !res; attempt++) {
    const idx = (primaryIndex(list) + attempt) % list.length;
    const rpc = list[idx]!;
    if (!allCooled && endpointCooled(rpc)) continue;
    try {
      res = await Promise.race([
        fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new TypeError(`${rpc} -> batch timed out`)), 8_000))
      ]);
    } catch (e) {
      noteEndpointFail(rpc);
      lastErr = e instanceof Error ? e : new TypeError(`${rpc} -> batch fetch failed`);
      continue;
    }
    if (res.status === 429) {
      // 429 is the shared upstream limiter — every lane (proxies included)
      // forwards to the same node, so walking more lanes just multiplies
      // pressure while the node is limiting. One failover covers a
      // per-source-IP limiter; a second 429 means the whole upstream is
      // saturated and the gate's adaptive backoff is the right retry. The
      // lane itself stays healthy — a 429 says nothing about lane health.
      lastErr = new Error(`${rpc} -> HTTP 429`);
      res = null;
      if (saw429) break;
      saw429 = true;
      continue;
    }
    noteEndpointStatus(rpc, res);
    if (!res.ok) {
      noteEndpointFail(rpc);
      lastErr = new TypeError(`${rpc} -> HTTP ${res.status}`);
      res = null;
      continue;
    }
    noteEndpointOk(rpc);
    fastIdx = idx;
  }
  if (!res) throw lastErr ?? new TypeError("batch: all read RPCs failed");
  return res;
}
/** Native ASE balance (wei string) through the gated read pool. */
export async function readNativeBalance(address: string): Promise<string> {
  const list = readRpcPool();
  return gated(async () => {
    const res = await rpcBatchPost(list, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [toHexAddress(address), "latest"] }));
    const r = (await res.json()) as { result?: string };
    if (typeof r.result !== "string") throw new Error(`bad balance response`);
    return BigInt(r.result).toString();
  });
}
/** Read-only contract view over the public RPC pool — never requires a connected wallet.
 *  `opts.bulk` marks background enumeration — it queues behind interactive reads.
 *  `opts.wallet` marks wallet-visible probes — ahead of bulk, behind ui. */
export async function viewContract<T = unknown>(to: string, method: string, args: unknown[] = [], opts?: { bulk?: boolean; wallet?: boolean; urgent?: boolean }): Promise<T> {
  const list = readRpcPool();
  const hex = toHexAddress(to);
  const key = `${hex.toLowerCase()}|${method}|${JSON.stringify(args)}`;
  let p = readInflight.get(key) as Promise<T> | undefined;
  if (!p) {
    // Hedged read: hit the last-fastest node first; the rest only fire if it
    // stalls — keeps ~1 request/view while a dead node still can't stall a call.
    p = gated(() => hedgedView<T>(list, hex, method, args), opts);
    readInflight.set(key, p);
    // .finally() would spawn an unhandled rejection on failure — detach via then.
    p.then(() => readInflight.delete(key), () => readInflight.delete(key));
  }
  return p;
}
// ── JSON-RPC batching ────────────────────────────────────────────────────────
// The node's /rpc endpoint speaks standard JSON-RPC and accepts ARRAY bodies —
// one POST carries ~150 view calls. Contract views ride eth_call with the
// payload hex-encoded JSON {method, args}; the result is hex-encoded JSON of
// the return value. Per-call errors isolate cleanly (a dead token address
// errors only its own entry — no contract-helper bisection needed).
export type ViewBatchCall = { to: string; method: string; args?: unknown[] };
// 75/POST: the gateway in front of the node times fat batches out (a 504
// fails all 150 calls and re-runs them through the cooldown). Smaller chunks
// finish inside the timeout — slightly more POSTs, far fewer dead batches.
// Node accepts ~300-400 eth_call entries per POST (verified live: 300 → 200 in
// 1.8s, 400 → 200 in 3.3s). 256 keeps a safety margin while cutting ~3.4× the
// POSTs a 75-chunk sweep needed — every POST saved is rate-window headroom.
// Back to 75 (the backup's value): A/B on the live node showed 256 turned the
// launch sweep's first 150 heavy getLaunchById records into one ~640KB POST
// (8-17s) — two parallel 75-call POSTs painted the board in half the time.
const VIEW_BATCH_CHUNK = 75;
const jsonToHex = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let out = "0x";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
};
const hexToUtf8 = (hex: string) => {
  const raw = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(raw.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(raw.substr(i * 2, 2), 16);
  return new TextDecoder().decode(bytes);
};
/** Batch view calls over JSON-RPC — one POST per ~150 calls. Results align
 *  positionally with `calls`; a failed call yields `undefined` at its index
 *  (the rest still resolve). Chunks round-robin the read pool and each chunk
 *  is one gate job, so a 600-call sweep costs ~4 queue slots, not 600. */
export async function viewContractBatch<T = unknown>(calls: ViewBatchCall[], opts?: { bulk?: boolean; wallet?: boolean; urgent?: boolean }): Promise<(T | undefined)[]> {
  const list = readRpcPool();
  const out: (T | undefined)[] = new Array(calls.length);
  const chunks: { start: number; calls: ViewBatchCall[] }[] = [];
  for (let i = 0; i < calls.length; i += VIEW_BATCH_CHUNK) chunks.push({ start: i, calls: calls.slice(i, i + VIEW_BATCH_CHUNK) });
  await Promise.all(chunks.map((chunk) => gated(async () => {
    const body = JSON.stringify(chunk.calls.map((c, j) => ({
      jsonrpc: "2.0", id: j, method: "eth_call",
      params: [{ to: toHexAddress(c.to), data: jsonToHex(JSON.stringify({ method: c.method, args: c.args ?? [] })) }, "latest"]
    })));
    // Fail over across the read pool — a bare fetch to a stalling node used to
    // hang the whole call (incl. the pre-sign LP/swap batch) until the 45s
    // gate deadline. Each attempt gets a short timeout; a dead endpoint just
    // costs one beat before the next node answers. A quota-dead proxy lane
    // returning 429 previously threw here and killed the whole batch even
    // with healthy direct nodes in the pool — now it just walks on.
    const res = await rpcBatchPost(list, body);
    const arr = (await res.json()) as { id: number; result?: string; error?: { message?: string } }[];
    if (!Array.isArray(arr)) throw new TypeError("bad batch response");
    for (const r of arr) {
      if (r.error || typeof r.result !== "string" || !r.result.startsWith("0x")) { out[chunk.start + r.id] = undefined; continue; }
      try { out[chunk.start + r.id] = JSON.parse(hexToUtf8(r.result)) as T; } catch { out[chunk.start + r.id] = undefined; }
    }
  }, opts).catch(() => {
    // One dead chunk (node down, retries exhausted) yields undefined for its
    // range instead of rejecting every other chunk's results with it.
    for (let j = 0; j < chunk.calls.length; j++) out[chunk.start + j] = undefined;
  })));
  return out;
}
/** Native ASE balance via eth_getBalance — rides the same batch path. */
export async function nativeBalanceBatch(addresses: string[], opts?: { bulk?: boolean; wallet?: boolean; urgent?: boolean }): Promise<(string | undefined)[]> {
  const list = readRpcPool();
  const out: (string | undefined)[] = new Array(addresses.length);
  await gated(async () => {
    const body = JSON.stringify(addresses.map((a, i) => ({ jsonrpc: "2.0", id: i, method: "eth_getBalance", params: [toHexAddress(a), "latest"] })));
    const res = await rpcBatchPost(list, body);
    const arr = (await res.json()) as { id: number; result?: string; error?: unknown }[];
    for (const r of arr) out[r.id] = r.error || typeof r.result !== "string" ? undefined : BigInt(r.result).toString();
  }, opts);
  return out;
}

/** The deployed contract's source, straight from eth_getCode (hex → UTF-8). */
export async function getContractSource(to: string): Promise<string | null> {
  const srcList = readRpcPool();
  const res = await gatedFetch(srcList[primaryIndex(srcList)]!, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [toHexAddress(to), "latest"] })
  });
  if (!res.ok) throw new Error(`eth_getCode -> HTTP ${res.status}`);
  const hex = String((await res.json())?.result || "");
  if (!hex || hex === "0x" || hex.length <= 2) return null;
  const raw = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(raw.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(raw.substr(i * 2, 2), 16);
  return new TextDecoder().decode(bytes);
}

export type WalletMethod = "extension" | "telegram";

export function connectedWalletMethod(): WalletMethod | null {
  if (typeof window === "undefined") return null;
  return readAsentumMethod();
}
function readAsentumMethod(): "extension" | "telegram" | null {
  const raw = window.localStorage.getItem(CONNECT_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw)?.method === "bot" ? "telegram" : "extension";
  } catch {
    return "extension";
  }
}

export function walletProviderId(method: WalletMethod | null): string | null {
  if (!method) return null;
  return method === "telegram" ? "asentum-telegram" : "asentum-extension";
}

/**
 * The persisted session is gone but the UI still showed "connected" — the
 * classic stale-wallet trap users hit as a bare "connect wallet first" on
 * their next swap. Tell them what actually happened and tear the stale
 * state down so the chip flips back to Connect.
 */
function sessionExpiredError(): Error {
  useWalletStore.getState().disconnect().catch(() => {});
  return new Error("Your wallet session expired. Connect your wallet again, then retry.");
}

/** True when the app believes a wallet is connected but the SDK's persisted
 *  session/method is gone — i.e. expiry, not a never-connected user. */
function staleSessionLikely(): boolean {
  return useWalletStore.getState().status === "connected";
}

/** Map raw wallet/SDK failures to the message a human should read. Shared by
 *  the tx layer and the connect modal so wording stays consistent. */
export function humanizeWalletError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  const name = e instanceof Error ? e.name : "";
  if (name === "SessionExpiredError" || /session\s*has\s*expired|session\s*expired|expired.*session/i.test(msg)) {
    return "Your wallet session expired. Connect your wallet again, then retry.";
  }
  if (/locked|unlock/i.test(msg)) {
    return "Your wallet is locked. Unlock the Asentum extension, then retry.";
  }
  if (/reject|denied|declined|cancelled|canceled/i.test(msg)) {
    return "Request cancelled in the wallet.";
  }
  if (/no\s+wallet|not\s+installed|window\.asentum|extension not found/i.test(msg)) {
    return "Asentum wallet extension not found. Install or unlock it, then try again.";
  }
  return msg || "Something went wrong with the wallet. Try again.";
}

export type WalletCallOpts = {
  to: string;
  method: string;
  args?: unknown[];
  /** Human ASE attached as msg.value, e.g. "1" or "0.5". */
  valueAse?: string;
  /** Raw wei msg.value (takes precedence over valueAse). */
  valueWei?: string;
  gasLimit?: bigint;
};

function parseTxHash(res: unknown): string {
  if (typeof res === "string" && res.startsWith("0x")) return res;
  if (res && typeof res === "object") {
    const o = res as Record<string, unknown>;
    for (const h of [o.txHash, o.hash, o.transactionHash]) {
      if (typeof h === "string" && h.startsWith("0x")) return h;
    }
  }
  throw new Error(
    "Wallet approved the call but did not return a transaction hash. Check the wallet activity or block explorer, then refresh."
  );
}

/** Signed contract call through whichever wallet is connected (extension or paired Telegram session). */
export function sendWalletCall(opts: WalletCallOpts): Promise<string> {
  // Background reads wait while the wallet signs, so its own node calls
  // (balance, nonce, gas) aren't starved by our polling.
  return withSigningHold(() => sendWalletCallInner(opts));
}

/** Native ASE transfer through the active wallet. Amount is wei (string or bigint). */
export function sendNativeWithWallet(to: string, amountWei: string | bigint): Promise<string> {
  return withSigningHold(async () => {
    const method = connectedWalletMethod();
    if (!method) throw staleSessionLikely() ? sessionExpiredError() : new Error("Connect your wallet first");
    if (method === "telegram" && !activeClient) throw sessionExpiredError();
    const hexTo = toHexAddress(to);
    const amount = typeof amountWei === "bigint" ? amountWei.toString() : amountWei;
    if (method === "telegram" && activeClient) {
      await requireLiveSession();
      return activeClient.transfer(hexTo, amount).catch((e) => {
        throw walletStepError("telegram session transfer", e);
      });
    }
    const provider = typeof window !== "undefined" ? window.asentum : undefined;
    if (!provider) throw new Error("Asentum wallet extension not found. Install or unlock it, then try again.");
    try {
      await provider.connect();
      return parseTxHash(await provider.sendTransfer({ to: hexTo, amount }));
    } catch (e) {
      throw walletStepError("wallet transfer", e);
    }
  });
}
async function sendWalletCallInner(opts: WalletCallOpts): Promise<string> {
  const method = connectedWalletMethod();
  // The extension path signs through window.asentum — only the Telegram
  // session needs the connect client.
  if (!method) {
    throw staleSessionLikely() ? sessionExpiredError() : new Error("Connect your Asentum wallet first");
  }
  if (method === "telegram" && !activeClient) throw sessionExpiredError();
  const args = opts.args ?? [];
  const value = opts.valueWei ?? aseToWei(opts.valueAse);
  // The wallet/extension wire format takes the raw 20-byte hex form.
  const to = toHexAddress(opts.to);
  const gas = dynamicGasLimit(to, opts.method, opts.gasLimit);

  if (method === "telegram" && activeClient) {
    await requireLiveSession();
    const hash = await activeClient.call(to, opts.method, args, value).catch((e) => {
      throw walletStepError(`telegram session call (${opts.method})`, e);
    });
    pendingGasEstimates.set(hash, { key: gas.key, floor: gas.floor, limit: gas.limit });
    return hash;
  }

  const provider = typeof window !== "undefined" ? window.asentum : undefined;
  if (!provider) {
    throw new Error("Asentum wallet extension not found. Install or unlock it, then try again.");
  }
  try {
    await provider.connect();
    const params = { to, method: opts.method, args, value, gasLimit: String(gas.limit) };
    const hash = parseTxHash(await provider.callContract(params));
    pendingGasEstimates.set(hash, { key: gas.key, floor: gas.floor, limit: gas.limit });
    return hash;
  } catch (e) {
    throw walletStepError(`wallet call (${opts.method})`, e);
  }
}

/** Fail fast when a paired Telegram session is already dead (connect ≥0.1.9).
 *  A passed check stays fresh briefly — re-probing the relay ahead of every
 *  signature stacked a full round trip on top of each wallet prompt. */
let lastSessionCheckAt = 0;
async function requireLiveSession(): Promise<void> {
  const client = activeClient as unknown as { checkSession?: () => Promise<boolean> } | null;
  if (!client?.checkSession) return;
  if (Date.now() - lastSessionCheckAt < 20_000) return;
  const live = await client.checkSession().catch((e) => {
    if (/failed to fetch|networkerror|fetch failed/i.test(String(e?.message || ""))) {
      throw new Error(
        "Wallet signing relay (wallet.asentum.com) is unreachable from this browser. Check VPN/network/firewall and retry."
      );
    }
    return true;
  });
  if (!live) throw sessionExpiredError();
  lastSessionCheckAt = Date.now();
}

/** The extension's own pre-sign reads (e.g. GET /balance/<addr> on the
 *  explorer REST endpoint) throw raw gateway errors when the node flaps —
 *  no signature ever happened at that point, so the call is safe to redo. */
const TRANSIENT_WALLET_ERR = /bad gateway|50[234]|gateway timeout|failed to fetch|networkerror|fetch failed|rate.?limit|429/i;
function isTransientWalletError(e: unknown): boolean {
  return TRANSIENT_WALLET_ERR.test(e instanceof Error ? e.message : String(e));
}
/** Retry a wallet/provider call when it died on a transient node error before
 *  prompting. Only errors matching isTransientWalletError retry — a real user
 *  rejection or an on-chain failure passes straight through. */
async function retryOnTransient<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      if (!isTransientWalletError(e) || i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 900 + i * 600));
    }
  }
  throw last;
}

/** Tag provider/RPC failures with the exact step so "Failed to fetch" is diagnosable. */
function walletStepError(step: string, e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  // The node/gateway answered with an HTML error page (rate limit or 502) and
  // the wallet tried to parse it as JSON — surface that, not the parser noise.
  // Raw gateway statuses from the extension's own reads ("GET /balance/…
  // failed: 502 Bad Gateway") get the same treatment — nothing was signed.
  if (/unexpected token '?<|is not valid json|<html/i.test(msg) || isRateLimitError(msg)) {
    // Back our own reads off too so the retry has the node to itself.
    backoffMs = Math.max(backoffMs, 3000);
    cooldownUntil = Math.max(cooldownUntil, Date.now() + backoffMs);
    return new Error(`The Asentum node is busy (rate-limited) during ${step}. Background loading is paused for a few seconds, so try again shortly. If the wallet showed a confirmation, check the explorer first so you don't send it twice.`);
  }
  if (/failed to fetch|networkerror|fetch failed/i.test(msg)) {
    return new Error(`Failed to fetch during ${step}: the wallet couldn't reach its signing relay or the node. Reconnect the wallet and retry.`);
  }
  // Locked extension, dead session, user rejection — real wallet states that
  // deserve a readable message, not the raw provider error.
  const humanized = humanizeWalletError(e);
  if (humanized !== msg) {
    if (/session expired/i.test(humanized)) return sessionExpiredError();
    return new Error(humanized);
  }
  return e instanceof Error ? e : new Error(msg);
}

/**
 * Deploy a contract signed by the connected wallet (extension or Telegram session).
 * Returns the tx hash and the real on-chain contract address — preferring the
 * mined receipt's recipient over wallet-reported addresses.
 */
export async function deployContractWithWallet(
  source: string,
  opts?: { waitMs?: number }
): Promise<{ txHash: string; contractAddress: string }> {
  const method = connectedWalletMethod();
  if (!method) {
    throw staleSessionLikely() ? sessionExpiredError() : new Error("Connect your Asentum wallet first");
  }
  if (method === "telegram" && !activeClient) throw sessionExpiredError();

  const { txHash, reported } = await withSigningHold(() => signDeploy(source, method!));
  return finishDeploy(txHash, reported, opts?.waitMs);
}
async function signDeploy(source: string, method: WalletMethod): Promise<{ txHash: string; reported?: string }> {
  let txHash: string;
  let reported: string | undefined;
  if (method === "telegram" && activeClient) {
    await requireLiveSession();
    const r = await activeClient.deploy(source).catch((e) => {
      // wallet.asentum.com rejects sign-request bodies over ~4KB with a bare
      // 502 (no CORS headers) — contract sources are 11KB+, so Telegram
      // deploys die at the relay, not the node. Surface the real cause.
      if (/failed to fetch|networkerror|fetch failed/i.test(String(e?.message || ""))) {
        throw new Error(
          "Telegram wallet relay rejected the deploy. Its request-size limit (~4KB) is smaller than the contract source. Deploy with the Asentum browser extension instead, or retry after the wallet relay is fixed."
        );
      }
      throw walletStepError("telegram session deploy", e);
    });
    txHash = r.txHash;
    reported = r.contractAddress;
  } else {
    const provider = typeof window !== "undefined" ? window.asentum : undefined;
    if (!provider) {
      throw new Error("Asentum wallet extension not found. Install or unlock it, then try again.");
    }
    try {
      await provider.connect();
      const r = await provider.deployContract({ source });
      txHash = r.txHash;
      reported = r.contractAddress;
    } catch (e) {
      throw walletStepError("wallet contract deploy", e);
    }
  }
  return { txHash, reported };
}
async function finishDeploy(txHash: string, reported: string | undefined, waitMs?: number): Promise<{ txHash: string; contractAddress: string }> {
  const receipt = await waitWalletTx(txHash, waitMs ?? 120_000);
  const real = typeof receipt?.recipient === "string" ? receipt.recipient : reported;
  if (!receipt?.success && !real) {
    throw new Error("Deploy transaction is still pending or failed, check the explorer");
  }
  if (receipt && receipt.success === false) {
    throw new Error(`Deploy reverted in block ${receipt.blockNumber}`);
  }
  if (!real) {
    throw new Error("Deploy mined but no contract address was returned");
  }
  return { txHash, contractAddress: real };
}

/** Poll until mined; throws when the receipt reports a revert. */
export async function requireWalletTxMined(txHash: string, label: string, timeoutMs = 120_000) {
  const receipt = await waitWalletTx(txHash, timeoutMs);
  if (!receipt) throw new Error(`${label}: no receipt yet, tx may still be confirming. Check the explorer.`);
  const gasMeta = pendingGasEstimates.get(txHash);
  if (gasMeta && receipt.gasUsed) {
    const used = BigInt(receipt.gasUsed);
    if (receipt.success !== false) {
      const next = used > gasMeta.floor ? used : gasMeta.floor;
      if (typeof window !== "undefined") window.localStorage.setItem(gasMeta.key, next.toString());
    } else if (used >= (gasMeta.limit * 9n) / 10n) {
      // Reverted having burned ~the whole limit — that was out-of-gas, not a
      // contract assert. Ratchet the stored estimate up so the retry sends
      // real headroom instead of reverting at the same cap forever.
      if (typeof window !== "undefined") window.localStorage.setItem(gasMeta.key, (used * 3n).toString());
      pendingGasEstimates.delete(txHash);
      throw new Error(`${label} ran out of gas in block ${receipt.blockNumber} — retry, a higher limit will be sent automatically.`);
    }
  }
  pendingGasEstimates.delete(txHash);
  if (receipt.success === false) {
    // The receipt carries the terminal reason
    // ("contract call failed: contract method 'x' failed: <reason>") — unwrap
    // the call-chain boilerplate so the note shows the actual assert message.
    let reason = (receipt.error || "").trim();
    while (true) {
      const next = reason.replace(/^contract call failed:\s*/i, "").replace(/^contract method '[^']+' failed:\s*/i, "");
      if (next === reason) break;
      reason = next;
    }
    throw new Error(reason ? `${label} reverted in block ${receipt.blockNumber}: ${reason}` : `${label} reverted in block ${receipt.blockNumber}`);
  }
  return receipt;
}

type TxReceipt = { blockNumber?: number | string; success?: boolean; gasUsed?: string; recipient?: string; error?: string; returnValue?: string; events?: { name?: string; data?: Record<string, unknown> }[] };

const AWS_TX_API = (process.env.NEXT_PUBLIC_ASE_API_URL || "").replace(/\/$/, "");
/** Poll the public RPC until a wallet-signed tx is mined. Races the chain
 *  receipts endpoint against our AWS event index — the indexer sees the tx's
 *  events ~as fast as the block lands, and an existing event means the call
 *  executed. Reverts leave no events, so the receipts probe remains the
 *  authority for failures. */
export async function waitWalletTx(txHash: string, timeoutMs = 120_000) {
  // One gated receipt probe per tick, ROTATING across the read pool — a node
  // that lags indexing receipts (or keeps 502ing mid-poll) used to hide a
  // mined tx for the whole timeout. Rotating means the slowest endpoint can
  // only delay one tick, not the full wait.
  const start = Date.now();
  let tick = 0;
  while (Date.now() - start < timeoutMs) {
    const list = readRpcPool();
    const base = (list[(primaryIndex(list) + tick) % list.length] || activeClient?.readRpc || RPC_HTTP).replace(/\/$/, "");
    tick += 1;
    // Skip endpoints already cooled (dead /rpc worker, 429ing relay) — paying
    // a dead round-trip per tick starves the live endpoints' share of polls.
    if (!readEndpointCooled(base)) {
      try {
        // Direct fetch, NOT gatedFetch — this is the critical path between a
        // signed tx and the next user step. Through the gate it fought bulk
        // sweeps for 8 slots, got paused by signingHold, and paid shared
        // 502-backoff: the tx was mined on-chain while the UI kept waiting.
        // One ungated request per 600ms is trivial load.
        const res = await fetch(`${base}/receipts/${txHash}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          const r = await res.json().catch(() => null) as TxReceipt | null;
          if (r && r.blockNumber) return r;
        }
      } catch {
        /* not mined yet — next tick tries the next endpoint */
      }
    }
    // AWS event index probe — every other tick, INDEPENDENT of endpoint
    // cooldown state (this is the fallback when every read endpoint is dark).
    // An indexed event means mined + executed; synthesize a receipt so
    // callers get their result (pool ids, etc.) without waiting on a laggy
    // receipts endpoint. Reverts emit no events — receipts stay the failure
    // authority.
    if (tick % 2 === 0) {
      try {
        const tr = await fetch(`${AWS_TX_API}/api/tx/${txHash}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(6000) });
        if (tr.ok) {
          const d = await tr.json().catch(() => null) as { mined?: boolean; block?: number | null; events?: { name?: string; data?: string }[] } | null;
          if (d?.mined) {
            return {
              txHash, blockNumber: d.block ?? 1, success: true,
              events: (d.events ?? []).map((e) => {
                let data: unknown = e?.data;
                try { data = JSON.parse(String(e?.data ?? "null")); } catch { }
                return { name: e?.name, data: (data && typeof data === "object" ? data : {}) as Record<string, unknown> };
              })
            } as TxReceipt;
          }
        }
      } catch { /* probe miss — receipts still polling */ }
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  return null;
}
