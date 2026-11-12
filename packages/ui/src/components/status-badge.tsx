import { Flame, Gem, Waves, type LucideIcon } from "lucide-react";
import { statusBadge, type AsepadLaunch, type StatusBadgeIcon } from "@/lib/asepad";
import { cn } from "@/lib/cn";

const ICONS: Record<Exclude<StatusBadgeIcon, "pulse">, LucideIcon> = {
  gem: Gem,
  waves: Waves,
  flame: Flame,
  migrate: Waves
};

export function StatusBadge({
  status,
  lpBurned,
  className,
  liveLabel
}: {
  status: AsepadLaunch["status"] | string;
  lpBurned?: boolean;
  className?: string;
  /** Compact label for the migrated-and-burned state in dense list views. */
  liveLabel?: string;
}) {
  const badge = statusBadge(status as AsepadLaunch["status"], lpBurned);
  const Icon = badge.icon === "pulse" ? null : ICONS[badge.icon];
  const label = liveLabel && badge.label === "LIVE ON ASEDEX" ? liveLabel : badge.label;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold", badge.cls, className)}>
      {Icon ? (
        <Icon className="h-3 w-3" />
      ) : (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300 shadow-[0_0_6px_rgba(52,211,153,0.9)]" />
      )}
      {label}
    </span>
  );
}
