// ─────────────────────────────────────────────────────────────────────
// AsePad ARC-20 Token Factory — registration and AsePad binding
// Website: https://asepad.fun · X: https://x.com/asepadfun · Telegram: https://t.me/asepadfun
// ─────────────────────────────────────────────────────────────────────
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
const _ADDR = /^0x[0-9a-f]{40}$/;
const ZERO = '0x0000000000000000000000000000000000000000';
const ASEPAD_LINKS = { website: 'https://asepad.fun', x: 'https://x.com/asepadfun', telegram: 'https://t.me/asepadfun' };

// AsePad ARC-20 Factory — mother contract + self-contained fee table.
// Users deploy their own token contract with their wallet (platform provides
// prebuilt sources — no coding), then registerToken() records it here and
// charges the archetype deploy fee (msg.value → treasury). All fee keys are
// admin-configurable on this contract itself.
const ADMIN_KEY = 'factory:admin';
const TREASURY_KEY = 'factory:treasury';
const COUNT_KEY = 'factory:count';
const ASEPAD_KEY = 'factory:asepad';
const TOKEN_PREFIX = 'factory:token:';
const BY_TOKEN_PREFIX = 'factory:byToken:';
const WEI_PREFIX = 'factory:feeWei:';
const BPS_PREFIX = 'factory:feeBps:';
const WEI_ENABLED_PREFIX = 'factory:feeWeiOn:';
const BPS_ENABLED_PREFIX = 'factory:feeBpsOn:';

function _isAdmin() {
  return _norm(msg.sender) === storage.get(ADMIN_KEY);
}
function _weiEnabled(key) {
  return storage.get(WEI_ENABLED_PREFIX + key) === '1';
}
function _bpsEnabled(key) {
  return storage.get(BPS_ENABLED_PREFIX + key) === '1';
}
function _feeWei(key) {
  if (!_weiEnabled(key)) return 0n;
  return BigInt(storage.get(WEI_PREFIX + key) || '0');
}

