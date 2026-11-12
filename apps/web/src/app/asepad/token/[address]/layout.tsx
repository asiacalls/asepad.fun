import type { Metadata } from "next";
import { fetchLaunchMeta } from "./og-data";

// Only the "_" shell is prebuilt — public/_redirects serves it for every
// /asepad/token/* URL and the page reads the real address from the URL.
// Per-token pages were dropped deliberately: thousands of near-identical
// HTML files made every deploy a multi-thousand-file upload, and shared
// links get the platform OG card either way.
export async function generateStaticParams() {
  return [{ address: "_" }];
}

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const { address } = await params;
  const launch = address === "_" ? null : await fetchLaunchMeta(address);
  const title = launch ? `$${launch.symbol} on AsePad` : "Token";
  return {
    title,
    description: launch
      ? `${launch.name} on AsePad: live price, trades, holders and bonding-curve migration to AseDex on Asentum.`
      : "AsePad bonding-curve token on Asentum: live price, trades, holders and migration to AseDex.",
    openGraph: {
      title,
      description: launch ? `${launch.name} on AsePad, the launchpad + exchange on Asentum.` : "AsePad bonding-curve token on Asentum."
    }
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
