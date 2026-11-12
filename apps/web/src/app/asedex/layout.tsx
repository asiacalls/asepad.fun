import type { Metadata } from "next";
import AseDexApp from "./asedex-app";

export const metadata: Metadata = {
  title: { absolute: "AseDex | Swap, Pools & Liquidity" },
  description: "Trade every token on Asentum: swaps, liquidity pools, limit and DCA orders on AseDex, the fully on-chain AsePad exchange.",
  alternates: { canonical: "/asedex" },
  openGraph: {
    title: "AseDex | Swap, Pools & Liquidity",
    description: "Trade every token on Asentum: swaps, liquidity pools, limit and DCA orders on AseDex.",
    url: "/asedex"
  }
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AseDexApp />
      {children}
    </>
  );
}
