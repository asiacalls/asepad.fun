// In-app AseDex view switching for links that live OUTSIDE the AseDex app
// (side rail, mobile nav). While AseDex is mounted, a Next <Link> nav to
// another /asedex/* view raced the app's own history writes — the app treated
// the click as a stale self-navigation and rewrote the old view's URL over it
// (the "click Markets, land on Radar" bug). Instead the link hands the view to
// the app, which switches state + URL in one step via gotoView (same path the
// old in-app pill used). Outside AseDex the link navigates normally.
export const ASEDEX_GOTO_EVENT = "asedex:goto";

export const ASEDEX_VIEW_SLUGS = { markets: "markets", radar: "radar", terminal: "terminal", pools: "pools", wallet: "wallet", wallets: "wallet" } as const;

import { APP } from "./site";

/** "/asedex/markets" → "markets"; in the asedex app "/markets" → "markets". */
export function asedexViewOf(href: string): string | null {
  const m = (APP === "asedex" ? /^\/([a-z]+)\/?$/ : /^\/asedex(?:\/([a-z]+))?\/?$/).exec(href);
  if (!m) return null;
  const seg = (m[1] ?? "radar") as keyof typeof ASEDEX_VIEW_SLUGS;
  return ASEDEX_VIEW_SLUGS[seg] ?? null;
}

/** onClick for rail/mobile links: true when AseDex took the navigation. */
export function asedexInAppNav(e: { preventDefault: () => void; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; button?: number }, href: string): boolean {
  if (typeof window === "undefined" || e.metaKey || e.ctrlKey || e.shiftKey || (e.button ?? 0) !== 0) return false;
  const view = asedexViewOf(href);
  // The asedex app owns every route; the monolith only mounts it under /asedex.
  const mounted = APP === "asedex" || window.location.pathname.startsWith("/asedex");
  if (!view || !mounted) return false;
  e.preventDefault();
  window.dispatchEvent(new CustomEvent(ASEDEX_GOTO_EVENT, { detail: view }));
  return true;
}
