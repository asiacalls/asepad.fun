// __ASEPAD_TOKEN_HEADER__
// ─────────────────────────────────────────────────────────────────────
// Launched with AsePad — https://asepad.fun
// Website: https://asepad.fun · X: https://x.com/asepadfun · Telegram: https://t.me/asepadfun
// Fair-launch ARC-20: bonding curve → AseDex liquidity, LP burned forever.
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

// ARC-20 pad — the ASEPAD launch token. Clean fixed-supply ARC-20 economics
// (0% tax, no burn/reflection, no mint/admin control).
// Genesis is baked into the source at deploy time (name, symbol, decimals,
// supply, pad, creator): the full supply belongs to the bound AsePad, so a
// launch is deploy + AsePad.createLaunch with no init/approve/deposit steps.
// The bound AsePad and its configured AseDex may pull tokens into themselves
// without an allowance — both only ever pull from the transaction's caller —
// which makes sells a single signature.
const GENESIS = /*__ASEPAD_GENESIS__*/null;
const GENESIS_KEY = 'genesis:done';
const NAME_KEY = 'meta:name';
const SYMBOL_KEY = 'meta:symbol';
const DECIMALS_KEY = 'meta:decimals';
const TOTAL_SUPPLY_KEY = 'meta:totalSupply';
const PLATFORM_KEY = 'meta:platform';
const DEPLOYER_KEY = 'meta:deployer';
const METADATA_KEY = 'meta:metadata';
const BALANCE_PREFIX = 'balance:';
const ALLOWANCE_PREFIX = 'allowance:';
const HOLDER_COUNT_KEY = 'holders:count';
const HOLDER_INDEX_PREFIX = 'holders:index:';
const HOLDER_BY_ADDRESS_PREFIX = 'holders:address:';
const PAD_KEY = 'curve:pad';
const DEX_KEY = 'curve:aseDex';
const DEX_LOCKED_KEY = 'curve:aseDexLocked';
const ZERO = '0x0000000000000000000000000000000000000000';
const ASEPAD_LINKS = { website: 'https://asepad.fun', x: 'https://x.com/asepadfun', telegram: 'https://t.me/asepadfun' };
function _isAddr(a) { return /^0x[0-9a-f]{40}$/.test(String(a)); }
function _trackHolder(address, balance) {
  const addr = _norm(address);
  if (addr === ZERO) return;
  const mapKey = HOLDER_BY_ADDRESS_PREFIX + addr;
  const encodedIndex = BigInt(storage.get(mapKey) || '0');
  const count = BigInt(storage.get(HOLDER_COUNT_KEY) || '0');
  if (BigInt(balance) > 0n && encodedIndex === 0n) {
    storage.set(HOLDER_INDEX_PREFIX + count.toString(), addr);
    storage.set(mapKey, (count + 1n).toString());
    storage.set(HOLDER_COUNT_KEY, (count + 1n).toString());
  } else if (BigInt(balance) === 0n && encodedIndex > 0n) {
    const index = encodedIndex - 1n;
    const lastIndex = count - 1n;
    if (index !== lastIndex) {
      const lastAddress = storage.get(HOLDER_INDEX_PREFIX + lastIndex.toString()) || '';
      storage.set(HOLDER_INDEX_PREFIX + index.toString(), lastAddress);
      storage.set(HOLDER_BY_ADDRESS_PREFIX + lastAddress, (index + 1n).toString());
    }
    storage.set(HOLDER_INDEX_PREFIX + lastIndex.toString(), '');
    storage.set(mapKey, '0');
    storage.set(HOLDER_COUNT_KEY, lastIndex.toString());
  }
}
function _g() {
  assert(GENESIS && typeof GENESIS === 'object', 'token genesis missing');
  return GENESIS;
}
function _genesisDone() { return storage.get(GENESIS_KEY) === '1'; }
// Creator metadata (description, logoUrl, website, twitter, telegram) as a JSON object.
function _checkMeta(raw) {
  const metadata = String(raw || '{}');
  assert(metadata.length <= 2048, 'metadata too long');
  let parsed;
  try { parsed = JSON.parse(metadata); } catch { assert(false, 'invalid metadata'); }
  assert(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'metadata must be an object');
  return metadata;
}
function _meta() { return storage.get(METADATA_KEY) || String((GENESIS && GENESIS.metadata) || '{}'); }
function _metaField(k) { try { return String(JSON.parse(_meta())[k] || ''); } catch { return ''; } }
// Materialise the baked genesis on the first state-changing call.
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
  const pad = _norm(g.pad);
  const creator = _norm(g.creator);
  assert(_isAddr(pad) && pad !== ZERO, 'AsePad required');
  assert(_isAddr(creator) && creator !== ZERO, 'creator required');
  storage.set(METADATA_KEY, _checkMeta(g.metadata));
  storage.set(NAME_KEY, name);
  storage.set(SYMBOL_KEY, symbol);
  storage.set(DECIMALS_KEY, dec.toString());
  storage.set(TOTAL_SUPPLY_KEY, supply.toString());
  storage.set(PAD_KEY, pad);
  storage.set(PLATFORM_KEY, 'AsePad');
  storage.set(DEPLOYER_KEY, creator);
  storage.set(DEX_LOCKED_KEY, 'true');
  storage.set(HOLDER_COUNT_KEY, '0');
  storage.set(BALANCE_PREFIX + pad, supply.toString());
  _trackHolder(pad, supply);
  storage.set(GENESIS_KEY, '1');
  emit('Transfer', { from: ZERO, to: pad, value: supply.toString() });
  emit('TokenDeployed', { platform: 'AsePad', deployer: creator, launchpad: pad });
}
function _pad() {
  const pad = storage.get(PAD_KEY) || (GENESIS ? _norm(GENESIS.pad) : '');
  assert(pad && pad !== ZERO, 'AsePad not configured');
  return pad;
}
function _bal(addr) {
  const a = _norm(addr);
  if (!_genesisDone()) return a === _pad() ? String(_g().supply) : '0';
  return storage.get(BALANCE_PREFIX + a) || '0';
}
// Pad and bound DEX pull into themselves only, from their own caller.
function _trustedPull(spender, recipient) {
  if (spender !== recipient) return false;
  const dex = storage.get(DEX_KEY);
  return spender === _pad() || (_isAddr(dex) && spender === dex);
}
// LP lock lives in the token: while the launch is on the curve, NO approval
// or pull is possible for anyone except the pad itself — so a bonding token
// cannot be added as liquidity on ANY dex, bound or foreign. Curve trades
// never need approvals (buys send native, sells use the pad's trusted pull),
// and the pad's own migration approvals/transfer stay allowed. The lock opens
// permanently when the pad calls unlockAseDex at migration completion.
function _assertDexTransfer(owner, spender) {
  if (_norm(owner) === _pad() || _norm(spender) === _pad()) return;
  assert(storage.get(DEX_LOCKED_KEY) === 'false', 'token LP locked until migration');
}

