import type { Metadata } from "next";
import { AsevaultPage } from "@/components/pages/asevault";

export const metadata: Metadata = {
  title: "AseVault Wallet",
  description:
    "AseVault is the post-quantum wallet for Asentum, a product of asepad.fun. Hold ASE and ARC-20 tokens, trade on AseDex and AURAS, buy AsePad launches, and connect to dApps.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "AseVault | Post-Quantum Wallet for Asentum",
    description:
      "The post-quantum wallet for Asentum, a product of asepad.fun. Download the Android APK and carry the whole network in your pocket.",
    url: "/asevault"
  }
};

export default function Page() {
  return <AsevaultPage />;
}
