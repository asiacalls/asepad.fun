"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight, BarChart3, BookOpen, Bot, CandlestickChart, Check, ChevronDown, Copy, Droplets,
  ExternalLink, House, Layers, Lock, LogOut,
  Radar, Rocket, Send, Smartphone, Wallet, WalletCards,
  type LucideIcon
} from "lucide-react";
import { useWalletStore } from "@/stores/wallet";
import { shortenAddress } from "@/lib/asepad";
import { cn } from "@/lib/cn";
import { asedexInAppNav } from "@/lib/asedex-nav";
import { href as siteHref, appPath, APP } from "@/lib/site";

/** X (Twitter) mark — lucide dropped the brand icon, so it ships inline. */
const XIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

// Pinksale-style collapsible icon rail: icons only at rest (56px), expands on
// hover to reveal section names + AseDex sub-pages. md+ only — mobile keeps
// the bottom MobileNav.
export type RailLink = {
  href: string;
  label: string;
  icon: LucideIcon;
  labelImg?: string;
  labelImgCls?: string;
  children?: readonly { href: string; label: string; icon: LucideIcon; labelImg?: string; labelImgCls?: string }[];
};

export const navLinks: readonly RailLink[] = [
  { href: "/", label: "Home", icon: House },
  { href: "/asepad", label: "AsePad Launches", icon: Rocket },
  { href: "/create", label: "Create Token", icon: Layers },
  {
    href: "/asedex", label: "AseDex", icon: ArrowLeftRight,
    children: [
      { href: "/asedex/markets", label: "Markets", icon: BarChart3 },
      { href: "/asedex/radar", label: "Radar", icon: Radar },
      { href: "/asedex/terminal", label: "Terminal", icon: CandlestickChart },
      { href: "/asedex/pools", label: "Pools", icon: Droplets },
      { href: "/asedex/wallet", label: "Wallet", icon: WalletCards }
    ]
  },
  { href: "/lock", label: "Token Lock", icon: Lock },
  { href: "/asevault", label: "AseVault", icon: Smartphone },
  { href: "/docs", label: "Docs", icon: BookOpen }
];