({
  name() { return storage.get(NAME_KEY) || String(_g().name); },
  symbol() { return storage.get(SYMBOL_KEY) || String(_g().symbol); },
  decimals() { return storage.get(DECIMALS_KEY) || String(_g().decimals); },
  totalSupply() { return storage.get(TOTAL_SUPPLY_KEY) || String(_g().supply); },
  platform() { return storage.get(PLATFORM_KEY) || 'AsePad'; },
  deployer() { return storage.get(DEPLOYER_KEY) || _norm(_g().creator); },
  creator() { return storage.get(DEPLOYER_KEY) || _norm(_g().creator); },
  deploymentBrand() {
    return JSON.stringify({ platform: 'AsePad', launchedWith: ASEPAD_LINKS.website, ...ASEPAD_LINKS, deployer: storage.get(DEPLOYER_KEY) || _norm(_g().creator), launchpad: _pad(), dex: storage.get(DEX_KEY) || ZERO });
  },
  // AsePad platform links + the creator's own socials.
  links() { return JSON.stringify({ asepad: ASEPAD_LINKS, token: { website: _metaField('website'), twitter: _metaField('twitter'), telegram: _metaField('telegram') } }); },
  metadata() { return _meta(); },
  description() { return _metaField('description'); },
  logoUrl() { return _metaField('logoUrl'); },
  website() { return _metaField('website'); },
  twitter() { return _metaField('twitter'); },
  telegram() { return _metaField('telegram'); },
  // Creator-gated metadata update — fix logo/socials after launch.
  setMetadata(metadataJson) {
    _ensureGenesis();
    assert(_norm(msg.sender) === storage.get(DEPLOYER_KEY), 'not token creator');
    storage.set(METADATA_KEY, _checkMeta(metadataJson));
    emit('MetadataUpdated', { creator: storage.get(DEPLOYER_KEY) });
    return true;
  },
  pad() { return _pad(); },
  aseDex() { return storage.get(DEX_KEY) || ZERO; },
  aseDexLocked() { return storage.get(DEX_LOCKED_KEY) !== 'false'; },
  // True when `spender` can pull into itself without an approve (AsePad / bound AseDex).
  trustedSpender(spender) { const s = _norm(spender); return _trustedPull(s, s); },
  configureAseDex(dexAddr) {
    assert(_norm(msg.sender) === _pad(), 'only AsePad');
    _ensureGenesis();
    const dex = _norm(dexAddr);
    assert(_isAddr(dex) && dex !== ZERO, 'invalid AseDex');
    const existing = storage.get(DEX_KEY);
    assert(!existing || existing === dex, 'AseDex already configured');
    storage.set(DEX_KEY, dex);
    return true;
  },
  unlockAseDex() {
    assert(_norm(msg.sender) === _pad(), 'only AsePad');
    _ensureGenesis();
    storage.set(DEX_LOCKED_KEY, 'false');
    return true;
  },
  // Pad-to-pad handover: the current AsePad calls this while exporting the
  // launch, so all pad-privileged calls (configureAseDex, unlockAseDex,
  // trusted pulls) follow the new contract. Only the bound pad can rebind.
  migratePad(newPad) {
    const cur = _pad();
    assert(_norm(msg.sender) === cur, 'only AsePad');
    _ensureGenesis();
    const nxt = _norm(newPad);
    assert(_isAddr(nxt) && nxt !== ZERO && nxt !== cur, 'invalid new AsePad');
    storage.set(PAD_KEY, nxt);
    emit('PadMigrated', { from: cur, to: nxt });
    return true;
  },
  balanceOf(addr) { return _bal(addr); },
  holderCount() { return _genesisDone() ? (storage.get(HOLDER_COUNT_KEY) || '0') : '1'; },
  holderAt(index) {
    if (!_genesisDone()) return String(index) === '0' ? _pad() : '';
    return storage.get(HOLDER_INDEX_PREFIX + String(index)) || '';
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
    const fromAfter = fromBal - amt;
    const toAfter = toBal + amt;
    storage.set(BALANCE_PREFIX + from, fromAfter.toString());
    storage.set(BALANCE_PREFIX + recipient, toAfter.toString());
    _trackHolder(from, fromAfter);
    _trackHolder(recipient, toAfter);
    emit('Transfer', { from, to: recipient, value: amt.toString() });
    return true;
  },
  approve(spender, amount) {
    _ensureGenesis();
    const owner = _norm(msg.sender);
    const sp = _norm(spender);
    const amt = BigInt(amount);
    assert(amt >= 0n, 'amount must be non-negative');
    _assertDexTransfer(owner, sp);
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
    _assertDexTransfer(owner, spender);
    const fromBal = BigInt(storage.get(BALANCE_PREFIX + owner) || '0');
    assert(fromBal >= amt, 'insufficient balance');
    if (!_trustedPull(spender, recipient)) {
      const allowKey = ALLOWANCE_PREFIX + owner + ':' + spender;
      const allowed = BigInt(storage.get(allowKey) || '0');
      assert(allowed >= amt, 'allowance exceeded');
      const newAllow = allowed - amt;
      storage.set(allowKey, newAllow.toString());
      emit('Approval', { owner, spender, value: newAllow.toString() });
    }
    const toBal = BigInt(storage.get(BALANCE_PREFIX + recipient) || '0');
    const fromAfter = fromBal - amt;
    const toAfter = toBal + amt;
    storage.set(BALANCE_PREFIX + owner, fromAfter.toString());
    storage.set(BALANCE_PREFIX + recipient, toAfter.toString());
    _trackHolder(owner, fromAfter);
    _trackHolder(recipient, toAfter);
    emit('Transfer', { from: owner, to: recipient, value: amt.toString() });
    return true;
  },
})
