// ASEPAD — A bonding-curve launchpad on Asentum
// Deployed and operated by AsePad. Token launches migrate to AseDex.
// Address normalizer: validates ase1 Bech32 (HRP ase, 20-byte account) and
// returns canonical lowercase 0x-hex. Malformed ase1 values revert; non-ase1
// inputs are normalized for the existing 0x validator.
const _B32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const _B32_GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const _HRP_EXPAND = [97, 115, 101].map((c) => c >> 5).concat([0], [97, 115, 101].map((c) => c & 31));
function _b32Polymod(values) {
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= _B32_GEN[i];
  }
  return chk;
}
function _from5Bit(values) {
  let acc = 0, bits = 0;
  const out = [];
  for (const v of values) {
    acc = (acc << 5) | v;
    bits += 5;
    while (bits >= 8) { bits -= 8; out.push((acc >> bits) & 0xff); }
  }
  if (bits >= 5 || ((acc << (8 - bits)) & 0xff)) return null;
  return out;
}
function _norm(v) {
  const s = String(v).toLowerCase();
  if (!s.startsWith('ase1')) return s;
  assert(s.length === 42, 'invalid ase1 address');
  const data = [];
  for (let i = 4; i < s.length; i++) {
    const c = _B32.indexOf(s[i]);
    assert(c >= 0, 'invalid ase1 address');
    data.push(c);
  }
  assert(_b32Polymod(_HRP_EXPAND.concat(data)) === 1, 'invalid ase1 checksum');
  const bytes = _from5Bit(data.slice(0, -6));
  assert(bytes && bytes.length === 20, 'invalid ase1 account');
  let h = '0x';
  for (const b of bytes) h += b.toString(16).padStart(2, '0');
  return h;
}

// ASEPAD v2 — virtual-cap priced curve with real-reserve settlement.
//
// Economics:
//   - a virtual ASE pricing base establishes the configured $4k market-cap floor
//   - only real ASE is held, paid out, counted in reserve accounting, or migrated
//   - x*y=k where x = real ASE + virtual ASE base, y = curve token reserve
//   - protocol fee comes out of the gross trade amount
//   - target is a threshold, not a cap; the full final buy is accepted
//   - creator receives creatorBps of the target once; every ASE above that
//     fixed reward remains in the AseDex liquidity position
//
// Sells are executed by AsePad's top-level sell() entry using standard ARC-20
// allowance. That entry pays the seller and treasury directly; there is no
// pendingSell/claimSell path in the final product.
const ADMIN_KEY = 'cfg:admin';
const TREASURY_KEY = 'cfg:treasury';
const ASEDEX_KEY = 'cfg:aseDex';
const TESTNET_KEY = 'cfg:testnet';
const CREATION_FEE_KEY = 'cfg:creationFee';
const FEE_BPS_KEY = 'cfg:feeBps';
const TARGET_KEY = 'cfg:target';
const CREATOR_BPS_KEY = 'cfg:creatorBps';
const VIRTUAL_ASE_KEY = 'cfg:virtualAseWei';
// Owner-settable ASE/USD reference price, fixed-point 6 decimals
// (3418000 = $3.418). Display only — the UI falls back to its env default
// when unset; a future oracle feed can overwrite it through the same setter.
const ASE_USD_KEY = 'cfg:aseUsdScaled';
const PAUSED_KEY = 'cfg:paused';
const COUNT_KEY = 'launch:count';
const LAUNCH_PREFIX = 'launch:';
const LAUNCH_INDEX_PREFIX = 'launch:index:';
const TRADE_PREFIX = 'launch:trade:';
const TRADE_HISTORY_LIMIT = 256n;
const TOKEN_BALANCE_PREFIX = 'acct:tokenBalance:';
const HELD_KEY = 'acct:heldWei';
const RESERVE_TOTAL_KEY = 'acct:reserveTotalWei';
const BUY_VOLUME_TOTAL_KEY = 'stats:curveBuyVolumeWei';
const SELL_VOLUME_TOTAL_KEY = 'stats:curveSellVolumeWei';
const BONDED_COUNT_KEY = 'stats:bondedCount';
const MIGRATED_COUNT_KEY = 'stats:migratedCount';
const UPGRADE_PAD_KEY = 'cfg:upgradePad';
const LEGACY_PAD_KEY = 'cfg:legacyPad';
const ZERO = '0x0000000000000000000000000000000000000000';
const ASEPAD_LINKS = { website: 'https://asepad.fun', x: 'https://x.com/asepadfun', telegram: 'https://t.me/asepadfun' };
const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const BPS = 10000n;
const SCALE = 1000000000000000000n;
const MAX_CREATOR_BPS = 1000n;
const MAX_FEE_BPS = 9999n;

