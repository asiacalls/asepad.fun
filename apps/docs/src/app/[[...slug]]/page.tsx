import type { Metadata } from "next";
import { DocsApp } from "../docs-app";
import { DOC_META } from "../docs-meta";

// Prebuilt doc pages (needed for the static export; harmless otherwise).
export function generateStaticParams() {
  return [
    [], ["welcome"], ["getting-started"], ["create-token"], ["launch-page"], ["bonding-curve"],
    ["migration"], ["terminal"], ["orders"], ["markets"], ["wallet"], ["token-lock"], ["asevault"], ["auras"], ["auradex"], ["fees-safety"], ["contracts"]
  ].map((slug) => ({ slug }));
}

// Old /docs/auradex links alias to the renamed AURAS page.
const canonSlug = (s?: string) => (s === "auradex" ? "auras" : s) ?? "welcome";

export async function generateMetadata({ params }: { params: Promise<{ slug?: string[] }> }): Promise<Metadata> {
  const { slug } = await params;
  const s = canonSlug(slug?.[0]);
  const doc = DOC_META[s];
  const title = s === "welcome" ? "Docs" : (doc?.title ?? "Docs");
  const description = doc?.intro ?? "AsePad documentation: launches, bonding curves, migration, and the AseDex terminal explained.";
  return {
    title,
    description,
    alternates: { canonical: `/${s}` },
    openGraph: { title: `${title} | AsePad Docs`, description, url: `/${s}` }
  };
}

export default async function DocsPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  return <DocsApp slug={canonSlug(slug?.[0])} />;
}
