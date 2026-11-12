"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWalletStore } from "@/stores/wallet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MobileNav } from "@/components/layout/mobile-nav";
import { BrandLogo } from "@/components/brand/brand-logo";
import { shortenAddress } from "@/lib/asepad";
import { cn } from "@/lib/cn";
import { Layers, ArrowLeftRight } from "lucide-react";

const navLinks = [
  { href: "/create", label: "Create Token", icon: Layers },
  { href: "/asepad", label: "AsePad", mark: true },
  { href: "/asedex", label: "AseDex", icon: ArrowLeftRight }
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/asepad") return pathname === "/asepad" || pathname.startsWith("/asepad/token");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteHeader() {
  const wallet = useWalletStore();
  const pathname = usePathname();

  return (
    <>
    <header className="sticky top-0 z-50 hidden border-b border-white/[0.06] bg-black/40 backdrop-blur-2xl md:block">
      <div className="mx-auto grid h-[4.5rem] max-w-7xl grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 sm:h-[5.5rem]">
        {/* brand */}
        <div className="flex shrink-0 items-center">
          <BrandLogo variant="full" className="hidden sm:block" height={56} />
          <BrandLogo variant="mark" className="sm:hidden" height={38} />
        </div>

        {/* centered pill nav — desktop */}
        <nav
          className="hidden items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] md:flex"
          aria-label="Main"
        >
          {navLinks.map((item) => {
            const active = isActive(pathname ?? "", item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-all",
                  active
                    ? "bg-white/10 text-white shadow-[0_1px_8px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.08)]"
                    : "text-white/55 hover:bg-white/[0.06] hover:text-white"
                )}
              >
                {"mark" in item ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src="/brand/asepad-mark.png" alt="" className={cn("h-4 w-4 object-contain transition-opacity", active ? "" : "opacity-40 grayscale group-hover:opacity-100 group-hover:grayscale-0")} />
                ) : (
                  <item.icon className={cn("h-3.5 w-3.5 transition-colors", active ? "text-chrome-200" : "text-white/55 group-hover:text-chrome-300")} />
                )}
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* wallet */}
        <div className="flex min-w-0 items-center justify-end gap-2">
          {wallet.status === "connected" && wallet.address ? (
            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] p-1 pl-3">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span className="hidden font-mono text-xs text-white/70 sm:inline">{shortenAddress(wallet.address, 8, 4)}</span>
              <Button variant="secondary" size="sm" className="rounded-full" onClick={() => void wallet.disconnect()}>
                Disconnect
              </Button>
            </div>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              className="rounded-full px-5"
              disabled={wallet.status === "connecting"}
              onClick={wallet.openConnect}
            >
              {wallet.status === "connecting" ? "Connecting…" : "Connect wallet"}
            </Button>
          )}
        </div>
      </div>
    </header>
    <MobileNav />
    </>
  );
}
