import type { Metadata, Viewport } from "next";
import { Orbitron, Space_Grotesk } from "next/font/google";
import Link from "next/link";
import "../../../../packages/ui/src/globals.css";
import { Providers } from "./providers";
import { NavRail, WalletChip } from "@/components/platform/nav-rail";
import { MobileNav } from "@/components/layout/mobile-nav";
import { SiteFooterGate } from "@/components/platform/site-footer-gate";
import { PlatformBackdrop } from "@/components/motion/platform-backdrop";
import { PageTransition } from "@/components/motion/page-transition";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://asepad.fun";
const SITE_DESC = "AsePad is the fully on-chain launchpad and exchange on Asentum. Create ARC-20 tokens, launch on a bonding curve, trade on AseDex, and provide liquidity with LP burned forever.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: "AsePad",
  title: {
    default: "AsePad | Launchpad + Exchange on Asentum",
    template: "%s | AsePad"
  },
  description: SITE_DESC,
  keywords: [
    "AsePad", "AseDex", "Asentum", "ASE", "token launchpad", "bonding curve",
    "decentralized exchange", "DEX", "create token", "ARC-20", "tax token",
    "crypto launchpad", "on-chain exchange", "liquidity pool", "fair launch"
  ],
  creator: "AsePad",
  publisher: "AsePad",
  category: "finance",
  alternates: { canonical: "/" },
  formatDetection: { telephone: false, email: false, address: false },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 }
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: "AsePad",
    title: "AsePad | Launchpad + Exchange on Asentum",
    description:
      "Bonding-curve launches, instant markets, and AseDex liquidity. LP burned forever, no rugs by design.",
    images: [{ url: "/brand/og-card.png", width: 1200, height: 630, alt: "AsePad: launch tokens on Asentum" }]
  },
  twitter: {
    card: "summary_large_image",
    site: "@asepadfun",
    creator: "@asepadfun",
    title: "AsePad | Launchpad + Exchange on Asentum",
    description:
      "Bonding-curve launches, instant markets, and AseDex liquidity. LP burned forever, no rugs by design.",
    images: ["/brand/og-card.png"]
  }
};

export const viewport: Viewport = {
  themeColor: "#06060b",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#org`,
      name: "AsePad",
      url: SITE_URL,
      logo: { "@type": "ImageObject", url: `${SITE_URL}/brand/og-card.png`, width: 1200, height: 630 },
      sameAs: ["https://x.com/asepadfun", "https://t.me/asepadfun"]
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#site`,
      url: SITE_URL,
      name: "AsePad",
      description: SITE_DESC,
      inLanguage: "en",
      publisher: { "@id": `${SITE_URL}/#org` }
    }
  ]
};

const sans = Space_Grotesk({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const brand = Orbitron({ subsets: ["latin"], variable: "--font-brand", display: "swap" });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${sans.variable} ${brand.variable}`}>
      <body className="min-h-screen font-sans antialiased">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
        <PlatformBackdrop />
        {/* Floating brand mark — top-left on every page, outside the nav rail */}
        <Link href="/" aria-label="AsePad home" className="fixed left-3 top-3 z-[60] flex items-center gap-2.5 transition-transform duration-200 hover:scale-[1.03] md:left-3.5 md:top-3.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/asepad-mark.png" alt="AsePad" className="h-9 w-9 shrink-0 object-contain drop-shadow-[0_2px_12px_rgba(0,0,0,0.7)] md:h-10 md:w-10" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/asepadtitle.png" alt="" className="h-9 w-auto object-contain drop-shadow-[0_2px_10px_rgba(0,0,0,0.7)] md:h-10" />
        </Link>
        <Providers>
          <NavRail />
          <WalletChip />
          <MobileNav />
          <div className="md:pl-14">
            <PageTransition>{children}</PageTransition>
            <SiteFooterGate />
          </div>
          <div aria-hidden className="h-6 md:hidden" />
        </Providers>
      </body>
    </html>
  );
}