({
  init(admin, treasuryAddress, asepadAddress) {
    assert(!storage.get(ADMIN_KEY), 'already initialised');
    const a = _norm(admin);
    assert(_ADDR.test(a), 'invalid admin');
    storage.set(ADMIN_KEY, a);
    const t = _norm(treasuryAddress || '');
    if (_ADDR.test(t)) storage.set(TREASURY_KEY, t);
    const pad = _norm(asepadAddress || '');
    if (_ADDR.test(pad)) storage.set(ASEPAD_KEY, pad);
    storage.set(COUNT_KEY, '0');
    return true;
  },

  admin() { return storage.get(ADMIN_KEY) || ''; },
  treasury() { return storage.get(TREASURY_KEY) || ''; },
  asepad() { return storage.get(ASEPAD_KEY) || ''; },
  platform() { return 'AsePad Token Factory'; },
  deploymentBrand() { return JSON.stringify({ platform: 'AsePad', module: 'ARC-20 Token Factory', ...ASEPAD_LINKS, asepad: storage.get(ASEPAD_KEY) || '' }); },
  links() { return JSON.stringify(ASEPAD_LINKS); },

  setTreasury(treasuryAddress) {
    assert(_isAdmin(), 'not admin');
    const t = _norm(treasuryAddress);
    assert(_ADDR.test(t), 'invalid treasury');
    storage.set(TREASURY_KEY, t);
    emit('TreasuryUpdated', { treasury: t });
    return true;
  },
  setAsePad(asepadAddress) {
    assert(_isAdmin(), 'not admin');
    const pad = _norm(asepadAddress);
    assert(_ADDR.test(pad), 'invalid AsePad');
    storage.set(ASEPAD_KEY, pad);
    emit('AsePadUpdated', { asepad: pad });
    return true;
  },

  // ── Fee table (admin-configurable) ────────────────────────────────────────
  // Keys: "token_deploy:<ARCHETYPE>" — charged by registerToken below.
  setFee(feeKey, amountWei) {
    assert(_isAdmin(), 'not admin');
    const key = String(feeKey);
    assert(key.length > 0, 'feeKey required');
    storage.set(WEI_PREFIX + key, String(BigInt(amountWei)));
    storage.set(WEI_ENABLED_PREFIX + key, '1');
    emit('FeeUpdated', { feeKey: key, kind: 'wei', amount: String(amountWei) });
    return true;
  },
  setFeeBps(feeKey, bps) {
    assert(_isAdmin(), 'not admin');
    const key = String(feeKey);
    const v = BigInt(bps);
    assert(v <= 1000n, 'bps max 1000 (10%)');
    storage.set(BPS_PREFIX + key, v.toString());
    storage.set(BPS_ENABLED_PREFIX + key, '1');
    emit('FeeUpdated', { feeKey: key, kind: 'bps', amount: v.toString() });
    return true;
  },
  setWeiFeeEnabled(feeKey, enabled) {
    assert(_isAdmin(), 'not admin');
    storage.set(WEI_ENABLED_PREFIX + String(feeKey), enabled ? '1' : '0');
    return true;
  },
  setBpsFeeEnabled(feeKey, enabled) {
    assert(_isAdmin(), 'not admin');
    storage.set(BPS_ENABLED_PREFIX + String(feeKey), enabled ? '1' : '0');
    return true;
  },
  // Backward-compatible alias for the fixed-amount (wei) fee enable flag.
  setFeeEnabled(feeKey, enabled) {
    assert(_isAdmin(), 'not admin');
    storage.set(WEI_ENABLED_PREFIX + String(feeKey), enabled ? '1' : '0');
    return true;
  },
  getFeeWei(feeKey) { return _feeWei(String(feeKey)).toString(); },
  getFeeBps(feeKey) {
    const key = String(feeKey);
    if (!_bpsEnabled(key)) return '0';
    return storage.get(BPS_PREFIX + key) || '0';
  },
  isFeeEnabled(feeKey) { return _weiEnabled(String(feeKey)); },
  isWeiFeeEnabled(feeKey) { return _weiEnabled(String(feeKey)); },
  isBpsFeeEnabled(feeKey) { return _bpsEnabled(String(feeKey)); },

  // ── Token registration ────────────────────────────────────────────────────
  // Called after the user's wallet deployed + initialised the token contract.
  // Non-admin: pays token_deploy:<archetype> (msg.value → treasury), creator
  // forced to msg.sender. Admin: free registration for platform ops.
  registerToken(tokenAddress, archetype, creator, configJson) {
    const caller = _norm(msg.sender);
    const isAdmin = caller === storage.get(ADMIN_KEY);
    const addr = _norm(tokenAddress);
    const archetypeKey = String(archetype || '').trim().toUpperCase();
    assert(archetypeKey.length > 0, 'archetype required');
    assert(_ADDR.test(addr), 'invalid token');
    assert(!storage.get(BY_TOKEN_PREFIX + addr), 'token already registered');

    const supply = BigInt(E(addr).totalSupply() || '0');
    const dec = BigInt(E(addr).decimals() || '0');
    assert(supply > 0n, 'token supply missing');
    assert(dec >= 0n && dec <= 38n, 'token decimals invalid');
    assert(String(E(addr).name() || '').length > 0, 'token name missing');
    assert(String(E(addr).symbol() || '').length > 0, 'token symbol missing');
    if (archetypeKey === 'ASEPAD') {
      const expectedPad = _norm(storage.get(ASEPAD_KEY) || '');
      assert(_ADDR.test(expectedPad), 'AsePad not configured');
      assert(_norm(E(addr).pad()) === expectedPad, 'token not bound to AsePad');
    }

    let resolvedCreator = _norm(creator || caller);
    if (!isAdmin) {
      const fee = _feeWei('token_deploy:' + archetypeKey);
      assert(fee > 0n, 'token creation fee not configured');
      assert(BigInt(msg.value) >= fee, 'insufficient token creation fee');
      const treasury = storage.get(TREASURY_KEY);
      assert(treasury, 'treasury not set');
      transfer(treasury, fee);
      const change = BigInt(msg.value) - fee;
      if (change > 0n) transfer(caller, change);
      resolvedCreator = caller;
      // AsePad templates bake the creator into genesis — the on-chain token
      // must agree, or anyone could claim credit for someone else's token.
      assert(_norm(E(addr).creator()) === caller, 'only the token creator can register it');
      emit('TokenCreationFeePaid', { token: addr, payer: caller, amount: fee.toString() });
    }

    const id = String(BigInt(storage.get(COUNT_KEY) || '0') + 1n);
    storage.set(COUNT_KEY, id);
    const cfg = configJson != null && String(configJson) !== '' ? String(configJson) : '{}';
    storage.set(TOKEN_PREFIX + id, JSON.stringify({
      id,
      token: addr,
      archetype: archetypeKey,
      creator: resolvedCreator,
      config: cfg,
      registeredAt: String(chain.blockTimestamp),
    }));
    storage.set(BY_TOKEN_PREFIX + addr, id);
    emit('TokenRegistered', { id, token: addr, archetype: archetypeKey, creator: resolvedCreator, config: cfg });
    return id;
  },
  getTokenByAddress(tokenAddress) {
    const id = storage.get(BY_TOKEN_PREFIX + _norm(tokenAddress));
    if (!id) return null;
    const raw = storage.get(TOKEN_PREFIX + id);
    return raw ? JSON.parse(raw) : null;
  },
  getToken(recordId) {
    const raw = storage.get(TOKEN_PREFIX + String(recordId));
    return raw ? JSON.parse(raw) : null;
  },
  tokenCount() { return storage.get(COUNT_KEY) || '0'; },

  // ── Admin ─────────────────────────────────────────────────────────────────
  transferAdmin(newAdmin) {
    assert(_isAdmin(), 'not admin');
    const a = _norm(newAdmin);
    assert(_ADDR.test(a) && a !== ZERO, 'invalid admin');
    storage.set(ADMIN_KEY, a);
    emit('AdminTransferred', { admin: _norm(newAdmin) });
    return true;
  },
  rescueAse(to, amount) {
    assert(_isAdmin(), 'not admin');
    const recipient = _norm(to);
    const amt = BigInt(amount);
    assert(amt > 0n, 'amount required');
    transfer(recipient, amt);
    emit('RescueAse', { to: recipient, amount: amt.toString() });
    return true;
  },
  rescueToken(token, to, amount) {
    assert(_isAdmin(), 'not admin');
    const t = _norm(token);
    const recipient = _norm(to);
    const amt = BigInt(amount);
    const pad = storage.get(ASEPAD_KEY);
    if (pad) {
      const status = String(E(pad).getLaunchStatus(t) || 'NOT_FOUND');
      assert(status === 'NOT_FOUND' || status === 'MIGRATED' || status === 'RECOVERED', 'active launch token protected');
    }
    assert(BigInt(E(t).balanceOf(msg.contractAddress) || '0') >= amt, 'insufficient balance');
    assert(E(t).transfer(recipient, amt.toString()), 'token transfer failed');
    emit('RescueToken', { token: t, to: recipient, amount: amt.toString() });
    return true;
  },
})
