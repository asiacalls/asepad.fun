// __ASEPAD_TOKEN_HEADER__
// ─────────────────────────────────────────────────────────────────────
// Created with AsePad Token Studio — https://asepad.fun
// Website: https://asepad.fun · X: https://x.com/asepadfun · Telegram: https://t.me/asepadfun
// Self-custodial fixed-supply ARC-20 with creator-set buy/sell tax.
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

// AsePad ARC-20 tax — fixed-supply token with creator-configured buy/sell tax.
// A "sell" is a transfer INTO a bound dex contract; a "buy" is a transfer
// OUT of one. Both AseDex and the legacy dex are bound at genesis so tax
// can't be dodged on either venue. Tax rates are locked at genesis (4% max
// each — no honeypot knob); the tax wallet and exemption list are
// owner-configurable. Plain wallet transfers are untaxed.
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
const ACTIVATED_KEY = 'activated';
const OWNER_KEY = 'tax:owner';
const BUY_TAX_KEY = 'tax:buyBps';
const SELL_TAX_KEY = 'tax:sellBps';
const TAX_WALLET_KEY = 'tax:wallet';
const DEX_KEY = 'tax:dex';
const DEX2_KEY = 'tax:dex2';
const EXCLUDED_PREFIX = 'tax:ex:';
const MAX_TAX_BPS = 400n; // 4% hard cap per side, baked at genesis
// Genesis is baked into the source at deploy time (name, symbol, decimals,
// supply, creator, metadata, registry, dex, dex2, buyTaxBps, sellTaxBps, taxWallet)
// so the token needs no init transaction. Like the standard template the token
// is inert — no transfers or approvals — until the Factory Router reports it
// registered (the Token Studio fee), then caches the flag.
const GENESIS = /*__ASEPAD_GENESIS__*/null;
const GENESIS_KEY = 'genesis:done';
function _g() {
  assert(GENESIS && typeof GENESIS === 'object', 'token genesis missing');
  return GENESIS;
}
function _genesisDone() { return storage.get(GENESIS_KEY) === '1'; }
function _creator() { return storage.get(DEPLOYER_KEY) || _norm(_g().creator); }
function _owner() { return storage.get(OWNER_KEY) || _creator(); }
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
  const registry = _norm(String(g.registry || ''));
  assert(/^0x[0-9a-f]{40}$/.test(registry) && registry !== ZERO, 'registry required');
  const dex = _norm(String(g.dex || ''));
  assert(/^0x[0-9a-f]{40}$/.test(dex) && dex !== ZERO, 'dex required');
  const dex2 = _norm(String(g.dex2 || ''));
  assert(dex2 === '' || (/^0x[0-9a-f]{40}$/.test(dex2) && dex2 !== ZERO && dex2 !== dex), 'invalid second dex');
  const buyTax = BigInt(String(g.buyTaxBps || '0'));
  const sellTax = BigInt(String(g.sellTaxBps || '0'));
  assert(buyTax >= 0n && buyTax <= MAX_TAX_BPS, 'buy tax exceeds 4% cap');
  assert(sellTax >= 0n && sellTax <= MAX_TAX_BPS, 'sell tax exceeds 4% cap');
  const taxWallet = _norm(String(g.taxWallet || g.creator));
  assert(/^0x[0-9a-f]{40}$/.test(taxWallet) && taxWallet !== ZERO, 'tax wallet required');
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
  storage.set(OWNER_KEY, creator);
  storage.set(BUY_TAX_KEY, buyTax.toString());
  storage.set(SELL_TAX_KEY, sellTax.toString());
  storage.set(TAX_WALLET_KEY, taxWallet);
  storage.set(DEX_KEY, dex);
  if (dex2) storage.set(DEX2_KEY, dex2);
  // Creator, tax wallet and the contract itself never pay tax.
  storage.set(EXCLUDED_PREFIX + creator, '1');
  storage.set(EXCLUDED_PREFIX + taxWallet, '1');
  storage.set(EXCLUDED_PREFIX + _norm(msg.contractAddress), '1');
  storage.set(BALANCE_PREFIX + creator, supply.toString());
  storage.set(RESCUE_OWNER_KEY, creator);
  storage.set(GENESIS_KEY, '1');
  emit('Transfer', { from: ZERO, to: creator, value: supply.toString() });
  emit('TokenDeployed', { platform: 'AsePad Token Studio', deployer: creator });
}
function _registry() { return _norm(String(_g().registry || '')); }
function _activated() {
  if (storage.get(ACTIVATED_KEY) === '1') return true;
  try { return String(E(_registry()).registered(_norm(msg.contractAddress))) === 'true'; } catch { return false; }
}
function _assertActive() {
  assert(_activated(), 'token locked until AsePad registration');
  storage.set(ACTIVATED_KEY, '1');
}

