// __ASEPAD_TOKEN_HEADER__
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

// AsePad ARC-20 base — Asentum reference-compatible fungible token
const NAME_KEY = 'meta:name';
const SYMBOL_KEY = 'meta:symbol';
const DECIMALS_KEY = 'meta:decimals';
const TOTAL_SUPPLY_KEY = 'meta:totalSupply';
const PLATFORM_KEY = 'meta:platform';
const DEPLOYER_KEY = 'meta:deployer';
const METADATA_KEY = 'meta:metadata';
const BALANCE_PREFIX = 'balance:';
const ALLOWANCE_PREFIX = 'allowance:';
const ZERO = '0x0000000000000000000000000000000000000000';
const ASEPAD_LINKS = { website: 'https://asepad.fun', x: 'https://x.com/asepadfun', telegram: 'https://t.me/asepadfun' };
const RESCUE_OWNER_KEY = 'rescue:owner';
// Genesis is baked into the source at deploy time (name, symbol, decimals,
// supply, creator, metadata) so the token needs no init transaction: the full
// supply belongs to the creator from the moment the deploy is mined.
const GENESIS = /*__ASEPAD_GENESIS__*/null;
const GENESIS_KEY = 'genesis:done';
function _g() {
  assert(GENESIS && typeof GENESIS === 'object', 'token genesis missing');
  return GENESIS;
}
function _genesisDone() { return storage.get(GENESIS_KEY) === '1'; }
function _creator() { return storage.get(DEPLOYER_KEY) || _norm(_g().creator); }
function _meta() { return storage.get(METADATA_KEY) || String(_g().metadata || '{}'); }
function _metaField(k) { try { return String(JSON.parse(_meta())[k] || ''); } catch { return ''; } }
function _ensureGenesis() {
  if (_genesisDone()) return;
  const g = _g();
  const name = String(g.name || '');
  const symbol = String(g.symbol || '');
  assert(name.length > 0 && name.length <= 80, 'invalid name');
  assert(symbol.length > 0 && symbol.length <= 20, 'invalid symbol');
  const dec = BigInt(String(g.decimals));
  assert(dec >= 0n && dec <= 38n, 'decimals out of range');
  const supply = BigInt(String(g.supply));
  assert(supply > 0n, 'supply must be positive');
  const creator = _norm(g.creator);
  assert(/^0x[0-9a-f]{40}$/.test(creator) && creator !== ZERO, 'creator required');
  const metadata = String(g.metadata || '{}');
  assert(metadata.length <= 2048, 'metadata too long');
  try { JSON.parse(metadata); } catch { assert(false, 'invalid metadata'); }
  storage.set(NAME_KEY, name);
  storage.set(SYMBOL_KEY, symbol);
  storage.set(DECIMALS_KEY, dec.toString());
  storage.set(TOTAL_SUPPLY_KEY, supply.toString());
  storage.set(PLATFORM_KEY, 'AsePad Token Studio');
  storage.set(DEPLOYER_KEY, creator);
  storage.set(METADATA_KEY, metadata);
  storage.set(BALANCE_PREFIX + creator, supply.toString());
  storage.set(RESCUE_OWNER_KEY, creator);
  storage.set(GENESIS_KEY, '1');
  emit('Transfer', { from: ZERO, to: creator, value: supply.toString() });
  emit('TokenDeployed', { platform: 'AsePad Token Studio', deployer: creator });
}

