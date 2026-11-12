"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium backdrop-blur transition-colors",
  {
    variants: {
      variant: {
        default: "border-chrome-500/25 bg-white/[0.06] text-chrome-300",
        chrome: "border-chrome-400/30 bg-white/[0.08] text-chrome-200",
        purple: "border-steel-500/30 bg-white/[0.05] text-steel-400",
        neutral: "border-white/10 bg-white/[0.04] text-white/65"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
