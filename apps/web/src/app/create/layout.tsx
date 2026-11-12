import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create Token",
  description: "Deploy a token on Asentum: AsePad bonding-curve launch, standard ARC-20, or a tax token with locked buy and sell fees.",
  alternates: { canonical: "/create" },
  openGraph: {
    title: "Create a Token | AsePad",
    description: "Deploy a token on Asentum: bonding-curve launch, standard ARC-20, or a tax token.",
    url: "/create"
  }
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
