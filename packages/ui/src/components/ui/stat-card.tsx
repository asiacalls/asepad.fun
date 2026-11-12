"use client";

import { GlassPanel } from "@/components/ui/glass-panel";
import { AnimatedCounter } from "@/components/motion/animated-counter";
import { cn } from "@/lib/cn";

export function StatCard({
  label,
  value,
  suffix,
  className
}: {
  label: string;
  value: number;
  suffix?: string;
  className?: string;
}) {
  return (
    <GlassPanel glow className={cn("relative overflow-hidden", className)}>
      <div className="text-[11px] font-semibold tracking-[0.18em] text-white/70">{label}</div>
      <AnimatedCounter value={value} suffix={suffix} className="mt-2 block text-3xl font-semibold text-cyan-400" />
    </GlassPanel>
  );
}
