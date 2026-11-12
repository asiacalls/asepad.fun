import { network } from "@/lib/network";
import { gated, gatedFetch, readEndpointCooled, readRpcCandidates, rpcBatchPost } from "@/lib/asentum-wallet";

// Asentum contract records carry `createdTs` = the block's timestamp (ms), and
// /block/<n> returns receipts with emitted events — so a trade/launch can be
// matched to its exact tx hash by locating the block at that timestamp and
// scanning the pad contract's receipts for the matching event.

export type RpcEvent = { name?: string; data?: Record<string, unknown> };
export type RpcReceipt = { txHash?: string; recipient?: string; success?: boolean; events?: RpcEvent[] };
type RpcBlock = { number: number; timestampMs: number; receipts: RpcReceipt[] };

/** Block receipts (events included) for the live watcher — cached + deduped
 *  by blockCache so concurrent callers share one fetch. */
export async function blockReceipts(n: number): Promise<RpcReceipt[] | null> {
  const b = await fetchBlock(n).catch(() => null);
  return b ? b.receipts : null;
}

const hexN = (n: number) => "0x" + n.toString(16);

/** Which blocks in [from,to] produced logs on ANY watched contract — one
 *  batched eth_getLogs POST for the whole range (the same lane the indexer
 *  uses) instead of a REST /block fetch per block. Quiet ranges cost a
 *  single request; callers then receipt-fetch only the busy blocks.
 *  Returns null when no endpoint gave a complete answer. */
export async function platformEventBlocks(from: number, to: number, addrs: string[]): Promise<Set<number> | null> {
  const targets = [...new Set(addrs.map((a) => norm(a)).filter((a) => /^0x[0-9a-f]{40}$/.test(a)))];
  if (!targets.length || to < from) return new Set();
  const body = JSON.stringify(targets.map((a, i) => ({
    jsonrpc: "2.0", id: i, method: "eth_getLogs",
    params: [{ address: a, fromBlock: hexN(from), toBlock: hexN(to) }]
  })));
  try {
    const res = await gated(() => rpcBatchPost(readRpcCandidates(), body));
    const rows = (await res.json()) as ({ id: number; result?: { blockNumber?: string }[] } | null)[];
    const list = Array.isArray(rows) ? rows : [rows];
    const out = new Set<number>();
    for (const r of list) {
      if (!r || !Array.isArray(r.result)) return null;
      for (const l of r.result) {
        const n = Number(l?.blockNumber);
        if (Number.isSafeInteger(n)) out.add(n);
      }
    }
    return out;
  } catch {
    return null;
  }
}

const blockCache = new Map<number, Promise<RpcBlock | null>>();
let heightCache: { v: number; at: number } | null = null;

// Recent-block reads go to the public RPC base (explorer) — CORS-open, no
// relay worker in the middle. Extra bases can be re-added here if a second
// history-capable public node ever lands.
const rpcBase = () => network.rpcHttp.replace(/\/$/, "");
const bases = () => [rpcBase()].filter((b) => !readEndpointCooled(b));
const norm = (v: unknown) => String(v ?? "").toLowerCase();

async function fetchBlock(n: number): Promise<RpcBlock | null> {
  let p = blockCache.get(n);
  if (!p) {
    p = (async () => {
      for (const base of bases()) {
        try {
          const res = await gatedFetch(`${base}/block/${n}`);
          if (!res.ok) continue;
          const j = await res.json();
          const timestampMs = Number(j?.header?.timestamp ?? 0);
          if (!Number.isFinite(timestampMs) || timestampMs <= 0) continue;
          return {
            number: Number(j?.header?.number ?? n),
            timestampMs,
            receipts: Array.isArray(j?.receipts) ? (j.receipts as RpcReceipt[]) : []
          };
        } catch { /* next base */ }
      }
      return null;
    })();
    blockCache.set(n, p);
  }
  return p;
}

async function chainHeight(): Promise<number> {
  if (heightCache && Date.now() - heightCache.at < 15000) return heightCache.v;
  for (const base of bases()) {
    try {
      const res = await gatedFetch(`${base}/chain`);
      if (!res.ok) continue;
      const j = await res.json();
      const v = Number(j?.height ?? j?.latestHeader?.number ?? 0);
      if (v > 0) { heightCache = { v, at: Date.now() }; return v; }
    } catch { /* next base */ }
  }
  throw new Error("chain height unavailable");
}

