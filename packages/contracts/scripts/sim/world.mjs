// In-memory Asentum runtime for multi-contract testing: injected globals
// (storage, emit, msg, chain, E, transfer), native ASE balances, nested
// E() calls with correct msg.sender / msg.contractAddress, and full
// transaction rollback on revert. Methods are invoked detached (no `this`)
// so a contract relying on method binding fails loudly here.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "sources");
export const ZERO = "0x0000000000000000000000000000000000000000";
export const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
export const ASE = 10n ** 18n;

export class World {
  constructor() {
    this.contracts = new Map();
    this.native = new Map();
    this.time = 1_700_000_000;
    this.stack = [];
    this.events = [];
    this.nextId = 1;
  }
  addr(tag = "") {
    const n = (this.nextId++).toString(16).padStart(8, "0");
    return ("0x" + Buffer.from(tag.padEnd(16, "_").slice(0, 16)).toString("hex") + n).slice(0, 42);
  }
  account(tag, ase = 1_000_000n) { const a = this.addr(tag); this.native.set(a, ase * ASE); return a; }
  bal(a) { return this.native.get(a.toLowerCase()) ?? 0n; }
  store(a) { return this.contracts.get(a.toLowerCase()).store; }
  advance(sec) { this.time += sec; }

  deploy(file, genesis, tag = file) {
    let src = readFileSync(join(SOURCES, file), "utf8");
    if (genesis !== undefined) src = src.replace("/*__ASEPAD_GENESIS__*/null", JSON.stringify(genesis));
    return this.deploySource(src, tag, file);
  }
  /** Deploy an exact source string (e.g. what the web app builds for a creator). */
  deploySource(src, tag, file = tag) {
    this.sources ??= new Map();
    const address = this.addr(tag);
    this.sources.set(address, src);
    const store = new Map();
    const world = this;
    const frame = () => world.stack[world.stack.length - 1];
    const storage = {
      get: (k) => store.get(k),
      set: (k, v) => { store.set(k, v); },
      has: (k) => store.has(k),
      delete: (k) => store.delete(k)
    };
    const msg = {
      get sender() { return frame().sender; },
      get value() { return frame().value; },
      get contractAddress() { return address; },
      get block() { return { number: 1, timestamp: world.time }; }
    };
    const chain = { get blockTimestamp() { return world.time; } };
    const assert = (c, m) => { if (!c) throw new Error(m || "assert failed"); };
    const emit = (name, data) => world.events.push({ contract: address, name, data });
    const transfer = (to, amount) => world._move(address, String(to).toLowerCase(), BigInt(amount));
    const E = (target) => new Proxy({}, {
      get: (_, method) => (...args) => world._invoke(address, String(target).toLowerCase(), String(method), args, 0n)
    });
    // Contract sources end with a top-level `({ ... })` export object, possibly indented.
    const re = /\n\s*\(\s*\{/g;
    let i = -1;
    for (let m = re.exec(src); m; m = re.exec(src)) i = m.index;
    if (i < 0) throw new Error(`${file}: no export object`);
    const body = src.slice(0, i) + "\nreturn " + src.slice(i).trimStart();
    const api = new Function("storage", "assert", "emit", "msg", "chain", "E", "transfer", body)(storage, assert, emit, msg, chain, E, transfer);
    this.contracts.set(address, { api, store, file });
    return address;
  }

  _move(from, to, amount) {
    if (amount < 0n) throw new Error("negative transfer");
    if (amount === 0n) return;
    const b = this.bal(from);
    if (b < amount) throw new Error(`native balance too low: ${from} has ${b}, needs ${amount}`);
    this.native.set(from, b - amount);
    this.native.set(to, this.bal(to) + amount);
  }
  _invoke(sender, to, method, args, value) {
    const c = this.contracts.get(to);
    if (!c) throw new Error(`E(${to}).${method}: not a contract`);
    const fn = c.api[method];
    if (typeof fn !== "function") throw new Error(`${c.file}: no method ${method}`);
    // Asentum VM rule: calling back into a contract already on the stack reverts the tx.
    if (this.stack.some((f) => f.self === to)) throw new Error(`reentrancy: ${c.file}.${method} re-entered`);
    if (value > 0n) this._move(sender, to, value);
    this.stack.push({ sender, value, self: to });
    try { return fn(...args); } finally { this.stack.pop(); }
  }
  /** Top-level signed transaction. Reverts restore all state. */
  tx(from, to, method, args = [], value = 0n) {
    const snap = this._snapshotInPlace();
    try {
      return this._invoke(from.toLowerCase(), to.toLowerCase(), method, args, BigInt(value));
    } catch (e) {
      this._restoreInPlace(snap);
      throw e;
    }
  }
  view(to, method, args = []) {
    const snap = this._snapshotInPlace();
    try { return this._invoke(ZERO, to.toLowerCase(), method, args, 0n); }
    finally { this._restoreInPlace(snap); }
  }
  // storage closures capture each contract's Map, so snapshots restore in place
  _snapshotInPlace() {
    return {
      native: new Map(this.native),
      stores: [...this.contracts].map(([a, c]) => [a, new Map(c.store)]),
      events: this.events.length
    };
  }
  _restoreInPlace(s) {
    this.native = s.native;
    for (const [a, copy] of s.stores) {
      const live = this.contracts.get(a).store;
      live.clear();
      for (const [k, v] of copy) live.set(k, v);
    }
    this.events.length = s.events;
  }
  json(to, method, args = []) { const r = this.view(to, method, args); return typeof r === "string" ? JSON.parse(r) : r; }
  eventsSince(i, name) { return this.events.slice(i).filter((e) => !name || e.name === name); }
}

let passed = 0;
export function ok(cond, label) {
  if (!cond) throw new Error(`FAIL: ${label}`);
  passed++;
  console.log("  ✓", label);
}
export function eq(a, b, label) { ok(String(a) === String(b), `${label} (${a} === ${b})`); }
export function reverts(fn, re, label) {
  try { fn(); } catch (e) {
    if (re && !re.test(e.message)) throw new Error(`FAIL: ${label}: reverted with "${e.message}", expected ${re}`);
    passed++;
    console.log("  ✓", `${label} → reverts "${e.message}"`);
    return;
  }
  throw new Error(`FAIL: ${label}: did not revert`);
}
export const section = (t) => console.log(`\n── ${t}`);
export const passedCount = () => passed;
