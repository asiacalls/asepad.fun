import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Bonding-Curve Launches",
  description: "Browse live AsePad bonding-curve launches on Asentum: just launched, trending, near bonding and migrated tokens.",
  alternates: { canonical: "/asepad" },
  openGraph: {
    title: "AsePad Launches | Bonding-Curve Tokens on Asentum",
    description: "Browse live bonding-curve launches on Asentum: just launched, trending, near bonding and migrated.",
    url: "/asepad"
  }
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
