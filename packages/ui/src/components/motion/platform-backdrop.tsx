"use client";

import { GlowOrbs } from "@/components/glow-orbs";
import { ParticleField } from "@/components/motion/particle-field";

/** Global backdrop: subtle grid, silver orbs, particles on pure black. */
export function PlatformBackdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-black">
      <div className="absolute inset-0 bg-grid-mesh opacity-[0.35]" />
      <div className="absolute inset-0 bg-grid-fade opacity-90" />
      <div className="absolute inset-0 bg-scanlines opacity-[0.03]" />
      <GlowOrbs className="absolute inset-0" />
      <ParticleField className="absolute inset-0" count={72} />
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black" />
      <div className="absolute inset-x-0 top-0 h-px bg-grad-border opacity-30" />
    </div>
  );
}
