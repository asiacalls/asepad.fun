import { cn } from "@/lib/cn";

export function GlassPanel({
  children,
  className,
  glow = false
}: {
  children: React.ReactNode;
  className?: string;
  glow?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6 backdrop-blur-xl",
        "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]",
        glow && "shadow-glow transition hover:border-chrome-500/25 hover:shadow-glowStrong",
        className
      )}
    >
      {children}
    </div>
  );
}
