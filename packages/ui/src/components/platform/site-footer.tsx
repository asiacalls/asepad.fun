import type { ReactNode } from "react";
import Link from "next/link";
import { BrandLogo } from "@/components/brand/brand-logo";
import { ArrowUpRight } from "lucide-react";
import { network } from "@/lib/network";
import { SocialLinks } from "@/components/social-links";
import { href as siteHref } from "@/lib/site";

const productLinks = [
  { href: "/create", label: "Create token" },
  { href: "/asepad", label: "AsePad launches" },
  { href: "/asedex", label: "AseDex exchange" },
  { href: "/asevault", label: "AseVault wallet" },
  { href: "/docs", label: "Docs" }
] as const;

const resourceLinks = [
  { href: "https://www.asentum.com", label: "About Asentum" },
  { href: "https://www.asentum.com/developers", label: "Developers" },
  { href: network.explorerBaseUrl ?? "https://testnet.asentum.com", label: "Explorer" },
  { href: "https://testnet.asentum.com/playground", label: "Playground" }
] as const;

function FooterNavLink({ href, label, external }: { href: string; label: string; external?: boolean }) {
  const className =
    "group inline-flex items-center gap-1 text-[13px] text-white/65 transition-colors duration-200 hover:text-white";
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
        {label}
        <ArrowUpRight className="h-3 w-3 opacity-0 transition group-hover:opacity-60" />
      </a>
    );
  }
  // Cross-app paths resolve to absolute subdomain URLs via siteHref; those
  // render as plain anchors — next/link prefetch would 404 on a route this
  // app doesn't own.
  const resolved = siteHref(href);
  if (/^https?:/.test(resolved)) {
    return <a href={resolved} className={className}>{label}</a>;
  }
  return <Link href={resolved} className={className}>{label}</Link>;
}

function LinkGroup({ title, links, external }: { title: string; links: readonly { href: string; label: string }[]; external?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/50">{title}</p>
      <ul className="mt-3.5 flex flex-col gap-2.5">
        {links.map((item) => (
          <li key={item.href}>
            <FooterNavLink href={item.href} label={item.label} external={external} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Site footer, chrome / black theme (matches header + landing).
 * Compact single-band layout: brand strip, links, legal row.
 */
export function SiteFooter() {
  const year = new Date().getFullYear();
  const networkLabel = network.name ?? "Asentum Testnet";

  return (
    <footer className="relative mt-20 border-t border-white/[0.06]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-grad-border opacity-40" aria-hidden />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white/[0.03] to-transparent" aria-hidden />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* main band — mobile: brand on top, link groups side by side */}
        <section className="grid grid-cols-2 gap-x-6 gap-y-8 py-10 lg:grid-cols-[1.4fr_1fr_1fr_1fr] lg:gap-8">
          <div className="col-span-2 lg:col-span-1">
            <BrandLogo link={false} height={52} className="opacity-95" />
            <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-white/65">
              The first post-quantum launchpad on Asentum. Bonding-curve launches, instant markets, and AseDex liquidity.
            </p>
            <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] text-white/60">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
              {networkLabel}
            </p>
            <SocialLinks className="mt-5" />
          </div>

          <LinkGroup title="Product" links={productLinks} />
          <LinkGroup title="Network" links={resourceLinks} external />
          <LinkGroup
            title="Quick"
            links={[
              { href: "/create", label: "Start a bonding curve" },
              { href: "/asedex", label: "Swap on AseDex" },
              { href: "/asepad", label: "Live launches" }
            ]}
          />
        </section>

        {/* legal bar */}
        <section className="flex flex-col items-center justify-between gap-3 border-t border-white/[0.06] py-5 sm:flex-row">
          <p className="text-[11px] text-white/55">© {year} AsePad. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <Link prefetch={false} href={siteHref("/privacypolicy")} className="text-[11px] text-white/55 transition hover:text-white">Privacy Policy</Link>
            <Link prefetch={false} href={siteHref("/docs")} className="text-[11px] text-white/55 transition hover:text-white">Docs</Link>
          </div>
          <p className="text-center text-[11px] text-white/45 sm:text-right">
            Built on <span className="text-white/60">Asentum</span> · Fully contract-backed
          </p>
        </section>
      </div>
    </footer>
  );
}
