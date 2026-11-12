/** Shared gate for background market reads. Wallet writes are never gated. */
export const LIVE_IDLE_MS = (() => {
  // Test override: ?idle=<seconds> on the URL trims the cutoff for previewing
  // the paused state without waiting the full window.
  if (typeof window !== "undefined") {
    const raw = new URLSearchParams(window.location.search).get("idle");
    if (raw && Number(raw) > 0) return Number(raw) * 1000;
  }
  return 7 * 60_000;
})();
let paused = false;
let controller = new AbortController();
const listeners = new Set<() => void>();
export const isLivePaused = () => paused;
export const subscribeLiveSession = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export function setLivePaused(value: boolean) {
  if (paused === value) return;
  paused = value;
  if (value) controller.abort();
  else controller = new AbortController();
  listeners.forEach((listener) => listener());
}

export function isMarketRead(input: RequestInfo | URL, init?: RequestInit): boolean {
  const raw = input instanceof Request ? input.url : String(input);
  const url = new URL(raw, typeof location === "undefined" ? "https://asepad.fun" : location.href);
  const sameOrigin = typeof location !== "undefined" && url.origin === location.origin;
  const dataHost = /(^|\.)asentum\.com$|(^|\.)workers\.dev$|(^|\.)sslip\.io$/.test(url.hostname) ||
    url.origin === process.env.NEXT_PUBLIC_ASE_API_URL ||
    url.hostname === "api.asepad.fun" || url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (!dataHost && !(sameOrigin && /^\/(api|rpc|snap)(\/|$)/.test(url.pathname))) return false;
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (method === "GET" || method === "HEAD") return true;
  // Only classify explicit RPC read envelopes; do not intercept signed writes,
  // uploads, wallet handshakes, or request bodies we cannot inspect.
  if (method !== "POST" || typeof init?.body !== "string") return false;
  try {
    const body = JSON.parse(init.body);
    const calls = Array.isArray(body) ? body : [body];
    return calls.length > 0 && calls.every((c: { method?: string }) =>
      typeof c.method === "string" && /^(eth_(call|get|blockNumber|chainId)|net_|web3_)/.test(c.method));
  } catch { return false; }
}

export function installLiveFetchGate() {
  const original = window.fetch;
  const gated: typeof fetch = (input, init) => {
    if (!isMarketRead(input, init)) return original(input, init);
    if (paused) return Promise.reject(new DOMException("Live market updates paused", "AbortError"));
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    return original(input, {
      ...init,
      signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    });
  };
  window.fetch = gated;
  return () => { if (window.fetch === gated) window.fetch = original; };
}