/** Locate the tx that emitted a contract event at a known block timestamp. */
export async function findTxByEvent(opts: {
  contract: string;
  tsMs: number;
  match: (e: RpcEvent) => boolean;
}): Promise<string> {
  const contract = norm(opts.contract);
  const tip = await chainHeight().catch(() => 0);
  if (!tip || !opts.tsMs) return "";
  let lo = 1, hi = tip;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const b = await fetchBlock(mid);
    if (!b || b.timestampMs < opts.tsMs) lo = mid + 1; else hi = mid;
  }
  for (let n = lo; n <= tip && n < lo + 8; n++) {
    const b = await fetchBlock(n);
    if (!b || b.timestampMs > opts.tsMs) break;
    if (b.timestampMs !== opts.tsMs) continue;
    for (const rc of b.receipts) {
      if (norm(rc.recipient) !== contract || rc.success === false || !rc.txHash) continue;
      for (const e of rc.events ?? []) if (opts.match(e)) return rc.txHash;
    }
  }
  return "";
}

export type TradeTxRef = {
  id: string; kind: string; traderAddress: string;
  aseWei: string; tokenAmount: string; tsMs: number;
};

function tradeMatches(e: RpcEvent, token: string, t: TradeTxRef) {
  const d = e?.data ?? {};
  return e?.name === "Trade"
    && norm(d.token) === token
    && norm(d.trader) === norm(t.traderAddress)
    && String(d.kind ?? "") === t.kind
    && String(d.tokenAmount ?? "") === t.tokenAmount
    && String(d.grossAseAmount ?? "") === t.aseWei;
}

// Binary-search blocks by timestamp; block numbers are non-decreasing in ts,
// so each processed timestamp narrows the lower bound for the next.
export async function resolvePadTxs(opts: {
  pad: string;
  token: string;
  launchTsMs?: number;
  trades: TradeTxRef[];
}): Promise<{ launchTx: string; tradeTxs: Map<string, string> }> {
  const pad = norm(opts.pad);
  const token = norm(opts.token);
  const out = { launchTx: "", tradeTxs: new Map<string, string>() };
  const hi = await chainHeight().catch(() => 0);
  if (!hi) return out;

  const groups = new Map<number, TradeTxRef[]>();
  for (const t of opts.trades) {
    if (!t.tsMs) continue;
    const g = groups.get(t.tsMs) ?? [];
    g.push(t);
    groups.set(t.tsMs, g);
  }
  const stamps = [...new Set([...groups.keys(), ...(opts.launchTsMs ? [opts.launchTsMs] : [])])].sort((a, b) => a - b);

  // Parallel stamp scans — each unique block-ts needs its own binary search,
  // and 256 trades span ~64+ stamps; serial scans stalled tx links for a
  // minute+. blockCache still dedupes the actual fetches.
  const scan = async (ts: number, loStart: number) => {
    let l = loStart;
    let r = hi;
    while (l < r) {
      const mid = (l + r) >> 1;
      const b = await fetchBlock(mid);
      if (!b || b.timestampMs < ts) l = mid + 1; else r = mid;
    }
    // blocks can share a timestamp — scan forward while ts matches
    for (let n = l; n <= hi && n < l + 8; n++) {
      const b = await fetchBlock(n);
      if (!b || b.timestampMs > ts) break;
      if (b.timestampMs !== ts) continue;
      for (const rc of b.receipts) {
        if (norm(rc.recipient) !== pad || rc.success === false || !rc.txHash) continue;
        for (const e of rc.events ?? []) {
          if (e?.name === "LaunchCreated" && norm(e.data?.token) === token) out.launchTx = rc.txHash;
          if (e?.name !== "Trade") continue;
          for (const t of groups.get(ts) ?? []) {
            if (!out.tradeTxs.has(t.id) && tradeMatches(e, token, t)) out.tradeTxs.set(t.id, rc.txHash);
          }
        }
      }
    }
    return l;
  };
  // Cover every visible stamp (newest-first) — the old 64-cap left older
  // trades permanently unresolved. Six workers drain the shared queue.
  const queue = stamps.slice(-160);
  const drain = async () => { let ts: number | undefined; while ((ts = queue.shift()) !== undefined) await scan(ts, 1); };
  await Promise.all(Array.from({ length: Math.min(6, queue.length) }, drain));
  return out;
}