function _excluded(addr) { return storage.get(EXCLUDED_PREFIX + addr) === '1'; }
function _credit(addr, amt) {
  const a = _norm(addr);
  storage.set(BALANCE_PREFIX + a, (BigInt(storage.get(BALANCE_PREFIX + a) || '0') + amt).toString());
}
function _debit(addr, amt, err) {
  const a = _norm(addr);
  const b = BigInt(storage.get(BALANCE_PREFIX + a) || '0');
  assert(b >= amt, err || 'insufficient balance');
  storage.set(BALANCE_PREFIX + a, (b - amt).toString());
}
// Sell into a bound dex charges tax on top so the pool always receives the
// exact amount (pool accounting stays honest); buys skim tax out of the
// received amount; everything else is a plain untaxed transfer.
function _doTransfer(from, recipient, amt) {
  assert(recipient !== ZERO, 'transfer to zero address');
  const dex = storage.get(DEX_KEY) || '';
  const dex2 = storage.get(DEX2_KEY) || '';
  const isDex = (a) => a === dex || (dex2 !== '' && a === dex2);
  const taxWallet = storage.get(TAX_WALLET_KEY) || '';
  const exempt = _excluded(from) || _excluded(recipient);
  if (isDex(recipient) && !exempt) {
    const tax = (amt * BigInt(storage.get(SELL_TAX_KEY) || '0')) / 10000n;
    _debit(from, amt + tax, 'insufficient balance for amount+tax');
    _credit(recipient, amt);
    if (tax > 0n && taxWallet) _credit(taxWallet, tax);
    emit('Transfer', { from, to: recipient, value: amt.toString() });
    if (tax > 0n) emit('TaxCollected', { from, kind: 'sell', value: tax.toString() });
    return;
  }
  const tax = (isDex(from) && !exempt) ? (amt * BigInt(storage.get(BUY_TAX_KEY) || '0')) / 10000n : 0n;
  _debit(from, amt);
  _credit(recipient, amt - tax);
  if (tax > 0n && taxWallet) _credit(taxWallet, tax);
  emit('Transfer', { from, to: recipient, value: (amt - tax).toString() });
  if (tax > 0n) emit('TaxCollected', { from, to: recipient, kind: 'buy', value: tax.toString() });
}

({
  rescueOwner() { return storage.get(RESCUE_OWNER_KEY) || _creator(); },
  owner() { return _owner(); },
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
  buyTaxBps() { return storage.get(BUY_TAX_KEY) || String(_g().buyTaxBps || '0'); },
  sellTaxBps() { return storage.get(SELL_TAX_KEY) || String(_g().sellTaxBps || '0'); },
  taxBps() { return storage.get(SELL_TAX_KEY) || String(_g().sellTaxBps || '0'); },
  taxWallet() { return storage.get(TAX_WALLET_KEY) || _norm(String(_g().taxWallet || _g().creator)); },
  aseDex() { return storage.get(DEX_KEY) || _norm(String(_g().dex || '')); },
  dex2() { return storage.get(DEX2_KEY) || _norm(String(_g().dex2 || '')); },
  boundDexes() {
    const d1 = storage.get(DEX_KEY) || _norm(String(_g().dex || ''));
    const d2 = storage.get(DEX2_KEY) || _norm(String(_g().dex2 || ''));
    return JSON.stringify(d2 ? [d1, d2] : [d1]);
  },
  isExcluded(addr) { return _excluded(_norm(addr)) ? 'true' : 'false'; },
  // Owner may repoint where the tax lands, but the rates and the exemption
  // list are genesis-locked — no one can be added or removed post-deploy, so
  // the advertised tax can never be quietly switched off.
  setTaxWallet(addr) {
    _ensureGenesis();
    assert(_norm(msg.sender) === _owner(), 'not owner');
    const w = _norm(addr);
    assert(/^0x[0-9a-f]{40}$/.test(w) && w !== ZERO, 'invalid tax wallet');
    storage.set(TAX_WALLET_KEY, w);
    emit('TaxWalletUpdated', { wallet: w });
    return true;
  },
  // Deployer-gated metadata update — lets the token owner fix logo/socials later.
  setMetadata(metadataJson) {
    _ensureGenesis();
    assert(_norm(msg.sender) === storage.get(DEPLOYER_KEY), 'not token deployer');
    const metadata = String(metadataJson || '{}');
    assert(metadata.length <= 2048, 'metadata too long');
    let parsed = null;
    try { parsed = JSON.parse(metadata); } catch { assert(false, 'invalid metadata'); }
    assert(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'invalid metadata');
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
  activated() { return _activated() ? 'true' : 'false'; },
  registry() { return _registry(); },
  transfer(to, amount) {
    _ensureGenesis();
    _assertActive();
    const from = _norm(msg.sender);
    const amt = BigInt(amount);
    assert(amt >= 0n, 'amount must be non-negative');
    _doTransfer(from, _norm(to), amt);
    return true;
  },
  approve(spender, amount) {
    _ensureGenesis();
    _assertActive();
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
    _assertActive();
    const owner = _norm(from);
    const spender = _norm(msg.sender);
    const recipient = _norm(to);
    const amt = BigInt(amount);
    assert(amt >= 0n, 'amount must be non-negative');
    const allowKey = ALLOWANCE_PREFIX + owner + ':' + spender;
    const allowed = BigInt(storage.get(allowKey) || '0');
    // Sell-side tax is charged on top of the pulled amount, so the allowance
    // only has to cover the pool amount itself.
    assert(allowed >= amt, 'allowance exceeded');
    storage.set(allowKey, (allowed - amt).toString());
    emit('Approval', { owner, spender, value: (allowed - amt).toString() });
    _doTransfer(owner, recipient, amt);
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
