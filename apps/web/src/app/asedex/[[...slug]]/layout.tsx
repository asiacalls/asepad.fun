import type { Metadata } from "next";
import { fetchPoolMeta, isTerminalPoolSlug } from "@/lib/asedex-og-data";

// Only the view shells are prebuilt — public/_redirects serves terminal.html
// for every /asedex/terminal/* URL and the page reads the real pool from the
// URL. Per-pool pages were dropped deliberately: hundreds of near-identical
// HTML files bloated every deploy, and shared links get the platform OG
// card either way.
export async function generateStaticParams() {
  return [[], ["markets"], ["radar"], ["terminal"], ["pools"], ["wallet"], ["wallets"]].map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug?: string[] }> }): Promise<Metadata> {
  const { slug } = await params;
  if (!isTerminalPoolSlug(slug)) return {};
  const pool = await fetchPoolMeta(slug);
  if (!pool) return {};
  const pair = `${pool.symbol}/${pool.quote}`;
  return {
    title: `${pair} · AseDex`,
    description: `Trade ${pool.name} on AseDex: ${pair} pool #${pool.poolId} on Asentum, fully on-chain.`,
    openGraph: {
      title: `${pair} · Trade on AseDex`,
      description: `Trade ${pool.name} on AseDex, the fully on-chain AsePad exchange on Asentum.`
    }
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
