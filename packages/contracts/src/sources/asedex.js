// ─────────────────────────────────────────────────────────────────────
// AseDex — the AsePad exchange · https://asepad.fun
// Website: https://asepad.fun · X: https://x.com/asepadfun · Telegram: https://t.me/asepadfun
// ─────────────────────────────────────────────────────────────────────
// Constant-product AMM compatible with contract-funded AsePad migrations.
// Native ASE cannot be forwarded through E() on Asentum, so AsePad prefunds
// the pool directly and then calls seedLiquidity().

const FEE_DENOM = 10000n;
const DEFAULT_FEE_BPS = 30n;
// Of the 30 bps swap fee, this share goes to treasury; the rest stays in the
// pool and accrues to LPs. 6667/10000 ≈ 2/3 → 0.20% treasury + 0.10% LPs.
// Admin can retune both the total fee and this split at any time.
const TREASURY_SHARE_KEY = 'treasuryFeeShareBps';
const DEFAULT_TREASURY_SHARE_BPS = '6667';
const MAX_FEE_BPS = 1000n; // hard cap on the per-trade fee (10%)
const SCALE = 1000000000000000000n;
const ZERO = '0x0000000000000000000000000000000000000000';
const ASEPAD_LINKS = { website: 'https://asepad.fun', x: 'https://x.com/asepadfun', telegram: 'https://t.me/asepadfun' };
const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const SWAP_VOLUME_ASE_KEY = 'stats:swapVolumeAseWei';
const SWAP_COUNT_KEY = 'stats:swapCount';
const ASE_TVL_KEY = 'stats:aseTvlWei';
const SWAP_HISTORY_LIMIT = 256n;
const MAX_SWEEP = 20n;             // max order executions per sweep tick (gas bound)
const AUTO_SWEEP_SCAN = 16n;       // order records scanned after a price-moving call
const MAX_DCA_SLICES = 60n;        // cap on DCA order slices
const MIN_DCA_INTERVAL = 30n;      // seconds between DCA slices (testnet-friendly)
const MAX_POOL_ORDERS = 256n;      // pending orders per pool — bounds book spam
const MAX_OWNER_ORDERS = 32n;      // open orders per owner per pool
// Minimum order size in native terms on pools that touch ASE — makes book
// spam cost real escrow instead of being free.
const MIN_ORDER_NATIVE = 250000000000000000n; // 0.25 ASE
function _recordSwap(pool, swap) {
  const index = BigInt(pool.swapCount) - 1n;
  storage.set('swap:' + pool.id + ':' + (index % SWAP_HISTORY_LIMIT).toString(), JSON.stringify({ ...swap, index: index.toString() }));
}

