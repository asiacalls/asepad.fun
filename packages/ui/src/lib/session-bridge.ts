// Cross-subdomain wallet session bridge. The @asentum/connect SDK persists
// {address, method} in localStorage (per-origin). Mirroring the same JSON in a
// .asepad.fun cookie lets every *.asepad.fun app pick the session up — the
// cookie carries only the public address + connect method, never keys.
const KEY = "asentum:connect:address";
const COOKIE = "ase_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30d

const onSite = () =>
  typeof window !== "undefined" && /(^|\.)asepad\.fun$/.test(window.location.hostname);

function readCookie(): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${COOKIE}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

/** Seed localStorage from the shared cookie BEFORE the SDK reads it. Call at
 *  module scope from the app providers. No-op on localhost / already-seeded. */
export function seedWalletSession() {
  if (!onSite()) return;
  try {
    if (!window.localStorage.getItem(KEY)) {
      const raw = readCookie();
      if (raw) {
        const v = JSON.parse(raw);
        if (v && typeof v.address === "string") window.localStorage.setItem(KEY, raw);
      }
    }
  } catch { }
}

/** Mirror the SDK session into (or out of) the shared cookie. Call when the
 *  connected state changes. */
export function syncWalletSession(connected: boolean) {
  if (!onSite()) return;
  try {
    if (connected) {
      const raw = window.localStorage.getItem(KEY);
      if (raw) document.cookie = `${COOKIE}=${encodeURIComponent(raw)}; Domain=.asepad.fun; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax; Secure`;
    } else {
      document.cookie = `${COOKIE}=; Domain=.asepad.fun; Path=/; Max-Age=0; SameSite=Lax; Secure`;
    }
  } catch { }
}
