"use client";

import { motion } from "framer-motion";
import { usePathname } from "next/navigation";

// Sections that change their own URL in place (AseDex views + pair links) must
// keep one key — a pathname key remounted the whole app on every click.
const IN_PLACE_SECTIONS = ["/asedex"];

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const key = IN_PLACE_SECTIONS.find((s) => pathname === s || pathname.startsWith(`${s}/`)) ?? pathname;

  return (
    <motion.div
      key={key}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