function lc(a) { return String(a || '').toLowerCase(); }
function isAddr(a) { return typeof a === 'string' && /^0x[0-9a-f]{40}$/i.test(a); }
function assert(c, m) { if (!c) throw new Error(m || 'assert failed'); }
function pairKey(a, b) {
  const x = lc(a);
  const y = lc(b);
  return 'pair:' + (x < y ? x + ':' + y : y + ':' + x);
}
function sqrtFast(y) {
  if (y < 2n) return y;
  const bits = BigInt(y.toString(2).length);
  let x = 1n << ((bits + 1n) / 2n);
  let z = (x + y / x) / 2n;
  while (z < x) { x = z; z = (y / z + z) / 2n; }
  return x;
}
function _loadPool(id) {
  const raw = storage.get('pool:' + String(id));
  assert(raw, 'no such pool');
  return JSON.parse(raw);
}
// AsePad-owned launch status. The token's own bound pad is authoritative —
// after a pad-to-pad upgrade the token rebinds, so status follows the token —
// with the configured pad as fallback for tokens without a pad() view.
// Returns 'NOT_FOUND' when the token is not a pad launch or no pad answers.
function _padLaunchStatus(token) {
  let pad = '';
  try { pad = lc(E(token).pad() || ''); } catch { pad = ''; }
  if (!pad || pad === ZERO) pad = lc(storage.get('asePad') || '');
  if (!pad || pad === ZERO) return 'NOT_FOUND';
  let status;
  try { status = E(pad).getLaunchStatus(lc(token)); } catch { status = ''; }
  return String(status || 'NOT_FOUND').toUpperCase();
}
// Pad tokens may only join user liquidity once their launch finished the
// official migration. A user pool created while BONDING/BONDED or liquidity
// added while MIGRATING would collide with the pad's own createPool/
// seedLiquidity and permanently brick the migration. Allow-list the safe
// states so any in-between status stays locked.
function _assertDexOpen(token) {
  if (token === NATIVE) return;
  const status = _padLaunchStatus(token);
  assert(status === 'NOT_FOUND' || status === 'MIGRATED' || status === 'RECOVERED', 'AsePad token locked until migration completes');
}
// Selectable pool fee tiers (bps). AsePad migration pools always use 30.
const FEE_TIERS = ['1', '5', '30', '100'];
function _savePool(pool) { storage.set('pool:' + pool.id, JSON.stringify(pool)); }
function _shareKey(id, addr) { return 'share:' + String(id) + ':' + lc(addr); }
function _shareAllowKey(id, owner, spender) { return 'shareAllow:' + String(id) + ':' + lc(owner) + ':' + lc(spender); }
function _admin() { assert(lc(msg.sender) === storage.get('admin'), 'not admin'); }
// The configured pad plus any admin-trusted successor pads (pad-to-pad
// upgrades import live launches, whose migrations must still be allowed to
// create pools and seed liquidity here).
function _isPadAddr(a) {
  const x = lc(a);
  return x === lc(storage.get('asePad') || '') || storage.get('pad:' + x) === '1';
}
function _pad() { assert(_isPadAddr(msg.sender), 'not AsePad'); }
function _feeForInput(amt, bps) {
  const net = (amt * (FEE_DENOM - BigInt(bps))) / FEE_DENOM;
  return amt - net;
}
function _accrue(pool) {
  const now = BigInt(chain.blockTimestamp);
  const last = BigInt(pool.lastTs || '0');
  const dt = now - last;
  if (dt <= 0n) return;
  const r0 = BigInt(pool.reserve0);
  const r1 = BigInt(pool.reserve1);
  if (r0 > 0n && r1 > 0n) {
    pool.price0Cumulative = (BigInt(pool.price0Cumulative || '0') + (r1 * SCALE / r0) * dt).toString();
    pool.price1Cumulative = (BigInt(pool.price1Cumulative || '0') + (r0 * SCALE / r1) * dt).toString();
  }
  pool.lastTs = now.toString();
}
function _takeValue(needed) {
  const v = BigInt(msg.value || 0);
  assert(v >= needed, 'insufficient native value sent');
  if (v > needed) transfer(lc(msg.sender), (v - needed).toString());
}
function _pull(token, from, amt) {
  if (token === NATIVE) return;
  assert(E(token).transferFrom(lc(from), storage.get('self'), amt.toString()) === true, 'token pull failed');
}
function _pay(token, to, amt) {
  if (amt <= 0n) return;
  if (token === NATIVE) transfer(lc(to), amt.toString());
  else assert(E(token).transfer(lc(to), amt.toString()) === true, 'token pay failed');
}
function _lpSinceKey(poolId, acct) { return 'lpsince:' + String(poolId) + ':' + lc(acct); }
function _lpAcctKey(poolId, acct, kind) { return 'lp' + kind + ':' + String(poolId) + ':' + lc(acct); }
function _noteLpSince(poolId, acct, prevBal) {
  if (prevBal === 0n) storage.set(_lpSinceKey(poolId, acct), String(chain.blockTimestamp || '0'));
}
// Snapshot accumulator: pool.rps0/rps1 is the cumulative LP-fee-per-share index
// (SCALE-fixed). Each account remembers the index it last settled at — rewards
// owed = shares × (indexNow − indexThen) per token side. Call _settleLp BEFORE
// any share balance change so accrued rewards follow the balance that earned
// them. Burned-to-zero shares earn nothing: the index denominator excludes them.
function _settleLp(pool, acct) {
  const bal = BigInt(storage.get(_shareKey(pool.id, acct)) || '0');
  for (const s of [0, 1]) {
    const rps = BigInt(pool['rps' + s] || '0');
    const dk = _lpAcctKey(pool.id, acct, 'debt' + s);
    const owed = BigInt(storage.get(dk) || '0');
    if (rps > owed && bal > 0n) {
      const pk = _lpAcctKey(pool.id, acct, 'pend' + s);
      storage.set(pk, (BigInt(storage.get(pk) || '0') + bal * (rps - owed) / SCALE).toString());
    }
    storage.set(dk, rps.toString());
  }
}
function _claimLp(pool, acct) {
  _settleLp(pool, acct);
  const p0k = _lpAcctKey(pool.id, acct, 'pend0');
  const p1k = _lpAcctKey(pool.id, acct, 'pend1');
  const p0 = BigInt(storage.get(p0k) || '0');
  const p1 = BigInt(storage.get(p1k) || '0');
  if (p0 <= 0n && p1 <= 0n) return false;
  storage.set(p0k, '0'); storage.set(p1k, '0');
  pool.pot0 = (BigInt(pool.pot0 || '0') - p0).toString();
  pool.pot1 = (BigInt(pool.pot1 || '0') - p1).toString();
  _savePool(pool);
  _pay(pool.token0, acct, p0);
  _pay(pool.token1, acct, p1);
  emit('LpRewardsClaimed', { poolId: pool.id, provider: lc(acct), amount0: p0.toString(), amount1: p1.toString() });
  return true;
}
function _mint(pool, provider, a0, a1) {
  const total = BigInt(pool.totalShares);
  let minted;
  if (total === 0n) {
    minted = sqrtFast(a0 * a1);
  } else {
    const r0 = BigInt(pool.reserve0);
    const r1 = BigInt(pool.reserve1);
    const s0 = a0 * total / r0;
    const s1 = a1 * total / r1;
    minted = s0 < s1 ? s0 : s1;
  }
  assert(minted > 0n, 'insufficient liquidity minted');
  _settleLp(pool, provider); // lock in rewards owed to the existing balance first
  const key = _shareKey(pool.id, provider);
  const prevShares = BigInt(storage.get(key) || '0');
  storage.set(key, (prevShares + minted).toString());
  _noteLpSince(pool.id, provider, prevShares);
  pool.reserve0 = (BigInt(pool.reserve0) + a0).toString();
  pool.reserve1 = (BigInt(pool.reserve1) + a1).toString();
  const aseAdded = pool.token0 === NATIVE ? a0 : pool.token1 === NATIVE ? a1 : 0n;
  storage.set(ASE_TVL_KEY, (BigInt(storage.get(ASE_TVL_KEY) || '0') + aseAdded).toString());
  pool.totalShares = (total + minted).toString();
  _savePool(pool);
  emit('LiquidityAdded', { poolId: pool.id, provider: lc(provider), amount0: a0.toString(), amount1: a1.toString(), shares: minted.toString() });
  emit('Sync', { poolId: pool.id, reserve0: pool.reserve0, reserve1: pool.reserve1 });
  return minted;
}
function _amountOut(pool, tokenIn, amtIn) {
  if (amtIn <= 0n) return 0n;
  const inIs0 = tokenIn === pool.token0;
  assert(inIs0 || tokenIn === pool.token1, 'token not in pool');
  const rin = BigInt(inIs0 ? pool.reserve0 : pool.reserve1);
  const rout = BigInt(inIs0 ? pool.reserve1 : pool.reserve0);
  if (rin === 0n || rout === 0n) return 0n;
  const fee = BigInt(pool.feeBps);
  const afterFee = amtIn * (FEE_DENOM - fee);
  return afterFee * rout / (rin * FEE_DENOM + afterFee);
}

