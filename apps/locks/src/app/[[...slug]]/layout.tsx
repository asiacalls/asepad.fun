import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Token Lock",
  description:
    "Lock AseDex LP shares, ARC-20 tokens and vesting schedules on-chain. Every lock is verifiable on Asentum. Unlock, claim and transfer from the same dashboard."
};

// The "_" shell is the single prebuilt page — public/_redirects serves it for
// every /<id> and /v2/<id> URL; the page reads the real lock id from the URL.
export async function generateStaticParams() {
  return [{ slug: [] }, { slug: ["_"] }];
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
