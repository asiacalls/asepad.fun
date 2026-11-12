import Image from "next/image";
import Link from "next/link";
import { href as siteHref } from "@/lib/site";

type BrandLogoVariant = "full" | "mark";

interface BrandLogoProps {
  variant?: BrandLogoVariant;
  link?: boolean;
  className?: string;
  /** Pixel height override; defaults to 34 (mark) / 44 (full). */
  height?: number;
}

export function BrandLogo({ variant = "full", link = true, className = "", height }: BrandLogoProps) {
  const h = height ?? (variant === "mark" ? 34 : 44);
  const logo = (
    <Image
      src="/brand/asepad-logo.png"
      alt="AsePad"
      width={790}
      height={316}
      className="w-auto"
      style={{ height: h }}
      priority
    />
  );
  return (
    <span className={`inline-flex items-center ${className}`}>
      {link ? (
        <Link prefetch={false} href={siteHref("/")} aria-label="AsePad home">
          {logo}
        </Link>
      ) : (
        logo
      )}
      <span className="sr-only">AsePad</span>
    </span>
  );
}
