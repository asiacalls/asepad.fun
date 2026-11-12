"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Wallet } from "lucide-react";
import { cn } from "@/lib/cn";
import { useWalletStore } from "@/stores/wallet";
import { shortenAddress } from "@/lib/asepad";
import { navIsActive, navLinks, socialLinks } from "@/components/platform/nav-rail";
import { asedexInAppNav } from "@/lib/asedex-nav";
import { href as siteHref, appPath, APP } from "@/lib/site";

// Material-style out-curve: fast start, long gentle settle — no "stuck" feel.
const EASE = "ease-[cubic-bezier(0.32,0.72,0,1)]";

export function MobileNav() {
  const pathname = usePathname();
  const path = pathname ?? "";
  const wallet = useWalletStore();
  const connected = wallet.status === "connected" && Boolean(wallet.address);
  const [open, setOpen] = useState(false);
  const [dexOpen, setDexOpen] = useState(false);

  // Route change closes the drawer; lock body scroll while it's open.
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <>
    {/* ── hamburger — animated 3-line ↔ X, top-right on mobile ─────── */}
    <button
      type="button"
      aria-label={open ? "Close menu" : "Open menu"}
      aria-expanded={open}
      onClick={() => setOpen((o) => !o)}
      className="fixed right-3 top-3 z-[70] flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-[#07080d]/90 shadow-[0_4px_20px_-6px_rgba(0,0,0,0.8)] backdrop-blur-xl transition-transform duration-150 active:scale-95 md:hidden"
    >
      <span className="relative block h-4 w-5">
        <span className={cn("absolute left-0 top-0 h-[1.5px] w-full rounded-full bg-white transition-all duration-300", EASE, open && "top-1/2 -translate-y-1/2 rotate-45")} />
        <span className={cn("absolute left-0 top-1/2 h-[1.5px] w-full -translate-y-1/2 rounded-full bg-white transition-all duration-200 ease-out", open && "scale-x-0 opacity-0")} />
        <span className={cn("absolute bottom-0 left-0 h-[1.5px] w-full rounded-full bg-white transition-all duration-300", EASE, open && "bottom-1/2 translate-y-1/2 -rotate-45")} />
      </span>
    </button>

    {/* ── slide-in menu — same items + AseDex children as the rail ──
        Kept mounted and animated with a pure transform transition so the
        slide is GPU-composited (no mount/exit jank). `visibility` flips at
        the end of the close transition automatically. */}
    <div
      aria-hidden={!open}
      onClick={() => setOpen(false)}
      className={cn("fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm transition-[opacity,visibility] duration-300 ease-out md:hidden",
        open ? "visible opacity-100" : "invisible opacity-0")}
    />
    <aside
      aria-hidden={!open}
      aria-label="Menu"
      className={cn("fixed inset-y-0 right-0 z-[65] flex w-72 max-w-[85vw] flex-col border-l border-white/10 bg-[#07080d]/95 shadow-[-24px_0_64px_-16px_rgba(0,0,0,0.9)] backdrop-blur-2xl transition-[transform,visibility] duration-300 will-change-transform md:hidden", EASE,
        open ? "visible translate-x-0" : "invisible translate-x-full")}
    >
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4 pt-16">
        {navLinks.map((item) => {
          const active = navIsActive(path, item.href);
          return (
            <div key={item.href}>
              {item.children ? (
                <button
                  type="button"
                  aria-expanded={dexOpen}
                  onClick={() => setDexOpen((o) => !o)}
                  className={cn("flex h-11 w-full items-center gap-3 rounded-xl px-3 transition-colors",
                    active ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/[0.06] hover:text-white")}
                >
                  <item.icon className="h-[18px] w-[18px] shrink-0" />
                  <span className="text-[14px] font-medium">{item.label}</span>
                  <ChevronDown className={cn("ml-auto h-4 w-4 text-white/45 transition-transform duration-200", dexOpen && "rotate-180")} />
                </button>
              ) : (
                <Link
                  prefetch={false}
                  href={siteHref(item.href)}
                  aria-current={active ? "page" : undefined}
                  className={cn("flex h-11 items-center gap-3 rounded-xl px-3 transition-colors",
                    active ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/[0.06] hover:text-white")}
                >
                  <item.icon className="h-[18px] w-[18px] shrink-0" />
                  <span className="text-[14px] font-medium">{item.label}</span>
                </Link>
              )}
              {item.children ? (
                <div className={cn("ml-5 space-y-0.5 overflow-hidden border-l border-white/10 pl-2.5 transition-all duration-300", EASE,
                  dexOpen ? "max-h-64 py-1 opacity-100" : "max-h-0 opacity-0")}>
                  {item.children.map((c) => {
                    const cLocal = (() => { const l = appPath(c.href); return APP !== "web" && l && l.app === APP ? l.path : c.href; })();
                    const cActive = path === cLocal || path.startsWith(`${cLocal}/`);
                    const cHref = siteHref(c.href);
                    return (
                      <Link
                        key={c.href}
                        prefetch={false}
                        href={cHref}
                        aria-current={cActive ? "page" : undefined}
                        onClick={(e) => { if (asedexInAppNav(e, cHref)) setOpen(false); }}
                        className={cn("flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
                          cActive ? "bg-white/[0.08] text-white" : "text-white/50 hover:bg-white/[0.05] hover:text-white/85")}
                      >
                        <c.icon className="h-4 w-4 shrink-0" />
                        {c.label}
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
        {/* official channels — same icon+label rows as the rail's foot */}
        <div className="mt-2 space-y-1 border-t border-white/10 pt-2">
          {socialLinks.map((s) => (
            <a
              key={s.href}
              href={s.href}
              target="_blank"
              rel="noreferrer"
              className="flex h-11 items-center gap-3 rounded-xl px-3 text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              <s.icon className="h-[18px] w-[18px] shrink-0" />
              <span className="text-[14px] font-medium">{s.label}</span>
            </a>
          ))}
        </div>
      </nav>

      {/* wallet */}
      <div className="shrink-0 border-t border-white/10 p-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}>
        {connected && wallet.address ? (
          <button
            type="button"
            onClick={() => void wallet.disconnect()}
            className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-white/70 transition-colors hover:bg-white/[0.06]"
          >
            <span className="relative flex h-[18px] w-[18px] shrink-0 items-center justify-center">
              <Wallet className="h-[18px] w-[18px] text-emerald-300" />
              <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            <span className="font-mono text-[13px]">{shortenAddress(wallet.address, 8, 6)}</span>
            <span className="ml-auto text-[11px] text-white/45">disconnect</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={wallet.openConnect}
            disabled={wallet.status === "connecting"}
            className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-chrome-200 transition-colors hover:bg-white/[0.08] disabled:opacity-50"
          >
            <Wallet className="h-[18px] w-[18px] shrink-0" />
            <span className="text-[14px] font-medium">{wallet.status === "connecting" ? "Connecting…" : "Connect wallet"}</span>
          </button>
        )}
      </div>
    </aside>

    {/* connected address chip — floating top-right on mobile, left of the hamburger */}
    {connected ? (
      <div className="fixed right-[3.75rem] top-3 z-50 flex items-center gap-1.5 rounded-full border border-white/10 bg-[#07080d]/90 py-1.5 pl-3 pr-2 font-mono text-[11px] text-white/75 shadow-[0_4px_20px_-6px_rgba(0,0,0,0.8)] backdrop-blur-xl md:hidden">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        {shortenAddress(wallet.address!, 6, 4)}
      </div>
    ) : null}
    </>
  );
}