// Shared swap execution for direct swaps and escrowed order fills. The input
// tokens must already be inside this contract (msg.value just credited, or
// order escrow pulled earlier). Splits the fee, updates reserves, TWAP,
// volume stats and the swap ring buffer, pays the output and emits events.
function _swap(pool, tin, amt, min, recipient, trader) {
  assert(amt > 0n && min >= 0n, 'invalid amounts');
  _accrue(pool);
  const out = _amountOut(pool, tin, amt);
  assert(out >= min && out > 0n, 'insufficient output');
  const inIs0 = tin === pool.token0;
  const rin = BigInt(inIs0 ? pool.reserve0 : pool.reserve1);
  const rout = BigInt(inIs0 ? pool.reserve1 : pool.reserve0);
  const fee = _feeForInput(amt, BigInt(pool.feeBps));
  // Fee split: treasury takes its configured share. The LP share accrues to a
  // per-share reward index — only accounts holding shares when this fee lands
  // earn it (snapshot model; burned-to-zero shares earn nothing). If no live
  // LP exists — e.g. a migration pool whose LP is 100% burned — the full fee
  // goes to treasury instead.
  const treasuryFee = (fee * BigInt(storage.get(TREASURY_SHARE_KEY) || DEFAULT_TREASURY_SHARE_BPS)) / FEE_DENOM;
  const lpFee = fee - treasuryFee;
  const earners = BigInt(pool.totalShares) - BigInt(storage.get(_shareKey(pool.id, ZERO)) || '0');
  let treasuryCut = treasuryFee;
  if (lpFee > 0n && earners > 0n) {
    const idx = inIs0 ? 'rps0' : 'rps1';
    const pot = inIs0 ? 'pot0' : 'pot1';
    pool[idx] = (BigInt(pool[idx] || '0') + lpFee * SCALE / earners).toString();
    pool[pot] = (BigInt(pool[pot] || '0') + lpFee).toString();
  } else {
    treasuryCut = fee; // nobody to reward — treasury takes the whole fee
  }
  const reserveIn = amt - fee;
  if (inIs0) {
    pool.reserve0 = (rin + reserveIn).toString();
    pool.reserve1 = (rout - out).toString();
  } else {
    pool.reserve1 = (rin + reserveIn).toString();
    pool.reserve0 = (rout - out).toString();
  }
  const tokenOut = inIs0 ? pool.token1 : pool.token0;
  const platformTvl = BigInt(storage.get(ASE_TVL_KEY) || '0');
  if (tin === NATIVE) storage.set(ASE_TVL_KEY, (platformTvl + reserveIn).toString());
  else if (tokenOut === NATIVE) {
    assert(platformTvl >= out, 'platform TVL underflow');
    storage.set(ASE_TVL_KEY, (platformTvl - out).toString());
  }
  const volumeAse = tin === NATIVE ? amt : tokenOut === NATIVE ? out : 0n;
  pool.volumeAseWei = (BigInt(pool.volumeAseWei || '0') + volumeAse).toString();
  pool.swapCount = (BigInt(pool.swapCount || '0') + 1n).toString();
  storage.set(SWAP_VOLUME_ASE_KEY, (BigInt(storage.get(SWAP_VOLUME_ASE_KEY) || '0') + volumeAse).toString());
  storage.set(SWAP_COUNT_KEY, (BigInt(storage.get(SWAP_COUNT_KEY) || '0') + 1n).toString());
  const nativeIs0 = pool.token0 === NATIVE;
  const aseR = BigInt(nativeIs0 ? pool.reserve0 : pool.reserve1);
  const tokR = BigInt(nativeIs0 ? pool.reserve1 : pool.reserve0);
  _recordSwap(pool, {
    trader: lc(trader), tokenIn: tin, amountIn: amt.toString(), amountOut: out.toString(),
    fee: fee.toString(), treasuryFee: treasuryCut.toString(), volumeAseWei: volumeAse.toString(),
    reserve0: pool.reserve0, reserve1: pool.reserve1,
    priceAsePerTokenScaled: tokR > 0n ? (aseR * SCALE / tokR).toString() : '0',
    createdTs: String(chain.blockTimestamp || '0')
  });
  _savePool(pool);
  if (treasuryCut > 0n) _pay(tin, storage.get('treasury'), treasuryCut);
  _pay(tokenOut, lc(recipient), out);
  emit('Swap', { poolId: pool.id, sender: lc(trader), tokenIn: tin, amountIn: amt.toString(), amountOut: out.toString(), fee: fee.toString(), treasuryFee: treasuryCut.toString(), feeBps: pool.feeBps, treasury: storage.get('treasury'), volumeAseWei: volumeAse.toString() });
  emit('Sync', { poolId: pool.id, reserve0: pool.reserve0, reserve1: pool.reserve1 });
  return out;
}

// ── orders (limit + DCA) ────────────────────────────────────────────────
// Orders escrow their input in this contract at creation. A LIMIT order
// fills when the AMM output clears minOut; a DCA order fires one slice every
// intervalSec. Anyone can call sweepOrders(poolId) — a keeper or the user —
// fills can only execute on the order's own terms. Books are per-pool and
// capped so spam on one pool cannot raise the gas cost of other pools.
function _orderKey(id) { return 'order:' + String(id); }
function _ownerOrdersKey(addr) { return 'ordersOf:' + lc(addr); }
function _pendingKey(poolId) { return 'pending:' + String(poolId); }
function _cursorKey(poolId) { return 'sweepCursor:' + String(poolId); }
function _ownerOpenKey(poolId, addr) { return 'ownOpen:' + String(poolId) + ':' + lc(addr); }
function _pendingList(poolId) { return JSON.parse(storage.get(_pendingKey(poolId)) || '[]'); }
function _poolsWithOrders() { return JSON.parse(storage.get('pendingPools') || '[]'); }
function _savePending(poolId, list) {
  const pid = String(poolId);
  storage.set(_pendingKey(pid), JSON.stringify(list));
  const pools = _poolsWithOrders();
  const has = pools.includes(pid);
  if (list.length && !has) { pools.push(pid); storage.set('pendingPools', JSON.stringify(pools)); }
  else if (!list.length && has) {
    storage.set('pendingPools', JSON.stringify(pools.filter((p) => p !== pid)));
    storage.set(_cursorKey(pid), '0');
  }
}
function _pushPending(poolId, id) {
  const list = _pendingList(poolId);
  assert(BigInt(list.length) < MAX_POOL_ORDERS, 'pool order book full');
  list.push(String(id));
  _savePending(poolId, list);
}
function _removePending(poolId, id) {
  _savePending(poolId, _pendingList(poolId).filter((x) => x !== String(id)));
}
function _ownerOpen(poolId, owner) { return BigInt(storage.get(_ownerOpenKey(poolId, owner)) || '0'); }
function _bumpOwnerOpen(poolId, owner, delta) {
  storage.set(_ownerOpenKey(poolId, owner), (_ownerOpen(poolId, owner) + BigInt(delta)).toString());
}
function _indexOwnerOrder(owner, id) {
  const key = _ownerOrdersKey(owner);
  const list = JSON.parse(storage.get(key) || '[]');
  list.push(String(id));
  storage.set(key, JSON.stringify(list));
}
// Estimated native value of the input leg; null when the pool has no ASE leg.
function _orderValueNative(pool, tin, amt) {
  if (tin === NATIVE) return amt;
  if (pool.token0 !== NATIVE && pool.token1 !== NATIVE) return null;
  return _amountOut(pool, tin, amt);
}
function _assertOrderAllowed(pool, tin, amt, owner) {
  assert(_ownerOpen(pool.id, owner) < MAX_OWNER_ORDERS, 'too many open orders');
  const v = _orderValueNative(pool, tin, amt);
  assert(v === null || v >= MIN_ORDER_NATIVE, 'order too small');
}
// Execute a swap for an escrowed order. Trader/payer are the order owner —
// input already sits in this contract so no pull happens here.
function _execOrderSwap(pool, order, amt) {
  const out = _swap(pool, order.tokenIn, amt, BigInt(order.minOut || '0'), order.owner, order.owner);
  order.amountLeft = (BigInt(order.amountLeft) - amt).toString();
  return out;
}

