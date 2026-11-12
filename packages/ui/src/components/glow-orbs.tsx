"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/cn";

/** Ambient orbs — same layout as original cyan/purple, recolored to ash / light ash. */
export function GlowOrbs({ className }: { className?: string }) {
  return (
    <div className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <motion.div
        className="absolute -left-32 -top-40 h-[520px] w-[520px] rounded-full bg-[#e8e8e8]/14 blur-3xl"
        animate={{ y: [0, 18, 0], x: [0, 8, 0] }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute -right-40 top-10 h-[640px] w-[640px] rounded-full bg-[#a8a8a8]/16 blur-3xl"
        animate={{ y: [0, -22, 0], x: [0, -10, 0] }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute left-1/2 top-[40%] h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-[#d4d4d4]/10 blur-3xl"
        animate={{ y: [0, 14, 0] }}
        transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}