({
  rescueOwner() { return storage.get(RESCUE_OWNER_KEY) || _creator(); },
  name() { return storage.get(NAME_KEY) || String(_g().name); },
  symbol() { return storage.get(SYMBOL_KEY) || String(_g().symbol); },
  decimals() { return storage.get(DECIMALS_KEY) || String(_g().decimals); },
  totalSupply() { return storage.get(TOTAL_SUPPLY_KEY) || String(_g().supply); },
  platform() { return storage.get(PLATFORM_KEY) || 'AsePad Token Studio'; },
  deployer() { return _creator(); },
  creator() { return _creator(); },
  metadata() { return _meta(); },
  description() { return _metaField('description'); },
  logoUrl() { return _metaField('logoUrl'); },
  website() { return _metaField('website'); },
  twitter() { return _metaField('twitter'); },
  telegram() { return _metaField('telegram'); },
  // AsePad platform links + the creator's own socials.
  links() { return JSON.stringify({ asepad: ASEPAD_LINKS, token: { website: _metaField('website'), twitter: _metaField('twitter'), telegram: _metaField('telegram') } }); },
  deploymentBrand() {
    return JSON.stringify({ platform: storage.get(PLATFORM_KEY) || 'AsePad Token Studio', createdWith: ASEPAD_LINKS.website, ...ASEPAD_LINKS, deployer: _creator() });
  },
  // Deployer-gated metadata update — lets the token owner fix logo/socials later.
  setMetadata(metadataJson) {
    _ensureGenesis();
    assert(_norm(msg.sender) === storage.get(DEPLOYER_KEY), 'not token deployer');
    const metadata = String(metadataJson || '{}');
    assert(metadata.length <= 2048, 'metadata too long');
    try { JSON.parse(metadata); } catch { assert(false, 'invalid metadata'); }
    storage.set(METADATA_KEY, metadata);
    emit('MetadataUpdated', { deployer: storage.get(DEPLOYER_KEY) });
    return true;
  },
  balanceOf(addr) {
    const a = _norm(addr);
    if (!_genesisDone()) return a === _creator() ? String(_g().supply) : '0';
    return storage.get(BALANCE_PREFIX + a) || '0';
  },
  allowance(owner, spender) {
    return storage.get(
      ALLOWANCE_PREFIX + _norm(owner) + ':' + _norm(spender),
    ) || '0';
  },
  transfer(to, amount) {
    _ensureGenesis();
    const from = _norm(msg.sender);
    const recipient = _norm(to);
    assert(recipient !== ZERO, 'transfer to zero address');
    const amt = BigInt(amount);
    assert(amt >= 0n, 'amount must be non-negative');
    const fromBal = BigInt(storage.get(BALANCE_PREFIX + from) || '0');
    assert(fromBal >= amt, 'insufficient balance');
    const toBal = BigInt(storage.get(BALANCE_PREFIX + recipient) || '0');
    storage.set(BALANCE_PREFIX + from, (fromBal - amt).toString());
    storage.set(BALANCE_PREFIX + recipient, (toBal + amt).toString());
    emit('Transfer', { from, to: recipient, value: amt.toString() });
    return true;
  },
  approve(spender, amount) {
    _ensureGenesis();
    const owner = _norm(msg.sender);
    const sp = _norm(spender);
    const amt = BigInt(amount);
    assert(amt >= 0n, 'amount must be non-negative');
    storage.set(ALLOWANCE_PREFIX + owner + ':' + sp, amt.toString());
    emit('Approval', { owner, spender: sp, value: amt.toString() });
    return true;
  },
  transferFrom(from, to, amount) {
    _ensureGenesis();
    const owner = _norm(from);
    const spender = _norm(msg.sender);
    const recipient = _norm(to);
    assert(recipient !== ZERO, 'transfer to zero address');
    const amt = BigInt(amount);
    assert(amt >= 0n, 'amount must be non-negative');
    const allowKey = ALLOWANCE_PREFIX + owner + ':' + spender;
    const allowed = BigInt(storage.get(allowKey) || '0');
    assert(allowed >= amt, 'allowance exceeded');
    const fromBal = BigInt(storage.get(BALANCE_PREFIX + owner) || '0');
    assert(fromBal >= amt, 'insufficient balance');
    const newAllow = allowed - amt;
    storage.set(allowKey, newAllow.toString());
    emit('Approval', { owner, spender, value: newAllow.toString() });
    const toBal = BigInt(storage.get(BALANCE_PREFIX + recipient) || '0');
    storage.set(BALANCE_PREFIX + owner, (fromBal - amt).toString());
    storage.set(BALANCE_PREFIX + recipient, (toBal + amt).toString());
    emit('Transfer', { from: owner, to: recipient, value: amt.toString() });
    return true;
  },

  transferRescueOwner(newOwner) {
    _ensureGenesis();
    assert(_norm(msg.sender) === storage.get(RESCUE_OWNER_KEY), 'not rescue owner');
    storage.set(RESCUE_OWNER_KEY, _norm(newOwner));
    emit('RescueOwnerTransferred', { owner: _norm(newOwner) });
    return true;
  },
  rescueAse(to, amount) {
    _ensureGenesis();
    assert(_norm(msg.sender) === storage.get(RESCUE_OWNER_KEY), 'not rescue owner');
    const recipient = _norm(to);
    const amt = BigInt(amount);
    assert(amt > 0n, 'amount required');
    transfer(recipient, amt);
    emit('RescueAse', { to: recipient, amount: amt.toString() });
    return true;
  },
  rescueToken(token, to, amount) {
    _ensureGenesis();
    assert(_norm(msg.sender) === storage.get(RESCUE_OWNER_KEY), 'not rescue owner');
    const t = _norm(token);
    const recipient = _norm(to);
    const amt = BigInt(amount);
    const bal = BigInt(E(t).balanceOf(msg.contractAddress) || '0');
    assert(bal >= amt, 'insufficient stray token balance');
    assert(E(t).transfer(recipient, amt.toString()), 'transfer failed');
    emit('RescueToken', { token: t, to: recipient, amount: amt.toString() });
    return true;
  },
  rescueAllToken(token, to) {
    _ensureGenesis();
    assert(_norm(msg.sender) === storage.get(RESCUE_OWNER_KEY), 'not rescue owner');
    const t = _norm(token);
    const recipient = _norm(to);
    const bal = BigInt(E(t).balanceOf(msg.contractAddress) || '0');
    if (bal === 0n) return false;
    assert(E(t).transfer(recipient, bal.toString()), 'transfer failed');
    emit('RescueToken', { token: t, to: recipient, amount: bal.toString() });
    return true;
  },
})