// Fill engine shared by sweepOrders() and the price-moving methods. A plain
// function (not this.sweepOrders) so it never depends on method binding.
// Per-pool and bounded: it scans at most scanLimit pending entries starting
// from a rotating cursor and executes at most fillLimit fills, so a long or
// hostile book can't make swaps run out of gas.
function _sweepOrders(poolId, scanLimit, fillLimit) {
  const pid = String(poolId);
  const pending = _pendingList(pid);
  if (!pending.length) return 0;
  const scanMax = Math.min(Number(scanLimit), pending.length);
  const fillMax = BigInt(fillLimit);
  const now = BigInt(chain.blockTimestamp || '0');
  const start = Number(storage.get(_cursorKey(pid)) || '0') % pending.length;
  const dead = new Set();
  let filled = 0n;
  let scanned = 0;
  for (let k = 0; k < pending.length && scanned < scanMax && filled < fillMax; k++) {
    const id = pending[(start + k) % pending.length];
    scanned++;
    const raw = storage.get(_orderKey(id));
    if (!raw) { dead.add(id); continue; }
    const order = JSON.parse(raw);
    if (order.status !== 'open' || order.poolId !== pid) { dead.add(id); continue; }
    const pool = _loadPool(order.poolId);
    if (order.kind === 'LIMIT') {
      const amt = BigInt(order.amountLeft);
      const out = _amountOut(pool, order.tokenIn, amt);
      if (out < BigInt(order.minOut)) continue;
      const got = _execOrderSwap(pool, order, amt);
      order.status = 'filled';
      order.filledOut = got.toString();
      order.filledAt = String(chain.blockTimestamp || '0');
      storage.set(_orderKey(id), JSON.stringify(order));
      emit('LimitOrderFilled', { orderId: id, owner: order.owner, amountIn: amt.toString(), amountOut: got.toString() });
      filled += 1n;
      dead.add(id);
      _bumpOwnerOpen(pid, order.owner, -1n);
    } else {
      // DCA: fire every due slice, capped by fillLimit
      let n = BigInt(order.slicesTotal);
      let done = BigInt(order.slicesDone);
      while (done < n && filled < fillMax && now >= BigInt(order.nextTs || '0')) {
        // Skip this tick rather than revert when the slice's minOut can't
        // clear — a reverting swap would poison the whole sweep.
        const estOut = _amountOut(pool, order.tokenIn, BigInt(order.sliceIn));
        if (estOut < BigInt(order.minOut || '0')) break;
        const got = _execOrderSwap(pool, order, BigInt(order.sliceIn));
        done += 1n;
        order.slicesDone = done.toString();
        order.totalOut = (BigInt(order.totalOut || '0') + got).toString();
        order.nextTs = (now + BigInt(order.intervalSec)).toString();
        emit('DcaSliceFilled', { orderId: id, owner: order.owner, slice: order.slicesDone, amountIn: order.sliceIn, amountOut: got.toString() });
        filled += 1n;
      }
      if (done >= n) {
        order.status = 'filled';
        order.filledAt = String(chain.blockTimestamp || '0');
        const dust = BigInt(order.amountLeft);
        if (dust > 0n) { _pay(order.tokenIn, order.owner, dust); order.amountLeft = '0'; }
        dead.add(id);
        _bumpOwnerOpen(pid, order.owner, -1n);
      }
      storage.set(_orderKey(id), JSON.stringify(order));
    }
  }
  storage.set(_cursorKey(pid), String((start + scanned) % pending.length));
  if (dead.size) _savePending(pid, pending.filter((id) => !dead.has(id)));
  return Number(filled);
}

