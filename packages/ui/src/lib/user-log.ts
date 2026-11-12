// Per-user journal — the serverless wallet's memory.
//
// No backend = the user's own localStorage is the source of truth for
// wallet-scoped data. Every event source writes hints here:
//   • live-chain watcher  → token contracts whose events touch the wallet
//   • indexer trades      → swap history + tokens traded
//   • create-token flows  → tokens this wallet deployed
//   • transfer/send flows → outbound transfers
//   • heldTokens sweep    → last known portfolio snapshot
//
// Discovery reads merge these hints into the candidate set so a wallet's
// tokens resolve even when they were never pooled, launched, or traded
// through an indexer-visible path. All keys are scoped per owner hex.
//
// Nothing here trusts a single sweep result — entries are append-only and
// merged, so a failed refresh can never erase what a previous pass learned.

export type UserTransfer = { token: string; dir: "in" | "out"; amount: string; counterparty?: string; txHash?: string; ts: number };
export type UserTrade = { poolId?: string; side?: string; tokenIn?: string; tokenOut?: string; amountIn?: string; amountOut?: string; txHash?: string; ts?: string | number };
export type UserLog = {
  tokens: string[];            // every token contract the wallet has touched
  created: string[];           // tokens deployed/registered by this wallet
  trades: UserTrade[];         // newest-first, capped
  transfers: UserTransfer[];   // newest-first, capped
  portfolio: string[];         // last heldTokens snapshot (addresses with balance)
  updatedAt: number;
};

const TRADES_CAP = 500;
const TRANSFERS_CAP = 300;

const logs = new Map<string, UserLog>();
const norm = (v: unknown) => String(v ?? "").toLowerCase();
const key = (owner: string) => `asedex:userlog:${owner.toLowerCase()}`;

export function userLogOf(owner: string): UserLog {
  const o = norm(owner);
  let log = logs.get(o);
  if (!log) {
    try { log = JSON.parse(localStorage.getItem(key(o)) || "null") ?? undefined; } catch { log = undefined; }
    if (!log) log = { tokens: [], created: [], trades: [], transfers: [], portfolio: [], updatedAt: 0 };
    logs.set(o, log);
  }
  return log;
}
function save(owner: string) {
  const log = userLogOf(owner);
  log.updatedAt = Date.now();
  try { localStorage.setItem(key(owner), JSON.stringify(log)); } catch { }
}

/** Token contracts this wallet has touched — heldTokens discovery hints. */
export function userLogTokens(owner: string): Set<string> {
  const log = userLogOf(owner);
  return new Set([...log.tokens, ...log.created, ...log.portfolio].map(norm));
}

/** Journal a token the wallet interacted with (live-event scan, swaps,
 *  receives, deploys). Idempotent. */
export function userLogNoteToken(owner: string, token: string) {
  const t = norm(token);
  if (!/^0x[0-9a-f]{40}$/.test(t)) return;
  const log = userLogOf(owner);
  if (!log.tokens.includes(t)) { log.tokens.push(t); save(owner); }
}

/** A token this wallet deployed/registered (Create Token flows). */
export function userLogNoteCreated(owner: string, token: string) {
  const t = norm(token);
  if (!/^0x[0-9a-f]{40}$/.test(t)) return;
  const log = userLogOf(owner);
  if (!log.created.includes(t)) { log.created.push(t); userLogNoteToken(owner, t); save(owner); }
}

/** An on-chain transfer involving the wallet (live events or app sends). */
export function userLogNoteTransfer(owner: string, tr: Omit<UserTransfer, "ts"> & { ts?: number }) {
  const t = norm(tr.token);
  if (!/^0x[0-9a-f]{40}$/.test(t)) return;
  const log = userLogOf(owner);
  // Dedupe on txHash+token+dir so live events + indexer merges don't double-log.
  const sig = `${tr.txHash || ""}|${t}|${tr.dir}`;
  if (!tr.txHash || !log.transfers.some((x) => `${x.txHash || ""}|${x.token}|${x.dir}` === sig)) {
    log.transfers.unshift({ ...tr, token: t, ts: tr.ts ?? Date.now() });
    if (log.transfers.length > TRANSFERS_CAP) log.transfers.length = TRANSFERS_CAP;
    userLogNoteToken(owner, t);
    save(owner);
  }
}

/** A trade the wallet made (indexer merge or app-side swap). */
export function userLogNoteTrade(owner: string, tr: UserTrade) {
  const log = userLogOf(owner);
  const sig = tr.txHash || `${tr.poolId}|${tr.ts}|${tr.amountIn}`;
  if (!log.trades.some((x) => (x.txHash || `${x.poolId}|${x.ts}|${x.amountIn}`) === sig)) {
    log.trades.unshift(tr);
    if (log.trades.length > TRADES_CAP) log.trades.length = TRADES_CAP;
    for (const t of [tr.tokenIn, tr.tokenOut]) if (t) userLogNoteToken(owner, t);
    save(owner);
  }
}

/** Snapshot of confirmed holdings — written at the end of each heldTokens
 *  sweep so the next session's discovery starts from a warm portfolio. */
export function userLogSetPortfolio(owner: string, addresses: string[]) {
  const log = userLogOf(owner);
  log.portfolio = [...new Set(addresses.map(norm))];
  for (const t of log.portfolio) if (!log.tokens.includes(t)) log.tokens.push(t);
  save(owner);
}

export function userLogTrades(owner: string): UserTrade[] { return userLogOf(owner).trades; }
export function userLogTransfers(owner: string): UserTransfer[] { return userLogOf(owner).transfers; }
export function userLogCreated(owner: string): string[] { return userLogOf(owner).created; }