export function navIsActive(pathname: string, href: string) {
  // Split apps: the nav item that maps to this app is active on every route
  // (the app IS that section); items mapping to other apps are never active.
  const local = appPath(href);
  if (APP !== "web" && local) {
    if (local.app !== APP) return false;
    return true;
  }
  if (href === "/asepad") return pathname === "/asepad" || pathname.startsWith("/asepad/token");
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Child-link active check — compares against this app's local path. */
function childActive(pathname: string, href: string) {
  const local = appPath(href);
  const cmp = APP !== "web" && local && local.app === APP ? local.path : href;
  return pathname === cmp || pathname.startsWith(`${cmp}/`);
}

// Official channels — external links pinned at the rail's foot. Same row
// anatomy as nav items (icon at rest, icon+label expanded). Exported for the
// mobile slide-out, which lists them above its wallet row.
export const socialLinks = [
  { href: "https://t.me/asepadbot", label: "AsePad Bot", icon: Bot },
  { href: "https://t.me/asepadfun", label: "Telegram", icon: Send },
  { href: "https://x.com/asepadfun", label: "X", icon: XIcon }
] as const;

export function NavRail() {
  const pathname = usePathname();
  const path = pathname ?? "";
  // Clicking a parent with children pins the rail open so sub-pages stay
  // reachable without holding the hover. Clicking it again (or another
  // top-level link) collapses back to icon-only.
  const [pinned, setPinned] = useState(false);
  const reveal = pinned ? "opacity-100" : "opacity-0 group-hover:opacity-100";

  return (
    <aside
      className={cn(
        "group fixed inset-y-0 left-0 z-50 hidden flex-col border-r border-white/10 bg-black/85 backdrop-blur-2xl transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] will-change-[width] md:flex",
        pinned ? "w-52 shadow-[16px_0_48px_-12px_rgba(0,0,0,0.8)]" : "w-14 hover:w-52 hover:shadow-[16px_0_48px_-12px_rgba(0,0,0,0.8)]"
      )}
      aria-label="Main navigation"
    >
      {/* nav — top padding clears the floating brand mark rendered by RootLayout */}
      <nav className="flex-1 space-y-1 overflow-y-auto overflow-x-hidden px-2 pb-3 pt-16">
        {navLinks.map((item) => {
          const active = navIsActive(path, item.href);
          return (
            <div key={item.href}>
              {item.children ? (
                // Parent with children: click toggles the child menu — it never
                // navigates; the user picks a child (or clicks again to close).
                <button
                  type="button"
                  aria-expanded={pinned}
                  title={item.label}
                  onClick={() => setPinned((p) => !p)}
                  className={cn(
                    "relative flex h-10 w-full items-center gap-3 overflow-hidden rounded-lg px-3 transition-colors",
                    active
                      ? "bg-white/10 text-white"
                      : "text-white/55 hover:bg-white/[0.06] hover:text-white"
                  )}
                >
                  {active && <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-chrome-200" />}
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.labelImg ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.labelImg} alt={item.label} className={cn("h-5 w-[62px] object-fill object-left transition-opacity duration-150", reveal, item.labelImgCls)} />
                  ) : (
                    <span className={cn("whitespace-nowrap text-[13px] font-medium transition-opacity duration-150", reveal)}>
                      {item.label}
                    </span>
                  )}
                  <ChevronDown className={cn(
                    "ml-auto h-3.5 w-3.5 shrink-0 text-white/50 transition-all duration-200",
                    reveal, pinned && "rotate-180"
                  )} />
                </button>
              ) : (
                <Link
                  href={siteHref(item.href)}
                  prefetch={!/^https?:/.test(siteHref(item.href))}
                  aria-current={active ? "page" : undefined}
                  title={item.label}
                  onClick={() => setPinned(false)}
                  className={cn(
                    "relative flex h-10 items-center gap-3 overflow-hidden rounded-lg px-3 transition-colors",
                    active
                      ? "bg-white/10 text-white"
                      : "text-white/55 hover:bg-white/[0.06] hover:text-white"
                  )}
                >
                {active && <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-chrome-200" />}
                <item.icon className="h-4 w-4 shrink-0" />
                {item.labelImg ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.labelImg} alt={item.label} className={cn("h-5 w-[62px] object-fill object-left transition-opacity duration-150", reveal, item.labelImgCls)} />
                ) : (
                  <span className={cn("whitespace-nowrap text-[13px] font-medium transition-opacity duration-150", reveal)}>
                    {item.label}
                  </span>
                )}
              </Link>
              )}
              {item.children ? (
                // Children reveal on click only — hovering the rail no longer pops them.
                <div className={cn(
                  "ml-5 space-y-0.5 overflow-hidden border-l border-white/10 pl-2 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
                  pinned ? "ml-[18px] max-h-48 py-1 opacity-100" : "max-h-0 opacity-0"
                )}>
                  {item.children.map((c) => {
                    const cActive = childActive(path, c.href);
                    const cHref = siteHref(c.href);
                    return (
                      <Link
                        key={c.href}
                        href={cHref}
                        prefetch={!/^https?:/.test(cHref)}
                        aria-current={cActive ? "page" : undefined}
                        onClick={(e) => { asedexInAppNav(e, cHref); setPinned(false); }}
                        className={cn(
                          "flex items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors",
                          cActive ? "bg-white/[0.08] text-white" : "text-white/50 hover:bg-white/[0.05] hover:text-white/85"
                        )}
                      >
                        <c.icon className="h-3.5 w-3.5 shrink-0" />
                        {c.labelImg ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.labelImg} alt={c.label} className={cn("h-4 w-auto object-fill object-left", c.labelImgCls)} />
                        ) : (
                          c.label
                        )}
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>

      {/* official channels — desktop connect lives in the top-right header,
          mobile keeps its own connect inside the slide-out nav */}
      <div className="shrink-0 space-y-1 border-t border-white/10 p-2">
        {socialLinks.map((s) => (
          <a
            key={s.href}
            href={s.href}
            target="_blank"
            rel="noreferrer"
            title={s.label}
            className="flex h-10 w-full items-center gap-3 overflow-hidden rounded-lg px-3 text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            <s.icon className="h-4 w-4 shrink-0" />
            <span className={cn("whitespace-nowrap text-[13px] font-medium transition-opacity duration-150", reveal)}>
              {s.label}
            </span>
          </a>
        ))}
      </div>
    </aside>
  );
}

/** Floating top-right wallet chip — desktop only (mobile keeps connect inside
 *  its slide-out plus the address chip next to the hamburger). Connected =
 *  green-dot pill that opens an account menu: address, copy, explorer,
 *  disconnect. */
export function WalletChip() {
  const wallet = useWalletStore();
  const connected = wallet.status === "connected" && Boolean(wallet.address);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => { if (!connected) setOpen(false); }, [connected]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(t);
  }, [copied]);

  const copyAddress = () => {
    if (!wallet.address) return;
    navigator.clipboard?.writeText(wallet.address).then(() => setCopied(true)).catch(() => {});
  };

  return (
    <div className="fixed right-3.5 top-3.5 z-[60] hidden md:block">
      {connected ? (
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            title={shortenAddress(wallet.address!, 9, 4)}
            className="flex items-center gap-1.5 rounded-full border border-white/10 bg-[#07080d]/90 py-1.5 pl-3 pr-2 font-mono text-[11px] text-white/75 shadow-[0_4px_20px_-6px_rgba(0,0,0,0.8)] backdrop-blur-xl transition-colors hover:border-white/20 hover:text-white"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {shortenAddress(wallet.address!, 9, 4)}
            <ChevronDown className={cn("ml-0.5 h-3 w-3 text-white/40 transition-transform", open && "rotate-180")} />
          </button>
          {open ? (
            <>
              {/* click-outside layer — sits under the menu, above the page */}
              <div className="fixed inset-0 cursor-default" onClick={() => setOpen(false)} />
              <div className="absolute right-0 top-full mt-2 w-56 overflow-hidden rounded-xl border border-white/[0.12] bg-[#0b0d14] p-1 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.9)]">
                <button
                  type="button"
                  onClick={copyAddress}
                  className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[12px] font-medium text-white/70 transition-colors hover:bg-white/[0.07] hover:text-white"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy address"}
                </button>
                <a
                  href={`https://explorer.asentum.com/address/${wallet.address}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setOpen(false)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[12px] font-medium text-white/70 transition-colors hover:bg-white/[0.07] hover:text-white"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  View on explorer
                </a>
                <button
                  type="button"
                  onClick={() => { setOpen(false); void wallet.disconnect(); }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[12px] font-medium text-red-300/90 transition-colors hover:bg-red-500/10 hover:text-red-200"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Disconnect
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          onClick={wallet.openConnect}
          disabled={wallet.status === "connecting"}
          className="flex items-center gap-2 rounded-full border border-white/10 bg-[#07080d]/90 px-4 py-1.5 text-[12px] font-medium text-chrome-200 shadow-[0_4px_20px_-6px_rgba(0,0,0,0.8)] backdrop-blur-xl transition-colors hover:border-white/25 hover:text-white disabled:opacity-50"
        >
          <Wallet className="h-3.5 w-3.5" />
          {wallet.status === "connecting" ? "Connecting…" : "Connect wallet"}
        </button>
      )}
    </div>
  );
}