({
  init(admin, asePad, treasury, feeBps) {
    assert(!storage.get('self'), 'already initialised');
    const a = lc(admin || msg.sender);
    const p = lc(asePad || ZERO);
    const tr = lc(treasury || admin || msg.sender);
    const fee = feeBps === undefined || feeBps === null ? DEFAULT_FEE_BPS : BigInt(feeBps);
    assert(isAddr(a), 'admin required');
    assert(isAddr(p), 'AsePad required');
    assert(isAddr(tr) && tr !== ZERO, 'treasury required');
    assert(fee === DEFAULT_FEE_BPS, 'AseDex swap fee fixed at 30 bps');
    storage.set('self', lc(msg.contractAddress));
    storage.set('admin', a);
    storage.set('asePad', p);
    storage.set('treasury', tr);
    storage.set('feeBps', fee.toString());
    storage.set(TREASURY_SHARE_KEY, DEFAULT_TREASURY_SHARE_BPS);
    storage.set('poolCount', '0');
    storage.set(SWAP_VOLUME_ASE_KEY, '0');
    storage.set(SWAP_COUNT_KEY, '0');
    storage.set(ASE_TVL_KEY, '0');
    emit('Initialised', { self: lc(msg.contractAddress), admin: a, asePad: p, treasury: tr, feeBps: fee.toString() });
    return true;
  },

  admin() { return storage.get('admin') || ''; },
  platform() { return 'AsePad'; },
  name() { return 'AseDex Exchange'; },
  symbol() { return 'ASEDEX'; },
  contractName() { return 'AseDex Exchange'; },
  version() { return '1'; },
  exchangeName() { return 'AseDex'; },
  treasury() { return storage.get('treasury') || ''; },
  feeBps() { return storage.get('feeBps') || DEFAULT_FEE_BPS.toString(); },
  setFeeBps(bps) {
    _admin();
    const v = BigInt(bps);
    assert(v >= 0n && v <= MAX_FEE_BPS, 'fee out of range');
    storage.set('feeBps', v.toString());
    emit('SwapFeeUpdated', { feeBps: v.toString() });
    return true;
  },
  setPoolFeeBps(poolId, bps) {
    _admin();
    const pool = _loadPool(poolId);
    // A pad token's migration asserts a 30 bps pool — retuning mid-migration
    // would brick it, so fee changes wait until the launch is done.
    _assertDexOpen(pool.token0);
    _assertDexOpen(pool.token1);
    const v = BigInt(bps);
    assert(v >= 0n && v <= MAX_FEE_BPS, 'fee out of range');
    pool.feeBps = v.toString();
    _savePool(pool);
    emit('SwapFeeUpdated', { poolId: pool.id, feeBps: v.toString() });
    return true;
  },
  treasuryShareBps() { return storage.get(TREASURY_SHARE_KEY) || DEFAULT_TREASURY_SHARE_BPS; },
  setTreasuryShareBps(bps) {
    _admin();
    const v = BigInt(bps);
    assert(v >= 0n && v <= FEE_DENOM, 'treasury share out of range');
    storage.set(TREASURY_SHARE_KEY, v.toString());
    emit('TreasuryShareUpdated', { treasuryShareBps: v.toString() });
    return true;
  },
  lpSince(poolId, account) { return storage.get(_lpSinceKey(poolId, lc(account))) || '0'; },
  // Rewards owed to an LP right now, in pool-order token units — includes the
  // not-yet-settled accrual since their last share-balance change.
  lpPendingRewards(poolId, account) {
    const pool = _loadPool(poolId);
    const acct = lc(account);
    const bal = BigInt(storage.get(_shareKey(pool.id, acct)) || '0');
    const out = {};
    for (const s of [0, 1]) {
      const rps = BigInt(pool['rps' + s] || '0');
      const debt = BigInt(storage.get(_lpAcctKey(pool.id, acct, 'debt' + s)) || '0');
      const pend = BigInt(storage.get(_lpAcctKey(pool.id, acct, 'pend' + s)) || '0');
      out['amount' + s] = (pend + (rps > debt ? bal * (rps - debt) / SCALE : 0n)).toString();
    }
    return JSON.stringify(out);
  },
  claimLpRewards(poolId) {
    const pool = _loadPool(poolId);
    assert(_claimLp(pool, lc(msg.sender)), 'no LP rewards to claim');
    return true;
  },
  asePad() { return storage.get('asePad') || ''; },
  transferAdmin(newAdmin) {
    _admin();
    const a = lc(newAdmin);
    assert(isAddr(a) && a !== ZERO, 'invalid admin');
    storage.set('admin', a);
    emit('AdminTransferred', { admin: a });
    return true;
  },
  setTreasury(address) {
    _admin();
    const tr = lc(address);
    assert(isAddr(tr) && tr !== ZERO, 'invalid treasury');
    storage.set('treasury', tr);
    emit('TreasuryUpdated', { treasury: tr });
    return true;
  },
  deploymentBrand() { return JSON.stringify({ platform: 'AsePad', exchange: 'AseDex', ...ASEPAD_LINKS, feeBps: storage.get('feeBps') || DEFAULT_FEE_BPS.toString() }); },
  links() { return JSON.stringify(ASEPAD_LINKS); },
  // Repointable forever — a pad upgrade never forces a new AseDex. The
  // outgoing pad stays trusted so launches still bound to it finish migrating
  // and their status keeps answering the pool gates; untrustPad() removes it
  // explicitly once fully retired.
  setAsePad(pad) {
    _admin();
    const p = lc(pad);
    assert(isAddr(p) && p !== ZERO, 'invalid AsePad');
    const prev = lc(storage.get('asePad') || '');
    assert(p !== prev, 'already the pad');
    if (prev && prev !== ZERO) storage.set('pad:' + prev, '1');
    storage.set('asePad', p);
    emit('AsePadUpdated', { asePad: p, previous: prev });
    return true;
  },
  // Trusted successor pads — a pad upgraded away from still holds migrated
  // pools; launches imported onto a new pad migrate here under its authority.
  trustPad(p) {
    _admin();
    const a = lc(p);
    assert(isAddr(a) && a !== ZERO, 'invalid AsePad');
    storage.set('pad:' + a, '1');
    emit('PadTrusted', { asePad: a });
    return true;
  },
  untrustPad(p) {
    _admin();
    const a = lc(p);
    assert(isAddr(a), 'invalid AsePad');
    storage.delete('pad:' + a);
    emit('PadUntrusted', { asePad: a });
    return true;
  },
  trustedPad(p) { return _isPadAddr(p) ? '1' : '0'; },

  createPool(token0, token1, feeBps) {
    const t0 = lc(token0);
    const t1 = lc(token1);
    assert(isAddr(t0) && isAddr(t1), 'invalid token address');
    assert(t0 !== t1, 'identical tokens');
    const pk = pairKey(t0, t1);
    assert(!storage.get(pk), 'pool exists');
    // The pad itself may create pools mid-migration; users may not.
    const byPad = _isPadAddr(msg.sender);
    if (!byPad) {
      _assertDexOpen(t0);
      _assertDexOpen(t1);
    }
    // Creator picks a fee tier (blank = global default); admin can retune per pool later.
    let fee = BigInt(storage.get('feeBps') || DEFAULT_FEE_BPS);
    if (feeBps !== undefined && feeBps !== null && String(feeBps) !== '') {
      assert(FEE_TIERS.includes(String(BigInt(feeBps))), 'unsupported fee tier');
      fee = BigInt(feeBps);
    }
    if (byPad) assert(fee === DEFAULT_FEE_BPS, 'migration pools use 30 bps');
    const id = (BigInt(storage.get('poolCount')) + 1n).toString();
    const pool = {
      id,
      token0: t0,
      token1: t1,
      reserve0: '0',
      reserve1: '0',
      totalShares: '0',
      feeBps: fee.toString(),
      rps0: '0', rps1: '0',   // cumulative LP-reward-per-share indices (SCALE)
      pot0: '0', pot1: '0',   // reward pots owed to LPs, kept OUT of reserves
      price0Cumulative: '0',
      price1Cumulative: '0',
      volumeAseWei: '0',
      swapCount: '0',
      lastTs: chain.blockTimestamp.toString()
    };
    _savePool(pool);
    storage.set(pk, id);
    storage.set('poolCount', id);
    emit('PoolCreated', { poolId: id, token0: t0, token1: t1, feeBps: fee.toString() });
    return id;
  },

  // Called by AsePad only after it directly transferred both pool assets to
  // this contract in the same transaction. No nested native value or token pull
  // is required; the pad's call itself is the authority for pool crediting.
  seedLiquidity(poolId, amount0, amount1) {
    _pad();
    const pool = _loadPool(poolId);
    const a0 = BigInt(amount0);
    const a1 = BigInt(amount1);
    assert(a0 > 0n && a1 > 0n, 'amounts must be positive');
    assert(pool.reserve0 === '0' && pool.reserve1 === '0' && pool.totalShares === '0', 'pool already seeded');
    _accrue(pool);
    const minted = _mint(pool, lc(msg.sender), a0, a1);
    emit('LiquiditySeeded', { poolId: pool.id, pad: lc(msg.sender), amount0: a0.toString(), amount1: a1.toString(), shares: minted.toString() });
    return minted.toString();
  },

  addLiquidity(poolId, amount0, amount1, minShares) {
    const pool = _loadPool(poolId);
    _assertDexOpen(pool.token0);
    _assertDexOpen(pool.token1);
    const sender = lc(msg.sender);
    const max0 = BigInt(amount0);
    const max1 = BigInt(amount1);
    const minimum = BigInt(minShares || '0');
    assert(max0 > 0n && max1 > 0n && minimum >= 0n, 'invalid liquidity amounts');
    _accrue(pool);
    let a0 = max0;
    let a1 = max1;
    const total = BigInt(pool.totalShares);
    if (total > 0n) {
      const r0 = BigInt(pool.reserve0);
      const r1 = BigInt(pool.reserve1);
      const optimal1 = max0 * r1 / r0;
      if (optimal1 <= max1) a1 = optimal1;
      else a0 = max1 * r0 / r1;
    }
    assert(a0 > 0n && a1 > 0n, 'liquidity amount too small');
    let nativeNeeded = 0n;
    if (pool.token0 === NATIVE) nativeNeeded += a0;
    if (pool.token1 === NATIVE) nativeNeeded += a1;
    _takeValue(nativeNeeded);
    _pull(pool.token0, sender, a0);
    _pull(pool.token1, sender, a1);
    const minted = _mint(pool, sender, a0, a1);
    assert(minted >= minimum, 'minimum LP shares not met');
    _sweepOrders(pool.id, AUTO_SWEEP_SCAN, MAX_SWEEP); // price moved — fill due orders automatically
    return minted.toString();
  },

  removeLiquidity(poolId, shares, minAmount0, minAmount1) {
    const pool = _loadPool(poolId);
    const sender = lc(msg.sender);
    const burn = BigInt(shares);
    assert(burn > 0n, 'shares must be positive');
    const key = _shareKey(pool.id, sender);
    const held = BigInt(storage.get(key) || '0');
    assert(held >= burn, 'insufficient shares');
    _settleLp(pool, sender); // snapshot rewards earned by the balance being burned
    _accrue(pool);
    const total = BigInt(pool.totalShares);
    const r0 = BigInt(pool.reserve0);
    const r1 = BigInt(pool.reserve1);
    const out0 = burn * r0 / total;
    const out1 = burn * r1 / total;
    assert(out0 > 0n && out1 > 0n, 'nothing to withdraw');
    assert(out0 >= BigInt(minAmount0 || '0') && out1 >= BigInt(minAmount1 || '0'), 'minimum liquidity output not met');
    pool.reserve0 = (r0 - out0).toString();
    pool.reserve1 = (r1 - out1).toString();
    const aseRemoved = pool.token0 === NATIVE ? out0 : pool.token1 === NATIVE ? out1 : 0n;
    const platformTvl = BigInt(storage.get(ASE_TVL_KEY) || '0');
    assert(platformTvl >= aseRemoved, 'platform TVL underflow');
    storage.set(ASE_TVL_KEY, (platformTvl - aseRemoved).toString());
    pool.totalShares = (total - burn).toString();
    storage.set(key, (held - burn).toString());
    _savePool(pool);
    _pay(pool.token0, sender, out0);
    _pay(pool.token1, sender, out1);
    _claimLp(pool, sender); // auto-pay accrued LP rewards alongside the withdrawal
    emit('LiquidityRemoved', { poolId: pool.id, provider: sender, amount0: out0.toString(), amount1: out1.toString(), shares: burn.toString() });
    emit('Sync', { poolId: pool.id, reserve0: pool.reserve0, reserve1: pool.reserve1 });
    _sweepOrders(pool.id, AUTO_SWEEP_SCAN, MAX_SWEEP); // price moved — fill due orders automatically
    return JSON.stringify({ amount0: out0.toString(), amount1: out1.toString() });
  },

  swapExactIn(poolId, tokenIn, amountIn, minOut) {
    const pool = _loadPool(poolId);
    const sender = lc(msg.sender);
    const tin = lc(tokenIn);
    const amt = BigInt(amountIn);
    const min = BigInt(minOut);
    assert(amt > 0n && min >= 0n, 'invalid amounts');
    _takeValue(tin === NATIVE ? amt : 0n);
    _pull(tin, sender, amt);
    const out = _swap(pool, tin, amt, min, sender, sender);
    _sweepOrders(pool.id, AUTO_SWEEP_SCAN, MAX_SWEEP); // price moved — fill due orders automatically
    return out.toString();
  },

  // ── limit + DCA orders ────────────────────────────────────────────────

  // Post a limit order: escrow amountIn of tokenIn now, filled by sweepOrders()
  // only when the AMM output reaches minOut. Native input rides msg.value,
  // ARC-20 input is pulled via transferFrom (needs a prior approve).
  createLimitOrder(poolId, tokenIn, amountIn, minOut) {
    const pool = _loadPool(poolId);
    const sender = lc(msg.sender);
    const tin = lc(tokenIn);
    assert(tin === pool.token0 || tin === pool.token1, 'token not in pool');
    const amt = BigInt(amountIn);
    const min = BigInt(minOut);
    assert(amt > 0n && min > 0n, 'amounts must be positive');
    _assertOrderAllowed(pool, tin, amt, sender);
    _takeValue(tin === NATIVE ? amt : 0n);
    _pull(tin, sender, amt);
    const id = (BigInt(storage.get('orderCount') || '0') + 1n).toString();
    storage.set('orderCount', id);
    const order = {
      id, owner: sender, poolId: pool.id, kind: 'LIMIT',
      tokenIn: tin, amountLeft: amt.toString(), totalIn: amt.toString(),
      minOut: min.toString(),
      sliceIn: '0', slicesTotal: '1', slicesDone: '0', intervalSec: '0', nextTs: '0',
      status: 'open', createdAt: String(chain.blockTimestamp || '0')
    };
    storage.set(_orderKey(id), JSON.stringify(order));
    _pushPending(pool.id, id);
    _bumpOwnerOpen(pool.id, sender, 1n);
    _indexOwnerOrder(sender, id);
    emit('LimitOrderCreated', { orderId: id, owner: sender, poolId: pool.id, tokenIn: tin, amountIn: amt.toString(), minOut: min.toString() });
    return id;
  },

  // Post a DCA order: escrow totalIn, then swap sliceIn every intervalSec.
  // Slice 1 executes immediately; the rest are fired by sweepOrders().
  // minOutPerSlice applies to every slice (0 = any output).
  createDcaOrder(poolId, tokenIn, totalIn, slices, intervalSec, minOutPerSlice) {
    const pool = _loadPool(poolId);
    const sender = lc(msg.sender);
    const tin = lc(tokenIn);
    assert(tin === pool.token0 || tin === pool.token1, 'token not in pool');
    const total = BigInt(totalIn);
    const n = BigInt(slices);
    const interval = BigInt(intervalSec);
    const minSlice = BigInt(minOutPerSlice || '0');
    assert(total > 0n, 'total must be positive');
    assert(n >= 2n && n <= MAX_DCA_SLICES, 'slices out of range');
    assert(interval >= MIN_DCA_INTERVAL, 'interval too short');
    const sliceIn = total / n;
    assert(sliceIn > 0n, 'slice too small');
    _assertOrderAllowed(pool, tin, total, sender);
    _takeValue(tin === NATIVE ? total : 0n);
    _pull(tin, sender, total);
    const id = (BigInt(storage.get('orderCount') || '0') + 1n).toString();
    storage.set('orderCount', id);
    const order = {
      id, owner: sender, poolId: pool.id, kind: 'DCA',
      tokenIn: tin, amountLeft: total.toString(), totalIn: total.toString(),
      minOut: minSlice.toString(),
      sliceIn: sliceIn.toString(), slicesTotal: n.toString(), slicesDone: '0',
      intervalSec: interval.toString(), nextTs: '0',
      status: 'open', createdAt: String(chain.blockTimestamp || '0'),
      totalOut: '0'
    };
    // Execute the first slice right away; later slices ride the sweep clock.
    const firstOut = _execOrderSwap(pool, order, sliceIn);
    order.slicesDone = '1';
    order.totalOut = firstOut.toString();
    const now = BigInt(chain.blockTimestamp || '0');
    order.nextTs = (now + interval).toString();
    if (BigInt(order.slicesDone) >= n) {
      order.status = 'filled';
      order.filledAt = String(chain.blockTimestamp || '0');
      // refund any rounding dust left in escrow
      if (BigInt(order.amountLeft) > 0n) { _pay(tin, sender, BigInt(order.amountLeft)); order.amountLeft = '0'; }
    } else {
      _pushPending(pool.id, id);
      _bumpOwnerOpen(pool.id, sender, 1n);
    }
    storage.set(_orderKey(id), JSON.stringify(order));
    _indexOwnerOrder(sender, id);
    emit('DcaOrderCreated', { orderId: id, owner: sender, poolId: pool.id, tokenIn: tin, totalIn: total.toString(), slices: n.toString(), intervalSec: interval.toString(), minOutPerSlice: minSlice.toString() });
    emit('DcaSliceFilled', { orderId: id, owner: sender, slice: '1', amountIn: sliceIn.toString(), amountOut: firstOut.toString() });
    return id;
  },

  // Cancel an open order and refund everything still escrowed.
  cancelOrder(orderId) {
    const raw = storage.get(_orderKey(orderId));
    assert(raw, 'no such order');
    const order = JSON.parse(raw);
    assert(order.status === 'open', 'order not open');
    assert(lc(msg.sender) === order.owner, 'not order owner');
    order.status = 'cancelled';
    storage.set(_orderKey(orderId), JSON.stringify(order));
    _removePending(order.poolId, orderId);
    _bumpOwnerOpen(order.poolId, order.owner, -1n);
    const left = BigInt(order.amountLeft);
    if (left > 0n) _pay(order.tokenIn, order.owner, left);
    order.amountLeft = '0';
    emit('OrderCancelled', { orderId, owner: order.owner, refunded: left.toString() });
    return true;
  },

  // Permissionless fill engine — a keeper or any user can call this once per
  // pool. Executes LIMIT orders whose output now clears minOut and DCA slices
  // that are due. Scans the pool's whole (capped) book, fills ≤ MAX_SWEEP.
  sweepOrders(poolId) { const pool = _loadPool(poolId); return _sweepOrders(pool.id, MAX_POOL_ORDERS, MAX_SWEEP); },

  transferShares(poolId, to, shares) {
    const sender = lc(msg.sender);
    const recipient = lc(to);
    const amt = BigInt(shares);
    assert(isAddr(recipient) && amt > 0n, 'invalid share transfer');
    const sk = _shareKey(poolId, sender);
    const dk = _shareKey(poolId, recipient);
    const fromBal = BigInt(storage.get(sk) || '0');
    assert(fromBal >= amt, 'insufficient shares');
    const pool = _loadPool(poolId);
    _settleLp(pool, sender);    // sender keeps rewards earned up to now
    _settleLp(pool, recipient); // recipient's index snapshot moves to now
    storage.set(sk, (fromBal - amt).toString());
    const recPrev = BigInt(storage.get(dk) || '0');
    storage.set(dk, (recPrev + amt).toString());
    _noteLpSince(poolId, recipient, recPrev);
    emit('SharesTransferred', { poolId: String(poolId), from: sender, to: recipient, shares: amt.toString() });
    return true;
  },

  approveShares(poolId, spender, shares) {
    const owner = lc(msg.sender);
    const sp = lc(spender);
    const amt = BigInt(shares);
    assert(isAddr(sp) && amt >= 0n, 'invalid approval');
    storage.set(_shareAllowKey(poolId, owner, sp), amt.toString());
    emit('SharesApproved', { poolId: String(poolId), owner, spender: sp, shares: amt.toString() });
    return true;
  },

  transferSharesFrom(poolId, from, to, shares) {
    const owner = lc(from);
    const spender = lc(msg.sender);
    const recipient = lc(to);
    const amt = BigInt(shares);
    assert(isAddr(recipient) && amt > 0n, 'invalid share transfer');
    const ak = _shareAllowKey(poolId, owner, spender);
    const allowed = BigInt(storage.get(ak) || '0');
    assert(allowed >= amt, 'share allowance exceeded');
    storage.set(ak, (allowed - amt).toString());
    const sk = _shareKey(poolId, owner);
    const dk = _shareKey(poolId, recipient);
    const fromBal = BigInt(storage.get(sk) || '0');
    assert(fromBal >= amt, 'insufficient shares');
    const pool = _loadPool(poolId);
    _settleLp(pool, owner);     // rewards stay with the holder at accrual time
    _settleLp(pool, recipient);
    storage.set(sk, (fromBal - amt).toString());
    const recPrev = BigInt(storage.get(dk) || '0');
    storage.set(dk, (recPrev + amt).toString());
    _noteLpSince(poolId, recipient, recPrev);
    emit('SharesTransferred', { poolId: String(poolId), from: owner, to: recipient, shares: amt.toString() });
    return true;
  },

  getPool(poolId) { return storage.get('pool:' + String(poolId)) || 'null'; },
  poolForPair(token0, token1) { return storage.get(pairKey(token0, token1)) || ''; },
  sharesOf(poolId, addr) { return storage.get(_shareKey(poolId, addr)) || '0'; },
  getOrder(orderId) { return storage.get(_orderKey(orderId)) || 'null'; },
  openOrders() {
    const all = [];
    for (const pid of _poolsWithOrders()) for (const id of _pendingList(pid)) all.push(id);
    return JSON.stringify(all);
  },
  openOrdersForPool(poolId) { return JSON.stringify(_pendingList(String(poolId))); },
  poolsWithOrders() { return storage.get('pendingPools') || '[]'; },
  ordersOf(owner) { return storage.get(_ownerOrdersKey(owner)) || '[]'; },
  orderCount() { return storage.get('orderCount') || '0'; },
  shareAllowance(poolId, owner, spender) { return storage.get(_shareAllowKey(poolId, owner, spender)) || '0'; },
  poolShareSupply(poolId) { const p = _loadPool(poolId); return p.totalShares; },
  poolCount() { return storage.get('poolCount') || '0'; },
  recentSwaps(poolId, limit) {
    const pool = _loadPool(poolId);
    const total = BigInt(pool.swapCount || '0');
    const requested = BigInt(limit || '50');
    assert(requested > 0n, 'swap limit must be positive');
    const take = requested > SWAP_HISTORY_LIMIT ? SWAP_HISTORY_LIMIT : requested;
    const swaps = [];
    for (let i = total > take ? total - take : 0n; i < total; i++) {
      const raw = storage.get('swap:' + pool.id + ':' + (i % SWAP_HISTORY_LIMIT).toString());
      if (!raw) continue;
      const swap = JSON.parse(raw);
      if (BigInt(swap.index) === i) swaps.push(swap);
    }
    swaps.reverse();
    return JSON.stringify({ swaps, totalCount: total.toString(), historyLimited: total > SWAP_HISTORY_LIMIT });
  },
  platformStats() {
    return JSON.stringify({
      poolCount: storage.get('poolCount') || '0',
      realAseTvlWei: storage.get(ASE_TVL_KEY) || '0',
      aseSwapVolumeWei: storage.get(SWAP_VOLUME_ASE_KEY) || '0',
      swapCount: storage.get(SWAP_COUNT_KEY) || '0'
    });
  },
  quote(poolId, tokenIn, amountIn) {
    const pool = _loadPool(poolId);
    return _amountOut(pool, lc(tokenIn), BigInt(amountIn)).toString();
  },
  lpSymbol(poolId) {
    const pool = _loadPool(poolId);
    const a = pool.token0 === NATIVE ? 'ASE' : pool.token0.slice(-6);
    const b = pool.token1 === NATIVE ? 'ASE' : pool.token1.slice(-6);
    return 'ASEDEX-' + a + '-' + b;
  }
})