function _launchKey(token) { return LAUNCH_PREFIX + token; }
function _findLaunch(token) {
  const raw = storage.get(_launchKey(token));
  return raw ? JSON.parse(raw) : null;
}
function _loadLaunch(token) {
  const l = _findLaunch(token);
  assert(l, 'launch not found');
  return l;
}
function _tokenBalance(token) {
  return BigInt(storage.get(TOKEN_BALANCE_PREFIX + token) || '0');
}
function _setTokenBalance(token, amount) {
  storage.set(TOKEN_BALANCE_PREFIX + token, BigInt(amount).toString());
}
function _syncAliases(l) {
  // Compatibility with the existing API/indexer field names.
  l.reserve = l.aseReserve;
  l.tokensLeft = l.tokenReserve;
  l.volume = l.volumeWei;
  l.supply = l.totalSupply;
  l.x0 = l.tokenReserve; // token side
  l.y0 = l.aseReserve;   // ASE side
}
function _saveLaunch(l) { _syncAliases(l); storage.set(_launchKey(l.token), JSON.stringify(l)); }
function _recordTrade(l, trade) {
  const index = BigInt(l.tradeCount) - 1n;
  const slot = index % TRADE_HISTORY_LIMIT;
  storage.set(TRADE_PREFIX + l.token + ':' + slot.toString(), JSON.stringify({ ...trade, index: index.toString() }));
}
function _admin() { assert(_norm(msg.sender) === storage.get(ADMIN_KEY), 'not admin'); }
function _open(l) {
  assert(storage.get(PAUSED_KEY) !== '1', 'paused');
  assert(l.status === 'BONDING', 'not bonding');
}
function _isAddr(a) { return /^0x[0-9a-f]{40}$/.test(String(a)); }
function _pow10(n) {
  let out = 1n;
  const c = BigInt(n);
  for (let i = 0n; i < c; i++) out *= 10n;
  return out;
}
function _big(v) { return BigInt(v || '0'); }
function _json(raw, fallback) {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
function _add(key, delta) {
  storage.set(key, (_big(storage.get(key)) + BigInt(delta)).toString());
}
function _sub(key, delta) {
  const next = _big(storage.get(key)) - BigInt(delta);
  assert(next >= 0n, 'accounting underflow');
  storage.set(key, next.toString());
}
function _payNative(to, amountWei) {
  const amt = BigInt(amountWei);
  if (amt <= 0n) return;
  const recipient = _norm(to);
  assert(_isAddr(recipient), 'invalid native recipient');
  transfer(recipient, amt.toString());
  _sub(HELD_KEY, amt);
}
function _pricingAse(l, aseReserve) {
  return BigInt(l.virtualAseWei || '0') + BigInt(aseReserve || '0');
}
function _spotRaw(l, aseReserve, tokenReserve) {
  const r = BigInt(tokenReserve);
  if (r === 0n) return 0n;
  return (_pricingAse(l, aseReserve) * BigInt(l.tokenUnitWei)) / r;
}
function _spot(l, aseReserve, tokenReserve) {
  return _spotRaw(l, aseReserve, tokenReserve);
}
function _surplusAse() {
  const held = _big(storage.get(HELD_KEY));
  const reserve = _big(storage.get(RESERVE_TOTAL_KEY));
  const out = held - reserve;
  return out > 0n ? out : 0n;
}

function _marketCap(l, spotPriceWei) {
  const unit = BigInt(l.tokenUnitWei);
  return unit === 0n ? 0n : (BigInt(spotPriceWei) * BigInt(l.totalSupply)) / unit;
}
function _impactBps(beforePrice, afterPrice) {
  const a = BigInt(beforePrice);
  const b = BigInt(afterPrice);
  if (a === 0n) return '0';
  const diff = b > a ? b - a : a - b;
  return ((diff * BPS) / a).toString();
}
function _quoteBuy(l, userSentIn) {
  const userSent = BigInt(userSentIn);
  const oldSpot = _spot(l, l.aseReserve, l.tokenReserve);
  const target = BigInt(l.targetWei);
  const current = BigInt(l.aseReserve);
  const out = {
    feasible: false,
    reason: '',
    token: l.token,
    userSentWei: userSent.toString(),
    grossAseWei: '0',
    protocolFeeWei: '0',
    netAseWei: '0',
    currentSpotPriceWei: oldSpot.toString(),
    tokensOut: '0',
    executionPriceWei: '0',
    newSpotPriceWei: '0',
    priceImpactBps: '0',
    newAseReserveWei: l.aseReserve,
    newTokenReserveWei: l.tokenReserve,
    bondingProgressBpsAfter: '0',
    willReachBondingTarget: false
  };
  if (l.status !== 'BONDING' || storage.get(PAUSED_KEY) === '1') { out.reason = 'not bonding'; return out; }
  if (userSent <= 0n) { out.reason = 'amount too small'; return out; }

  // `targetWei` is a threshold, not a cap. The full buyer input is accepted;
  // overshoot above the target remains in the curve and becomes AseDex LP.
  if (current >= target) { out.reason = 'bonding target reached'; return out; }
  const gross = userSent;
  const fee = (gross * BigInt(l.feeBps)) / BPS;
  const net = gross - fee;
  if (net <= 0n) { out.reason = 'amount too small'; return out; }
  out.grossAseWei = gross.toString();
  out.protocolFeeWei = fee.toString();
  out.netAseWei = net.toString();

  const pricingX = _pricingAse(l, current);
  const y = BigInt(l.tokenReserve);
  if (pricingX <= 0n || y <= 0n) { out.reason = 'curve not initialized'; return out; }
  // tokensOut = y*dx/(x+dx), where x is real ASE plus the virtual cap base.
  const tokensOut = (y * net) / (pricingX + net);
  if (tokensOut <= 0n) { out.reason = 'zero tokens out'; return out; }
  if (tokensOut >= y) { out.reason = 'insufficient token reserve'; return out; }
  const newAse = current + net;
  const newTokens = y - tokensOut;

  const execPrice = (net * BigInt(l.tokenUnitWei)) / tokensOut;
  const newSpot = _spotRaw(l, newAse.toString(), newTokens.toString());
  out.feasible = true;
  out.tokensOut = tokensOut.toString();
  out.executionPriceWei = execPrice.toString();
  out.newSpotPriceWei = newSpot.toString();
  out.priceImpactBps = _impactBps(oldSpot, newSpot);
  out.newAseReserveWei = newAse.toString();
  out.newTokenReserveWei = newTokens.toString();
  const progress = (newAse * BPS) / target;
  out.bondingProgressBpsAfter = (progress > BPS ? BPS : progress).toString();
  out.willReachBondingTarget = newAse >= target;
  return out;
}
function _quoteSell(l, tokensIn) {
  const amt = BigInt(tokensIn);
  const oldSpot = _spot(l, l.aseReserve, l.tokenReserve);
  const out = {
    feasible: false,
    reason: '',
    token: l.token,
    tokensIn: amt.toString(),
    currentSpotPriceWei: oldSpot.toString(),
    grossAseOutWei: '0',
    protocolFeeWei: '0',
    netAseOutWei: '0',
    executionPriceWei: '0',
    newSpotPriceWei: '0',
    priceImpactBps: '0',
    newAseReserveWei: l.aseReserve,
    newTokenReserveWei: l.tokenReserve
  };
  if (l.status !== 'BONDING' || storage.get(PAUSED_KEY) === '1') { out.reason = 'not bonding'; return out; }
  if (!l.initialized) { out.reason = 'curve not initialized'; return out; }
  if (amt <= 0n) { out.reason = 'amount must be positive'; return out; }
  const realX = BigInt(l.aseReserve);
  const x = _pricingAse(l, realX);
  const y = BigInt(l.tokenReserve);
  if (x <= 0n || y <= 0n) { out.reason = 'empty curve'; return out; }
  // grossOut = x*dy/(y+dy), capped by the real ASE reserve.
  const gross = (x * amt) / (y + amt);
  if (gross <= 0n) { out.reason = 'zero ASE out'; return out; }
  if (gross > realX) { out.reason = 'insufficient real ASE reserve'; return out; }
  const fee = (gross * BigInt(l.feeBps)) / BPS;
  const net = gross - fee;
  if (net <= 0n) { out.reason = 'zero net ASE out'; return out; }
  const newAse = realX - gross;
  const newTokens = y + amt;
  const execPrice = (gross * BigInt(l.tokenUnitWei)) / amt;
  const newSpot = _spotRaw(l, newAse.toString(), newTokens.toString());
  out.feasible = true;
  out.grossAseOutWei = gross.toString();
  out.protocolFeeWei = fee.toString();
  out.netAseOutWei = net.toString();
  out.executionPriceWei = execPrice.toString();
  out.newSpotPriceWei = newSpot.toString();
  out.priceImpactBps = _impactBps(oldSpot, newSpot);
  out.newAseReserveWei = newAse.toString();
  out.newTokenReserveWei = newTokens.toString();
  return out;
}
function _finishBuy(l, buyer, quote, initial) {
  const gross = BigInt(quote.grossAseWei);
  const fee = BigInt(quote.protocolFeeWei);
  const net = BigInt(quote.netAseWei);
  const tokensOut = BigInt(quote.tokensOut);
  l.initialized = true;
  l.aseReserve = quote.newAseReserveWei;
  l.tokenReserve = quote.newTokenReserveWei;
  _setTokenBalance(l.token, l.tokenReserve);
  l.k = (_pricingAse(l, l.aseReserve) * BigInt(l.tokenReserve)).toString();
  l.lastPriceWei = quote.executionPriceWei;
  l.spotPriceWei = quote.newSpotPriceWei;
  l.marketCapWei = _marketCap(l, quote.newSpotPriceWei).toString();
  l.buyVolumeWei = (BigInt(l.buyVolumeWei) + gross).toString();
  l.volumeWei = (BigInt(l.volumeWei) + gross).toString();
  _add(BUY_VOLUME_TOTAL_KEY, gross);
  l.buyCount = (BigInt(l.buyCount) + 1n).toString();
  l.tradeCount = (BigInt(l.tradeCount) + 1n).toString();
  _recordTrade(l, {
    kind: initial ? 'INITIAL_BUY' : 'BUY', traderAddress: buyer, aseWei: gross.toString(),
    tokenAmount: tokensOut.toString(), feeWei: fee.toString(), reserveWeiAfter: l.aseReserve,
    priceWei: quote.executionPriceWei, createdTs: String(chain.blockTimestamp || '0')
  });
  if (initial) {
    l.initialBuyWei = gross.toString();
    l.initialBuyTokens = tokensOut.toString();
  }
  _add(RESERVE_TOTAL_KEY, net);
  if (BigInt(l.aseReserve) >= BigInt(l.targetWei)) {
    l.status = 'BONDED';
    _add(BONDED_COUNT_KEY, 1n);
    l.bondedTs = String(chain.blockTimestamp || '0');
    l.finalAseReserve = l.aseReserve;
    l.finalTokenReserve = l.tokenReserve;
    l.finalPriceWei = quote.newSpotPriceWei;
    l.finalMarketCapWei = l.marketCapWei;
    const creatorAmt = BigInt(l.creatorRewardWei);
    assert(creatorAmt >= 0n && creatorAmt <= BigInt(l.targetWei), 'invalid creator reward');
    l.migrationCreatorWei = creatorAmt.toString();
    l.migrationAseWei = (BigInt(l.finalAseReserve) - creatorAmt).toString();
    l.migrationTokenWei = l.finalTokenReserve;
    emit('BondingCompleted', {
      token: l.token,
      creator: l.creator,
      finalAseReserve: l.finalAseReserve,
      finalTokenReserve: l.finalTokenReserve,
      creatorReward: l.migrationCreatorWei,
      liquidityAse: l.migrationAseWei,
      liquidityToken: l.migrationTokenWei,
      finalPrice: l.finalPriceWei,
      finalMarketCap: l.finalMarketCapWei
    });
  }
  emit('Buy', {
    token: l.token,
    buyer,
    grossAse: gross.toString(),
    feeAse: fee.toString(),
    netAse: net.toString(),
    tokensOut: tokensOut.toString(),
    executionPrice: quote.executionPriceWei,
    postTradePrice: quote.newSpotPriceWei,
    aseReserve: l.aseReserve,
    tokenReserve: l.tokenReserve,
    marketCap: l.marketCapWei
  });
  emit('Trade', {
    token: l.token,
    trader: buyer,
    isBuy: true,
    kind: initial ? 'INITIAL_BUY' : 'BUY',
    grossAseAmount: gross.toString(),
    userSentWei: quote.userSentWei || gross.toString(),
    protocolFee: fee.toString(),
    netAseAmount: net.toString(),
    tokenAmount: tokensOut.toString(),
    executionPrice: quote.executionPriceWei,
    spotPriceAfter: quote.newSpotPriceWei,
    aseReserveAfter: l.aseReserve,
    tokenReserveAfter: l.tokenReserve,
    marketCapAfter: l.marketCapWei,
    blockTimestamp: String(chain.blockTimestamp || '0')
  });
  return { tokensOut, fee };
}
function _applySell(l, seller, quote, amount) {
  const net = BigInt(quote.netAseOutWei);
  const fee = BigInt(quote.protocolFeeWei);
  const gross = BigInt(quote.grossAseOutWei);
  assert(gross <= BigInt(l.aseReserve), 'insufficient curve ASE');
  l.aseReserve = quote.newAseReserveWei;
  l.tokenReserve = quote.newTokenReserveWei;
  _setTokenBalance(l.token, l.tokenReserve);
  l.k = (_pricingAse(l, l.aseReserve) * BigInt(l.tokenReserve)).toString();
  l.lastPriceWei = quote.executionPriceWei;
  l.spotPriceWei = quote.newSpotPriceWei;
  l.marketCapWei = _marketCap(l, quote.newSpotPriceWei).toString();
  l.sellVolumeWei = (BigInt(l.sellVolumeWei) + gross).toString();
  l.volumeWei = (BigInt(l.volumeWei) + gross).toString();
  _add(SELL_VOLUME_TOTAL_KEY, gross);
  l.sellCount = (BigInt(l.sellCount) + 1n).toString();
  l.tradeCount = (BigInt(l.tradeCount) + 1n).toString();
  _recordTrade(l, {
    kind: 'SELL', traderAddress: seller, aseWei: gross.toString(), tokenAmount: String(amount),
    feeWei: fee.toString(), reserveWeiAfter: l.aseReserve, priceWei: quote.executionPriceWei,
    createdTs: String(chain.blockTimestamp || '0')
  });
  _sub(RESERVE_TOTAL_KEY, gross);
  _saveLaunch(l);
  emit('SellSettled', {
    token: l.token,
    seller,
    tokenAmount: String(amount),
    grossAseOut: gross.toString(),
    feeAse: fee.toString(),
    netAseOut: net.toString(),
    executionPrice: quote.executionPriceWei,
    postTradePrice: quote.newSpotPriceWei,
    aseReserve: l.aseReserve,
    tokenReserve: l.tokenReserve,
    marketCap: l.marketCapWei
  });
  emit('Trade', {
    token: l.token,
    trader: seller,
    isBuy: false,
    kind: 'SELL',
    grossAseAmount: gross.toString(),
    protocolFee: fee.toString(),
    netAseAmount: net.toString(),
    tokenAmount: String(amount),
    executionPrice: quote.executionPriceWei,
    spotPriceAfter: quote.newSpotPriceWei,
    aseReserveAfter: l.aseReserve,
    tokenReserveAfter: l.tokenReserve,
    marketCapAfter: l.marketCapWei,
    blockTimestamp: String(chain.blockTimestamp || '0')
  });
  return { net, fee };
}
function _poolJson(amm, poolId) {
  const raw = E(amm).getPool(String(poolId));
  return raw ? JSON.parse(String(raw)) : null;
}
function _migrationAmountsForPool(l, pool) {
  const ase = BigInt(l.migrationAseWei || '0');
  const tokens = BigInt(l.migrationTokenWei || '0');
  if (pool.token0 === NATIVE && pool.token1 === l.token) return { amount0: ase, amount1: tokens };
  if (pool.token1 === NATIVE && pool.token0 === l.token) return { amount0: tokens, amount1: ase };
  assert(false, 'pool/token mismatch');
}
function _assertMigrationPool(l, pool) {
  _migrationAmountsForPool(l, pool);
  assert(pool.feeBps === '30', 'AseDex pool fee mismatch');
}
function _advanceMigration(l) {
  const amm = _norm(l.aseDex || storage.get(ASEDEX_KEY));
  assert(_isAddr(amm) && amm !== ZERO, 'AseDex missing');
  const self = _norm(msg.contractAddress);
  const lpAse = BigInt(l.migrationAseWei || '0');
  const lpTokens = BigInt(l.migrationTokenWei || '0');

  if (l.migrationStage === 'POOL') {
    let pid = String(E(amm).poolForPair(NATIVE, l.token) || '');
    if (pid === 'null') pid = '';
    if (!pid) {
      if (l.migrationPoolRequested === true) return false;
      l.migrationPoolRequested = true;
      _saveLaunch(l);
      E(amm).createPool(NATIVE, l.token, '30');
      emit('MigrationPoolRequested', { token: l.token, aseDex: amm });
      return false;
    }
    assert(l.migrationPoolRequested === true, 'unexpected pre-existing AseDex pool');
    const pool = _poolJson(amm, pid);
    assert(pool, 'pool not found');
    _assertMigrationPool(l, pool);
    assert(BigInt(pool.reserve0 || '0') === 0n && BigInt(pool.reserve1 || '0') === 0n && BigInt(pool.totalShares || '0') === 0n, 'existing AseDex pool has liquidity');
    l.aseDexPoolId = pid;
    l.migrationPoolReserve0Before = pool.reserve0;
    l.migrationPoolReserve1Before = pool.reserve1;
    l.migrationTotalSharesBefore = pool.totalShares;
    l.migrationLpSharesBefore = String(E(amm).sharesOf(pid, self) || '0');
    l.migrationZeroSharesBefore = String(E(amm).sharesOf(pid, ZERO) || '0');
    l.migrationPoolRequested = false;
    l.migrationStage = 'LIQUIDITY';
    _saveLaunch(l);
    emit('MigrationPoolReady', { token: l.token, aseDexPoolId: pid });
    return true;
  }

  const pid = String(l.aseDexPoolId || '');
  assert(pid, 'pool missing');
  const poolBefore = _poolJson(amm, pid);
  assert(poolBefore, 'pool not found');
  _assertMigrationPool(l, poolBefore);

  if (l.migrationStage === 'APPROVAL') {
    const ammAllowance = BigInt(E(l.token).allowance(self, amm) || '0');
    const selfAllowance = BigInt(E(l.token).allowance(self, self) || '0');
    if (ammAllowance < lpTokens || selfAllowance < lpTokens) {
      if (ammAllowance < lpTokens) E(l.token).approve(amm, lpTokens.toString());
      if (selfAllowance < lpTokens) E(l.token).approve(self, lpTokens.toString());
      emit('MigrationApprovalRequested', { token: l.token, spender: amm, amount: lpTokens.toString() });
      return false;
    }
    l.migrationStage = 'LIQUIDITY';
    _saveLaunch(l);
    emit('MigrationApproved', { token: l.token, spender: amm, amount: lpTokens.toString() });
    return true;
  }

  if (l.migrationStage === 'LIQUIDITY') {
    const { amount0, amount1 } = _migrationAmountsForPool(l, poolBefore);
    const selfShares = BigInt(E(amm).sharesOf(pid, self) || '0');
    const sharesBefore = BigInt(l.migrationLpSharesBefore || '0');
    const reserve0Delta = BigInt(poolBefore.reserve0) - BigInt(l.migrationPoolReserve0Before || '0');
    const reserve1Delta = BigInt(poolBefore.reserve1) - BigInt(l.migrationPoolReserve1Before || '0');
    const shareDelta = selfShares - sharesBefore;
    const totalShareDelta = BigInt(poolBefore.totalShares) - BigInt(l.migrationTotalSharesBefore || '0');
    if (l.migrationLiquiditySubmitted === true && reserve0Delta === amount0 && reserve1Delta === amount1 && shareDelta > 0n && shareDelta === totalShareDelta) {
      l.lpSharesMinted = shareDelta.toString();
      l.migrationStage = 'LP_BURN';
      // The E-call value left the contract; reconcile the protected ledger only
      // after the pool's observable reserves and pad LP shares prove it landed.
      _sub(RESERVE_TOTAL_KEY, lpAse);
      _sub(HELD_KEY, lpAse);
      _setTokenBalance(l.token, 0n);
      _saveLaunch(l);
      emit('LiquidityAdded', { token: l.token, aseDexPoolId: pid, liquidityAseWei: lpAse.toString(), liquidityTokenWei: lpTokens.toString(), lpShares: l.lpSharesMinted });
      return true;
    }
    assert(l.migrationLiquiditySubmitted !== true, 'liquidity already submitted');
    assert(reserve0Delta === 0n && reserve1Delta === 0n && shareDelta === 0n && totalShareDelta === 0n, 'pool changed before liquidity');
    const tokenAmount = poolBefore.token0 === NATIVE ? amount1 : amount0;
    const nativeAmount = poolBefore.token0 === NATIVE ? amount0 : amount1;
    assert(tokenAmount === lpTokens && nativeAmount === lpAse, 'migration amount mismatch');
    l.migrationLiquiditySubmitted = true;
    _saveLaunch(l);
    // Native ASE cannot ride as msg.value inside an E() call. AsePad prefunds
    // the AseDex pool directly in this same atomic transaction, then
    // seedLiquidity credits the already-arrived reserves and mints pad LP.
    assert(E(l.token).transfer(amm, tokenAmount.toString()) === true, 'migration token transfer failed');
    transfer(amm, nativeAmount.toString());
    assert(BigInt(E(amm).seedLiquidity(pid, amount0.toString(), amount1.toString()) || '0') > 0n, 'liquidity seed failed');
    emit('MigrationLiquidityRequested', { token: l.token, aseDexPoolId: pid, amount0: amount0.toString(), amount1: amount1.toString() });
    return false;
  }

  if (l.migrationStage === 'LP_BURN') {
    const selfShares = BigInt(E(amm).sharesOf(pid, self) || '0');
    const sharesBefore = BigInt(l.migrationLpSharesBefore || '0');
    const zeroBefore = BigInt(l.migrationZeroSharesBefore || '0');
    const minted = BigInt(l.lpSharesMinted || '0');
    const burned = BigInt(E(amm).sharesOf(pid, ZERO) || '0');
    const padDelta = selfShares - sharesBefore;
    const zeroDelta = burned - zeroBefore;
    assert(minted > 0n, 'no LP shares minted');
    assert(zeroDelta === 0n || zeroDelta === minted, 'unexpected zero LP share balance');
    if (padDelta === minted && zeroDelta === 0n) {
      if (!l.migrationLpBurnSubmitted) {
        l.migrationLpBurnSubmitted = true;
        _saveLaunch(l);
        E(amm).transferShares(pid, ZERO, minted.toString());
        emit('MigrationLPBurnRequested', { token: l.token, aseDexPoolId: pid, lpShares: minted.toString() });
      }
      return false;
    }
    assert(selfShares === sharesBefore, 'AsePad LP shares not fully burned');
    assert(zeroDelta === minted, 'LP burn amount mismatch');
    const migratedPool = _poolJson(amm, pid);
    const aseReserve = BigInt(migratedPool.token0 === NATIVE ? migratedPool.reserve0 : migratedPool.reserve1);
    const tokenReserve = BigInt(migratedPool.token0 === NATIVE ? migratedPool.reserve1 : migratedPool.reserve0);
    assert(aseReserve > 0n && tokenReserve > 0n, 'empty migrated pool');
    l.finalPriceWei = ((aseReserve * BigInt(l.tokenUnitWei)) / tokenReserve).toString();
    l.finalMarketCapWei = _marketCap(l, BigInt(l.finalPriceWei)).toString();
    l.status = 'MIGRATED';
    l.migrationStage = 'MIGRATED';
    _add(MIGRATED_COUNT_KEY, 1n);
    l.lpSharesBurned = minted.toString();
    l.migratedTs = String(chain.blockTimestamp || '0');
    _saveLaunch(l);
    assert(BigInt(storage.get(RESERVE_TOTAL_KEY) || '0') >= 0n, 'reserve accounting underflow');
    E(l.token).unlockAseDex();
    emit('LPShareBurned', { token: l.token, aseDexPoolId: pid, lpShares: minted.toString(), burnAddress: ZERO });
    emit('MigrationAccountingFinalized', {
      token: l.token,
      creatorRewardWei: l.creatorRewardWei,
      liquidityAseWei: l.migrationAseWei,
      heldWei: storage.get(HELD_KEY) || '0',
      reserveTotalWei: storage.get(RESERVE_TOTAL_KEY) || '0'
    });
    emit('MigrationCompleted', { token: l.token, aseDexPoolId: pid, lpSharesBurned: minted.toString() });
    return true;
  }

  return false;
}
// E() calls execute inline, so each pass of _advanceMigration either submits a
// step or observes it — looping drives a launch from MIGRATING to MIGRATED
// inside a single transaction. The bound only guards against pathological
// states; exiting early leaves the usual retryable MIGRATING record.
function _driveMigration(l) {
  let guard = 0;
  while (l.status === 'MIGRATING' && guard++ < 16) _advanceMigration(l);
}
// Full migration entry: validates the bonded launch, pays the creator reward,
// then runs every stage until the AseDex pool is live with burned LP.
function _migrateLaunch(t) {
  const l = _loadLaunch(t);
  assert(l.status === 'BONDED', 'not bonded');
  assert(storage.get(PAUSED_KEY) !== '1', 'paused');
  const reserve = BigInt(l.aseReserve);
  const target = BigInt(l.targetWei);
  assert(reserve >= target, 'target not reached');
  const creatorAmt = BigInt(l.creatorRewardWei);
  assert(creatorAmt >= 0n && creatorAmt <= target, 'invalid creator reward');
  const lpAse = reserve - creatorAmt;
  const lpTokens = BigInt(l.tokenReserve);
  const amm = _norm(l.aseDex || storage.get(ASEDEX_KEY));
  assert(_isAddr(amm) && amm !== ZERO, 'AseDex missing');
  assert(lpAse > 0n && lpTokens > 0n, 'empty liquidity');
  assert(_tokenBalance(t) === lpTokens, 'curve token balance mismatch');

  l.status = 'MIGRATING';
  l.migrationStage = 'POOL';
  l.aseReserve = '0';
  l.tokenReserve = '0';
  l.k = '0';
  l.finalAseReserve = reserve.toString();
  l.finalTokenReserve = lpTokens.toString();
  l.creatorRewardPaid = creatorAmt > 0n;
  l.migrationAseWei = lpAse.toString();
  l.migrationTokenWei = lpTokens.toString();
  l.migrationCreatorWei = creatorAmt.toString();
  l.migrationPoolRequested = false;
  l.migrationSeedSubmitted = false;
  l.migrationLiquiditySubmitted = false;
  l.migrationLpBurnSubmitted = false;
  l.lpSharesMinted = '0';
  _sub(RESERVE_TOTAL_KEY, creatorAmt);
  _saveLaunch(l);
  if (creatorAmt > 0n) _payNative(l.creator, creatorAmt);
  emit('CreatorRewardPaid', { token: t, creator: l.creator, amountWei: creatorAmt.toString() });
  emit('MigrationStarted', {
    token: t,
    aseDex: amm,
    liquidityAseWei: lpAse.toString(),
    liquidityTokenWei: lpTokens.toString(),
    creatorRewardWei: creatorAmt.toString(),
    finalAseReserve: reserve.toString()
  });
  _driveMigration(l);
  return l.migrationStage;
}
// Moves one launch to the configured successor pad, atomically: the token
// rebinds (migratePad), its curve tokens and ASE reserve transfer over, then
// the new pad records the launch. Any failure reverts the whole export.
function _exportLaunch(t) {
  const up = _norm(storage.get(UPGRADE_PAD_KEY) || '');
  assert(_isAddr(up) && up !== ZERO, 'no upgrade pad configured');
  const l = _findLaunch(t);
  assert(l, 'launch not found');
  // BONDING/BONDED carry their curve funds; MIGRATED/RECOVERED move as
  // record-only tombstones (funds already settled into the AseDex pool) so the
  // new pad keeps the complete launch history and counts.
  assert(l.status === 'BONDING' || l.status === 'BONDED' || l.status === 'MIGRATED' || l.status === 'RECOVERED', 'launch not exportable');
  const ase = BigInt(l.aseReserve || '0');
  const tokens = BigInt(l.tokenReserve || '0');
  const self = _norm(msg.contractAddress);
  assert(BigInt(E(t).balanceOf(self) || '0') >= tokens, 'curve token custody mismatch');
  const record = JSON.stringify(l);
  l.status = 'EXPORTED';
  l.aseReserve = '0';
  l.tokenReserve = '0';
  l.k = '0';
  l.exportedTo = up;
  _sub(RESERVE_TOTAL_KEY, ase);
  _sub(HELD_KEY, ase);
  _setTokenBalance(t, 0n);
  _saveLaunch(l);
  if (tokens > 0n) assert(E(t).transfer(up, tokens.toString()) === true, 'token export failed');
  if (ase > 0n) transfer(up, ase.toString());
  E(t).migratePad(up);
  E(up).importLaunch(record);
  emit('LaunchExported', { token: t, to: up, aseWei: ase.toString(), tokenWei: tokens.toString() });
}
function _configJson() {
  return {
    admin: storage.get(ADMIN_KEY) || '',
    treasury: storage.get(TREASURY_KEY) || '',
    aseDex: storage.get(ASEDEX_KEY) || '',
    testnet: storage.get(TESTNET_KEY) === '1',
    creationFeeWei: storage.get(CREATION_FEE_KEY) || '0',
    feeBps: storage.get(FEE_BPS_KEY) || '0',
    targetWei: storage.get(TARGET_KEY) || '0',
    creatorBps: storage.get(CREATOR_BPS_KEY) || '0',
    virtualAseWei: storage.get(VIRTUAL_ASE_KEY) || '0',
    aseUsdScaled: storage.get(ASE_USD_KEY) || '0',
    paused: storage.get(PAUSED_KEY) === '1',
    heldWei: storage.get(HELD_KEY) || '0',
    reserveTotalWei: storage.get(RESERVE_TOTAL_KEY) || '0'
  };
}

({
  init(admin, treasury, _unusedMigrationArg, aseDexAddress, creationFeeWei, feeBps, targetWei, creatorBps, virtualAseWei, testnet, aseUsdScaled) {
    assert(!storage.get(ADMIN_KEY), 'already initialised');
    const tr = _norm(treasury);
    const dex = _norm(aseDexAddress);
    assert(_isAddr(tr), 'treasury required');
    assert(_isAddr(dex), 'AseDex required');
    const fee = BigInt(feeBps);
    const creator = BigInt(creatorBps);
    assert(fee >= 0n && fee <= MAX_FEE_BPS, 'fee out of range');
    assert(creator >= 0n && creator <= MAX_CREATOR_BPS, 'creator reward out of range');
    assert(BigInt(targetWei) > 0n, 'target required');
    assert(BigInt(virtualAseWei) > 0n, 'virtual cap required');
    storage.set(ADMIN_KEY, _norm(admin || msg.sender));
    storage.set(TREASURY_KEY, tr);
    storage.set(ASEDEX_KEY, dex);
    storage.set(TESTNET_KEY, testnet === true || String(testnet) === 'true' || String(testnet) === '1' ? '1' : '0');
    storage.set(CREATION_FEE_KEY, BigInt(creationFeeWei).toString());
    storage.set(FEE_BPS_KEY, fee.toString());
    storage.set(TARGET_KEY, BigInt(targetWei).toString());
    storage.set(CREATOR_BPS_KEY, creator.toString());
    storage.set(VIRTUAL_ASE_KEY, BigInt(virtualAseWei).toString());
    storage.set(PAUSED_KEY, '0');
    storage.set(COUNT_KEY, '0');
    storage.set(HELD_KEY, '0');
    storage.set(RESERVE_TOTAL_KEY, '0');
    storage.set(BUY_VOLUME_TOTAL_KEY, '0');
    storage.set(SELL_VOLUME_TOTAL_KEY, '0');
    storage.set(BONDED_COUNT_KEY, '0');
    storage.set(MIGRATED_COUNT_KEY, '0');
    storage.set(ASE_USD_KEY, BigInt(aseUsdScaled || '0').toString());
    return true;
  },

  // ── admin/config ──────────────────────────────────────────────────────
  platform() { return 'AsePad'; },
  links() { return JSON.stringify(ASEPAD_LINKS); },
  deploymentBrand() { return JSON.stringify({ platform: 'AsePad', module: 'Launchpad', ...ASEPAD_LINKS, aseDex: storage.get(ASEDEX_KEY) || '' }); },
  name() { return 'AsePad Launchpad'; },
  contractName() { return 'AsePad Launchpad'; },
  version() { return '2'; },
  admin() { return storage.get(ADMIN_KEY) || ''; },
  treasury() { return storage.get(TREASURY_KEY) || ''; },
  aseDex() { return storage.get(ASEDEX_KEY) || ''; },
  paused() { return storage.get(PAUSED_KEY) === '1'; },
  virtualAseWei() { return storage.get(VIRTUAL_ASE_KEY) || '0'; },
  aseUsdScaled() { return storage.get(ASE_USD_KEY) || '0'; },
  // Owner updates the ASE/USD display rate (fixed-point 6 decimals). A keeper
  // or oracle script can call this with a live price at any time.
  setAseUsdScaled(v) {
    _admin();
    const scaled = BigInt(v);
    assert(scaled >= 0n && scaled <= 1000000n * 10n ** 6n, 'ASE/USD rate out of range');
    storage.set(ASE_USD_KEY, scaled.toString());
    emit('AseUsdUpdated', { aseUsdScaled: scaled.toString() });
    return true;
  },
  config() { return JSON.stringify(_configJson()); },
  setTreasury(a) {
    _admin();
    const tr = _norm(a);
    assert(_isAddr(tr) && tr !== ZERO, 'invalid treasury');
    storage.set(TREASURY_KEY, tr);
    emit('TreasuryUpdated', { treasury: tr });
    return true;
  },
  // Repointable at any time: each launch snapshots aseDex at creation, so
  // existing launches always migrate to their original DEX while new launches
  // pick up the current pointer.
  setAseDex(a) {
    _admin();
    const dex = _norm(a);
    assert(_isAddr(dex) && dex !== ZERO, 'invalid AseDex');
    storage.set(ASEDEX_KEY, dex);
    emit('AseDexUpdated', { aseDex: dex });
    return true;
  },
  setCreationFee(w) { _admin(); assert(BigInt(w) >= 0n, 'invalid fee'); storage.set(CREATION_FEE_KEY, BigInt(w).toString()); emit('CreationFeeUpdated', { creationFeeWei: BigInt(w).toString() }); return true; },
  setFeeBps(b) { _admin(); const v = BigInt(b); assert(v >= 0n && v <= MAX_FEE_BPS, 'fee out of range'); storage.set(FEE_BPS_KEY, v.toString()); emit('TradeFeeUpdated', { feeBps: v.toString() }); return true; },
  setTradeFeeBps(b) { _admin(); const v = BigInt(b); assert(v >= 0n && v <= MAX_FEE_BPS, 'fee out of range'); storage.set(FEE_BPS_KEY, v.toString()); emit('TradeFeeUpdated', { feeBps: v.toString() }); return true; },
  setTarget(w) { _admin(); const v = BigInt(w); assert(v > 0n, 'target required'); storage.set(TARGET_KEY, v.toString()); emit('BondingTargetUpdated', { targetWei: v.toString() }); return true; },
  setBondingTarget(w) { _admin(); const v = BigInt(w); assert(v > 0n, 'target required'); storage.set(TARGET_KEY, v.toString()); emit('BondingTargetUpdated', { targetWei: v.toString() }); return true; },
  setCreatorBps(b) { _admin(); const v = BigInt(b); assert(v >= 0n && v <= MAX_CREATOR_BPS, 'creator reward out of range'); storage.set(CREATOR_BPS_KEY, v.toString()); emit('CreatorRewardUpdated', { creatorBps: v.toString() }); return true; },
  setCreatorRewardBps(b) { _admin(); const v = BigInt(b); assert(v >= 0n && v <= MAX_CREATOR_BPS, 'creator reward out of range'); storage.set(CREATOR_BPS_KEY, v.toString()); emit('CreatorRewardUpdated', { creatorBps: v.toString() }); return true; },
  setVirtualAseWei(w) {
    _admin();
    assert(BigInt(storage.get(COUNT_KEY) || '0') === 0n, 'virtual cap locked after first launch');
    const v = BigInt(w);
    assert(v > 0n, 'virtual cap required');
    storage.set(VIRTUAL_ASE_KEY, v.toString());
    emit('VirtualCapUpdated', { virtualAseWei: v.toString() });
    return true;
  },
  pause() { _admin(); storage.set(PAUSED_KEY, '1'); emit('Paused', { by: _norm(msg.sender) }); return true; },
  unpause() { _admin(); storage.set(PAUSED_KEY, '0'); emit('Unpaused', { by: _norm(msg.sender) }); return true; },

  // ── pad-to-pad upgrade ────────────────────────────────────────────────
  // If the bonding-curve contract is ever replaced, the admin points this pad
  // at the successor and exports each live launch with its full curve state:
  // the token rebinds to the new pad, its curve tokens and ASE reserve move
  // over, and the new pad records the launch — all atomically in one call, so
  // a failure anywhere leaves the launch untouched on this pad.
  setUpgradePad(a) {
    _admin();
    const up = _norm(a);
    assert(_isAddr(up) && up !== ZERO, 'invalid upgrade pad');
    storage.set(UPGRADE_PAD_KEY, up);
    emit('UpgradePadSet', { pad: up });
    return true;
  },
  // Which predecessor pad may push launches into this contract.
  setLegacyPad(a) {
    _admin();
    const lp = _norm(a);
    assert(_isAddr(lp) && lp !== ZERO, 'invalid legacy pad');
    storage.set(LEGACY_PAD_KEY, lp);
    emit('LegacyPadSet', { pad: lp });
    return true;
  },
  upgradePad() { return storage.get(UPGRADE_PAD_KEY) || ''; },
  legacyPad() { return storage.get(LEGACY_PAD_KEY) || ''; },

  exportLaunch(token) {
    _admin();
    _exportLaunch(_norm(token));
    return true;
  },

  // Batch-export every BONDING/BONDED launch to the configured upgrade pad.
  exportLaunches(max) {
    _admin();
    const limit = BigInt(max || '0');
    assert(limit > 0n && limit <= 256n, 'invalid limit');
    const count = BigInt(storage.get(COUNT_KEY) || '0');
    let exported = 0n;
    for (let i = 0n; i < count && exported < limit; i++) {
      const t = _norm(storage.get(LAUNCH_INDEX_PREFIX + i.toString()) || '');
      const l = t ? _findLaunch(t) : null;
      if (!l || (l.status !== 'BONDING' && l.status !== 'BONDED' && l.status !== 'MIGRATED' && l.status !== 'RECOVERED')) continue;
      _exportLaunch(t);
      exported++;
    }
    return exported.toString();
  },

  // Only the configured legacy pad may push launches in. The record is
  // accepted only if the token already re-bound itself to this pad and the
  // exported curve tokens actually arrived — both happen atomically in the
  // exporting call.
  importLaunch(recordJson) {
    assert(_norm(msg.sender) === _norm(storage.get(LEGACY_PAD_KEY) || ZERO), 'not legacy pad');
    const l = JSON.parse(String(recordJson));
    const t = _norm(l.token);
    assert(_isAddr(t), 'invalid token');
    assert(!storage.get(_launchKey(t)), 'already launched');
    assert(l.status === 'BONDING' || l.status === 'BONDED' || l.status === 'MIGRATED' || l.status === 'RECOVERED', 'bad import status');
    const self = _norm(msg.contractAddress);
    assert(_norm(E(t).pad() || '') === self, 'token not bound to this pad');
    const ase = BigInt(l.aseReserve || '0');
    const tokens = BigInt(l.tokenReserve || '0');
    assert(BigInt(E(t).balanceOf(self) || '0') >= tokens, 'imported tokens missing');
    l.aseDex = _norm(E(t).aseDex() || '');
    l.importedFrom = _norm(msg.sender);
    _saveLaunch(l);
    const count = BigInt(storage.get(COUNT_KEY) || '0') + 1n;
    storage.set(COUNT_KEY, count.toString());
    storage.set(LAUNCH_INDEX_PREFIX + (count - 1n).toString(), t);
    _add(HELD_KEY, ase);
    _add(RESERVE_TOTAL_KEY, ase);
    _setTokenBalance(t, tokens);
    // Mirror the old pad's launch stats so counts continue seamlessly.
    if (l.status === 'MIGRATED') { _add(BONDED_COUNT_KEY, 1n); _add(MIGRATED_COUNT_KEY, 1n); }
    else if (l.status !== 'BONDING') _add(BONDED_COUNT_KEY, 1n);
    emit('LaunchImported', { token: t, from: _norm(msg.sender), aseWei: ase.toString(), tokenWei: tokens.toString(), status: l.status });
    return true;
  },

  transferAdmin(newAdmin) {
    _admin();
    const a = _norm(newAdmin);
    assert(_isAddr(a) && a !== ZERO, 'invalid admin');
    storage.set(ADMIN_KEY, a);
    emit('AdminUpdated', { admin: a });
    return true;
  },

  // ── launch ────────────────────────────────────────────────────────────
  // msg.value = creationFee + optional creator initial buy.
  // One-signature launch: the token's baked genesis credits its full supply to
  // this pad, so no init / approve / deposit transactions precede this call.
  createLaunch(token, name, symbol, totalSupply, curveSupply, initialPriceWei, metaJson) {
    assert(storage.get(PAUSED_KEY) !== '1', 'paused');
    const t = _norm(token);
    assert(_isAddr(t), 'invalid token');
    assert(!storage.get(_launchKey(t)), 'already launched');
    const creator = _norm(msg.sender);
    assert(_isAddr(creator), 'invalid creator');
    const supply = BigInt(totalSupply);
    const curve = BigInt(curveSupply);
    assert(BigInt(initialPriceWei || '0') === 0n, 'initial price is derived from the virtual cap');
    assert(String(name || '').length > 0 && String(name).length <= 80, 'invalid name');
    assert(String(symbol || '').length > 0 && String(symbol).length <= 20, 'invalid symbol');
    assert(supply > 0n, 'supply must be positive');
    assert(curve > 0n && curve <= supply, 'invalid curve supply');

    const self = _norm(msg.contractAddress);
    assert(_norm(E(t).pad()) === self, 'token not bound to AsePad');
    assert(_norm(E(t).creator()) === creator, 'only the token creator can launch it');
    assert(_tokenBalance(t) === 0n, 'AsePad already holds this token');
    assert(String(E(t).name()) === String(name), 'name differs from token');
    assert(String(E(t).symbol()) === String(symbol), 'symbol differs from token');
    const amm = _norm(storage.get(ASEDEX_KEY) || '');
    assert(_isAddr(amm) && amm !== ZERO, 'AseDex missing');
    // First write on the token: materialises genesis (full supply → pad) and
    // binds the migration DEX this launch will use forever.
    E(t).configureAseDex(amm);
    const padBalance = BigInt(E(t).balanceOf(self) || '0');
    const actualSupply = BigInt(E(t).totalSupply() || '0');
    assert(actualSupply === supply, 'total supply mismatch');
    assert(padBalance === supply, 'token genesis must credit the full supply to AsePad');
    // Behavioral probe: a look-alike contract can spoof pad()/creator()/
    // balanceOf() but cannot fake real balance movement. Pad sends the creator
    // 1 wei and pulls it straight back — both directions must actually move.
    const creatorBefore = BigInt(E(t).balanceOf(creator) || '0');
    assert(E(t).transfer(creator, '1') === true, 'not an AsePad token');
    assert(BigInt(E(t).balanceOf(creator) || '0') === creatorBefore + 1n, 'not an AsePad token');
    assert(E(t).transferFrom(creator, self, '1') === true, 'not an AsePad token');
    assert(BigInt(E(t).balanceOf(creator) || '0') === creatorBefore, 'not an AsePad token');
    assert(BigInt(E(t).balanceOf(self) || '0') === supply, 'not an AsePad token');
    _setTokenBalance(t, curve);
    let decimals = 18n;
    try { decimals = BigInt(E(t).decimals() || '18'); } catch { decimals = 18n; }
    assert(decimals >= 0n && decimals <= 38n, 'decimals out of range');
    const tokenUnit = _pow10(decimals);
    const virtualCap = BigInt(storage.get(VIRTUAL_ASE_KEY) || '0');
    const virtualAse = (virtualCap * curve) / supply;
    const price = (virtualAse * tokenUnit) / curve;
    assert(virtualAse > 0n && price > 0n, 'virtual cap produces zero price');

    const v = BigInt(msg.value || '0');
    const creationFee = BigInt(storage.get(CREATION_FEE_KEY) || '0');
    assert(v >= creationFee, 'creation fee required');
    const initialBuy = v - creationFee;
    _add(HELD_KEY, v);

    const l = {
      token: t,
      name: String(name),
      symbol: String(symbol),
      decimals: decimals.toString(),
      meta: String(metaJson || ''),
      creator,
      totalSupply: supply.toString(),
      curveSupply: curve.toString(),
      tokenUnitWei: tokenUnit.toString(),
      virtualAseWei: virtualAse.toString(),
      initialPriceWei: price.toString(),
      aseReserve: '0',
      tokenReserve: curve.toString(),
      k: (virtualAse * curve).toString(),
      initialized: false,
      lastPriceWei: price.toString(),
      spotPriceWei: price.toString(),
      marketCapWei: ((price * supply) / tokenUnit).toString(),
      status: 'BONDING',
      createdTs: String(chain.blockTimestamp || '0'),
      feeBps: storage.get(FEE_BPS_KEY) || '0',
      targetWei: storage.get(TARGET_KEY) || '0',
      creatorBps: storage.get(CREATOR_BPS_KEY) || '0',
      creatorRewardWei: ((BigInt(storage.get(TARGET_KEY) || '0') * BigInt(storage.get(CREATOR_BPS_KEY) || '0')) / BPS).toString(),
      creationFeeWei: creationFee.toString(),
      treasury: storage.get(TREASURY_KEY),
      aseDex: storage.get(ASEDEX_KEY),
      buyVolumeWei: '0',
      sellVolumeWei: '0',
      volumeWei: '0',
      buyCount: '0',
      sellCount: '0',
      tradeCount: '0',
      initialBuyWei: '0',
      initialBuyTokens: '0',
      creatorRewardPaid: false,
      migrationStage: 'NONE',
      migrationAseWei: '0',
      migrationTokenWei: '0',
      migrationCreatorWei: '0',
      migrationPoolRequested: false,
      migrationSeedSubmitted: false,
      migrationLiquiditySubmitted: false,
      migrationLpBurnSubmitted: false,
      migrationPoolReserve0Before: '0',
      migrationPoolReserve1Before: '0',
      migrationTotalSharesBefore: '0',
      migrationLpSharesBefore: '0',
      migrationZeroSharesBefore: '0',
      lpSharesMinted: '0',
      aseDexPoolId: '',
      lpSharesBurned: '0',
      finalAseReserve: '0',
      finalTokenReserve: '0',
      finalPriceWei: '0',
      finalMarketCapWei: '0'
    };

    let initialFee = 0n;
    let initialOut = 0n;
    let initialUsed = 0n;
    if (initialBuy > 0n) {
      const q = _quoteBuy(l, initialBuy);
      assert(q.feasible, q.reason || 'initial buy invalid');
      const r = _finishBuy(l, creator, q, true);
      initialFee = r.fee;
      initialOut = r.tokensOut;
      initialUsed = BigInt(q.grossAseWei);
    }
    _saveLaunch(l);
    const count = BigInt(storage.get(COUNT_KEY) || '0') + 1n;
    storage.set(COUNT_KEY, count.toString());
    storage.set(LAUNCH_INDEX_PREFIX + (count - 1n).toString(), t);
    emit('LaunchCreated', {
      token: t,
      creator,
      name: l.name,
      symbol: l.symbol,
      totalSupply: supply.toString(),
      curveSupply: curve.toString(),
      initialPriceWei: price.toString(),
      virtualAseWei: l.virtualAseWei,
      treasury: l.treasury,
      targetWei: l.targetWei
    });
    // AseDex liquidity is credited after AsePad directly transfers both
    // pool assets in one transaction, so no ERC-style pad→DEX allowance is
    // needed for official migration.
    emit('MigrationDexConfigured', { token: t, dex: l.aseDex, amount: curve.toString() });
    if (creationFee > 0n) _payNative(l.treasury, creationFee);
    if (initialFee > 0n) _payNative(l.treasury, initialFee);
    // Non-curve allocation (supply − curve) plus any initial buy go to the creator.
    const creatorTokens = (supply - curve) + initialOut;
    if (creatorTokens > 0n) E(t).transfer(creator, creatorTokens.toString());
    if (initialOut > 0n) emit('InitialBuy', { token: t, creator, aseWei: initialUsed.toString(), tokens: initialOut.toString() });
    // An initial buy that fills the whole curve migrates atomically here —
    // same one-transaction path as the bonding buy in buy().
    if (l.status === 'BONDED') _migrateLaunch(t);
    return true;
  },

  // ── trading ───────────────────────────────────────────────────────────
  buy(token, minTokensOut) {
    const t = _norm(token);
    const l = _loadLaunch(t);
    _open(l);
    const userSent = BigInt(msg.value || '0');
    assert(userSent > 0n, 'send ASE');
    const buyer = _norm(msg.sender);
    _add(HELD_KEY, userSent);
    const q = _quoteBuy(l, userSent);
    assert(q.feasible, q.reason || 'invalid buy');
    const out = BigInt(q.tokensOut);
    assert(out >= BigInt(minTokensOut || '0'), 'slippage');
    const r = _finishBuy(l, buyer, q, false);
    _saveLaunch(l);
    if (r.fee > 0n) _payNative(l.treasury, r.fee);
    E(t).transfer(buyer, out.toString());
    // The buy that fills the curve runs the whole migration in this same
    // transaction: AseDex pool creation, liquidity seed, LP burn, and the
    // creator reward. The buyer signs once and the token is live on AseDex.
    if (l.status === 'BONDED') _migrateLaunch(t);
    return JSON.stringify({ tokensOut: out.toString(), grossAseWei: q.grossAseWei });
  },

  // Sell through AsePad as a top-level transaction. Native transfers cannot be
  // performed reliably from a token-initiated nested call, so users approve the
  // pad once and this method pulls the tokens before paying ASE in the same tx.
  sell(token, amount, minAseOut) {
    const t = _norm(token);
    const l = _loadLaunch(t);
    _open(l);
    const seller = _norm(msg.sender);
    const amt = BigInt(amount);
    const self = _norm(msg.contractAddress);
    assert(_isAddr(seller), 'invalid seller');
    assert(amt > 0n, 'amount must be positive');
    const q = _quoteSell(l, amt);
    assert(q.feasible, q.reason || 'invalid sell');
    assert(BigInt(q.netAseOutWei) >= BigInt(minAseOut || '0'), 'slippage');
    const before = _tokenBalance(t);
    assert(before === BigInt(l.tokenReserve), 'curve token balance mismatch');
    emit('SellPullRequested', { token: t, seller, amount: amt.toString() });
    const pulled = E(t).transferFrom(seller, self, amt.toString());
    assert(pulled === true || pulled === 'true', 'sell token pull failed');
    emit('SellPulled', { token: t, seller, amount: amt.toString(), balanceBefore: before.toString() });
    const r = _applySell(l, seller, q, amt);
    if (r.net > 0n) _payNative(seller, r.net);
    if (r.fee > 0n) _payNative(l.treasury, r.fee);
    return JSON.stringify({ tokensIn: amt.toString(), grossAseWei: q.grossAseOutWei, netAseWei: q.netAseOutWei });
  },

  // Disabled legacy token callback retained to make accidental old-source calls
  // fail before they can mutate curve accounting without a native payout.
  settleSell() {
    assert(false, 'use AsePad sell');
    return false;
  },

  // ── migration ─────────────────────────────────────────────────────────
  // AsePad itself creates the AseDex pool, transfers both pool assets, calls
  // seedLiquidity, then transfers its LP shares to ZERO. E() calls execute
  // inline on Asentum, so the whole sequence completes inside one call — the
  // buy that fills the curve migrates in the same transaction and no extra
  // signature is ever needed. Per-stage submission flags stay idempotent so
  // advanceMigration/retryMigration remain safe recovery paths.
  migrate(token) {
    return _migrateLaunch(_norm(token));
  },

  // Permissionless migration completion. Funds and LP destination are fixed
  // by the launch record, so callers can only progress the migration.
  advanceMigration(token) {
    const t = _norm(token);
    const l = _loadLaunch(t);
    assert(l.status === 'MIGRATING', 'not migrating');
    _driveMigration(l);
    return l.migrationStage;
  },
  // Admin reconciliation after a failed E-message. This does not blindly clear
  // submission flags; it derives each flag from observable AseDex state.
  retryMigration(token) {
    _admin();
    const t = _norm(token);
    const l = _loadLaunch(t);
    assert(l.status === 'MIGRATING', 'not migrating');
    const amm = _norm(l.aseDex || storage.get(ASEDEX_KEY));

    if (l.migrationStage === 'POOL') {
      const pid = String(E(amm).poolForPair(NATIVE, l.token) || '');
      if (!pid || pid === 'null') l.migrationPoolRequested = false;
      else assert(l.migrationPoolRequested === true, 'unexpected pre-existing AseDex pool');
    }

    if (l.migrationStage === 'LIQUIDITY') {
      const pid = String(l.aseDexPoolId || '');
      const pool = _poolJson(amm, pid);
      assert(pool, 'pool not found');
      _assertMigrationPool(l, pool);
      const { amount0, amount1 } = _migrationAmountsForPool(l, pool);
      const reserve0Delta = BigInt(pool.reserve0) - BigInt(l.migrationPoolReserve0Before || '0');
      const reserve1Delta = BigInt(pool.reserve1) - BigInt(l.migrationPoolReserve1Before || '0');
      const shareDelta = BigInt(E(amm).sharesOf(pid, _norm(msg.contractAddress)) || '0') - BigInt(l.migrationLpSharesBefore || '0');
      const totalShareDelta = BigInt(pool.totalShares) - BigInt(l.migrationTotalSharesBefore || '0');
      if (reserve0Delta === amount0 && reserve1Delta === amount1 && shareDelta > 0n && shareDelta === totalShareDelta) {
        l.migrationLiquiditySubmitted = true;
      } else {
        assert(reserve0Delta === 0n && reserve1Delta === 0n && shareDelta === 0n && totalShareDelta === 0n, 'migration pool state changed');
        l.migrationLiquiditySubmitted = false;
      }
    }

    if (l.migrationStage === 'LP_BURN') {
      const pid = String(l.aseDexPoolId || '');
      const minted = BigInt(l.lpSharesMinted || '0');
      const beforePad = BigInt(l.migrationLpSharesBefore || '0');
      const beforeZero = BigInt(l.migrationZeroSharesBefore || '0');
      const padDelta = BigInt(E(amm).sharesOf(pid, _norm(msg.contractAddress)) || '0') - beforePad;
      const zeroDelta = BigInt(E(amm).sharesOf(pid, ZERO) || '0') - beforeZero;
      assert(minted > 0n, 'no LP shares minted');
      if (padDelta === 0n && zeroDelta === minted) l.migrationLpBurnSubmitted = true;
      else {
        assert(padDelta === minted && zeroDelta === 0n, 'migration LP state changed');
        l.migrationLpBurnSubmitted = false;
      }
    }

    _saveLaunch(l);
    _driveMigration(l);
    return l.migrationStage;
  },

  // ── testnet-only recovery ─────────────────────────────────────────────
  // rescueAse is limited to surplus, while rescueAllAse pauses the pad and
  // sweeps all tracked native ASE for testnet recovery. Remove these methods
  // from production source.
  surplusAseWei() { return _surplusAse().toString(); },
  rescueAse(to, amount) {
    _admin();
    assert(storage.get(TESTNET_KEY) === '1', 'testnet only');
    const amt = BigInt(amount);
    assert(amt > 0n, 'amount required');
    assert(amt <= _surplusAse(), 'protected funds');
    _payNative(_norm(to), amt);
    emit('RescueAse', { to: _norm(to), amount: amt.toString() });
    return true;
  },
  rescueAllAse(to) {
    _admin();
    assert(storage.get(TESTNET_KEY) === '1', 'testnet only');
    const recipient = _norm(to);
    assert(_isAddr(recipient), 'invalid native recipient');
    const amt = _big(storage.get(HELD_KEY));
    assert(amt > 0n, 'no ASE to rescue');
    storage.set(PAUSED_KEY, '1');
    storage.set(HELD_KEY, '0');
    storage.set(RESERVE_TOTAL_KEY, '0');
    // Mark every launch recovered before paying so an accidental unpause cannot
    // reopen a curve whose ASE backing was withdrawn.
    const count = _big(storage.get(COUNT_KEY));
    for (let i = 0n; i < count; i++) {
      const t = _norm(storage.get(LAUNCH_INDEX_PREFIX + i.toString()) || '');
      if (!_isAddr(t)) continue;
      const l = _loadLaunch(t);
      l.status = 'RECOVERED';
      l.migrationStage = 'RECOVERED';
      l.aseReserve = '0';
      l.tokenReserve = '0';
      l.k = '0';
      _setTokenBalance(t, 0n);
      _saveLaunch(l);
    }
    transfer(recipient, amt.toString());
    emit('RescueAse', { to: recipient, amount: amt.toString() });
    return true;
  },
  rescueToken(token, to, amount) {
    _admin();
    assert(storage.get(TESTNET_KEY) === '1', 'testnet only');
    const t = _norm(token);
    const l = _findLaunch(t);
    assert(!l || l.status === 'MIGRATED' || l.status === 'RECOVERED', 'active launch token protected');
    const amt = BigInt(amount);
    assert(amt > 0n, 'amount required');
    const bal = BigInt(E(t).balanceOf(_norm(msg.contractAddress)) || '0');
    const protectedBal = _tokenBalance(t);
    const surplus = bal > protectedBal ? bal - protectedBal : 0n;
    assert(amt <= surplus, 'protected token deposit');
    E(t).transfer(_norm(to), amt.toString());
    emit('RescueToken', { token: t, to: _norm(to), amount: amt.toString() });
    return true;
  },
  rescueAllToken(token, to) {
    _admin();
    assert(storage.get(TESTNET_KEY) === '1', 'testnet only');
    const t = _norm(token);
    const bal = BigInt(E(t).balanceOf(_norm(msg.contractAddress)) || '0');
    const l = _findLaunch(t);
    assert(!l || l.status === 'MIGRATED' || l.status === 'RECOVERED', 'active launch token protected');
    const protectedBal = _tokenBalance(t);
    const surplus = bal > protectedBal ? bal - protectedBal : 0n;
    if (surplus === 0n) return false;
    E(t).transfer(_norm(to), surplus.toString());
    emit('RescueToken', { token: t, to: _norm(to), amount: surplus.toString() });
    return true;
  },
  donate() {
    _add(HELD_KEY, BigInt(msg.value || '0'));
    emit('Donated', { from: _norm(msg.sender), amountWei: String(msg.value || '0') });
    return true;
  },

  // ── views ─────────────────────────────────────────────────────────────
  getLaunch(token) { return storage.get(_launchKey(_norm(token))) || 'null'; },
  getLaunchById(id) {
    const token = storage.get(LAUNCH_INDEX_PREFIX + String(id));
    return token ? (storage.get(_launchKey(token)) || 'null') : 'null';
  },
  launchAt(index) { return storage.get(LAUNCH_INDEX_PREFIX + String(index)) || ''; },
  launchCount() { return storage.get(COUNT_KEY) || '0'; },
  getLaunchCount() { return storage.get(COUNT_KEY) || '0'; },
  getLaunchStatus(token) { const l = _findLaunch(_norm(token)); return l ? l.status : 'NOT_FOUND'; },
  getCreator(token) { const l = _findLaunch(_norm(token)); return l ? l.creator : ''; },
  getCreatorReward(token) { const l = _loadLaunch(_norm(token)); return l.creatorRewardWei || '0'; },
  getTreasury() { return storage.get(TREASURY_KEY) || ''; },
  getBondingTarget() { return storage.get(TARGET_KEY) || '0'; },
  getProtocolConfig() { return JSON.stringify(_configJson()); },
  isInitialized(token) { const l = _findLaunch(_norm(token)); return l ? l.initialized === true : false; },
  isMigrated(token) { const l = _findLaunch(_norm(token)); return l ? l.status === 'MIGRATED' : false; },
  getRemainingCurveTokens(token) { const l = _findLaunch(_norm(token)); return l ? l.tokenReserve : '0'; },
  getCurveReserves(token) {
    const l = _loadLaunch(_norm(token));
    return JSON.stringify({ aseReserveWei: l.aseReserve, tokenReserveWei: l.tokenReserve });
  },
  getK(token) { const l = _loadLaunch(_norm(token)); return l.k || '0'; },
  getSpotPrice(token) {
    const l = _loadLaunch(_norm(token));
    return (l.status === 'BONDING' ? _spot(l, l.aseReserve, l.tokenReserve) : BigInt(l.finalPriceWei || '0')).toString();
  },
  price(token) { const l = _loadLaunch(_norm(token)); return (l.status === 'BONDING' ? _spot(l, l.aseReserve, l.tokenReserve) : BigInt(l.finalPriceWei || '0')).toString(); },
  getMarketCap(token) {
    const l = _loadLaunch(_norm(token));
    if (l.status !== 'BONDING') return l.finalMarketCapWei || l.marketCapWei;
    return _marketCap(l, _spot(l, l.aseReserve, l.tokenReserve)).toString();
  },
  getVolume(token) {
    const l = _loadLaunch(_norm(token));
    return JSON.stringify({
      buyVolumeWei: l.buyVolumeWei,
      sellVolumeWei: l.sellVolumeWei,
      totalVolumeWei: l.volumeWei,
      buyCount: l.buyCount,
      sellCount: l.sellCount,
      tradeCount: l.tradeCount
    });
  },
  recentTrades(token, limit) {
    const t = _norm(token);
    const l = _loadLaunch(t);
    const total = BigInt(l.tradeCount || '0');
    const requested = BigInt(limit || '50');
    assert(requested > 0n, 'trade limit must be positive');
    const take = requested > TRADE_HISTORY_LIMIT ? TRADE_HISTORY_LIMIT : requested;
    const start = total > take ? total - take : 0n;
    const trades = [];
    for (let i = start; i < total; i++) {
      const raw = storage.get(TRADE_PREFIX + t + ':' + (i % TRADE_HISTORY_LIMIT).toString());
      if (!raw) continue;
      const trade = JSON.parse(raw);
      if (BigInt(trade.index) === i) trades.push(trade);
    }
    trades.reverse();
    return JSON.stringify({ trades, totalCount: total.toString(), historyLimited: total > TRADE_HISTORY_LIMIT });
  },
  getBondingProgress(token) {
    const l = _loadLaunch(_norm(token));
    const target = BigInt(l.targetWei);
    if (l.status !== 'BONDING') return BPS.toString();
    if (target <= 0n) return '0';
    const bps = (BigInt(l.aseReserve) * BPS) / target;
    return (bps > BPS ? BPS : bps).toString();
  },
  getMigrationInfo(token) {
    const l = _loadLaunch(_norm(token));
    return JSON.stringify({
      status: l.status,
      migrationStage: l.migrationStage,
      aseDex: l.aseDex,
      aseDexPoolId: l.aseDexPoolId,
      lpSharesMinted: l.lpSharesMinted,
      lpSharesBurned: l.lpSharesBurned,
      finalAseReserve: l.finalAseReserve,
      finalTokenReserve: l.finalTokenReserve,
      finalPriceWei: l.finalPriceWei,
      finalMarketCapWei: l.finalMarketCapWei,
      creatorRewardWei: l.creatorRewardWei || l.migrationCreatorWei,
      liquidityAseWei: l.migrationAseWei,
      liquidityTokenWei: l.migrationTokenWei,
      creatorRewardPaid: l.creatorRewardPaid,
      seedSubmitted: l.migrationSeedSubmitted === true,
      liquiditySubmitted: l.migrationLiquiditySubmitted === true,
      lpBurnSubmitted: l.migrationLpBurnSubmitted === true
    });
  },
  quoteBuy(token, aseIn) {
    const l = _findLaunch(_norm(token));
    if (!l) return JSON.stringify({ feasible: false, reason: 'launch not found', tokensOut: '0' });
    return JSON.stringify(_quoteBuy(l, BigInt(aseIn || '0')));
  },
  quoteSell(token, amount) {
    const l = _findLaunch(_norm(token));
    if (!l) return JSON.stringify({ feasible: false, reason: 'launch not found', netAseOutWei: '0' });
    return JSON.stringify(_quoteSell(l, BigInt(amount || '0')));
  },
  platformStats() {
    const buyVolumeWei = _big(storage.get(BUY_VOLUME_TOTAL_KEY));
    const sellVolumeWei = _big(storage.get(SELL_VOLUME_TOTAL_KEY));
    const launchCount = _big(storage.get(COUNT_KEY));
    const bondedCount = _big(storage.get(BONDED_COUNT_KEY));
    const migratedCount = _big(storage.get(MIGRATED_COUNT_KEY));
    return JSON.stringify({
      launchCount: launchCount.toString(),
      bondedCount: bondedCount.toString(),
      migratedCount: migratedCount.toString(),
      realAseTvlWei: _big(storage.get(RESERVE_TOTAL_KEY)).toString(),
      heldWei: _big(storage.get(HELD_KEY)).toString(),
      curveBuyVolumeWei: buyVolumeWei.toString(),
      curveSellVolumeWei: sellVolumeWei.toString(),
      curveVolumeWei: (buyVolumeWei + sellVolumeWei).toString()
    });
  },
  accounting() {
    return JSON.stringify({
      heldWei: storage.get(HELD_KEY) || '0',
      reserveTotalWei: storage.get(RESERVE_TOTAL_KEY) || '0',
      surplusWei: _surplusAse().toString()
    });
  }
})
