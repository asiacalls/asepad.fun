import type { Metadata } from "next";

// Only the "_" shell is prebuilt — public/_redirects serves it for every
// /lock/* URL and the page reads the real lock id from the URL (same pattern
// as /asepad/token/*).
export async function generateStaticParams() {
  return [{ id: "_" }];
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const title = id && id !== "_" ? `Lock #${id}` : "Lock details";
  return {
    title,
    description: "Verified on-chain lock on AseLock: locked amount, unlock date, owner and vesting schedule on Asentum.",
    openGraph: { title: `${title} · AseLock`, description: "Verified on-chain token / LP lock on Asentum." }
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
