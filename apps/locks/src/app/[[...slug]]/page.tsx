"use client";

import { usePathname } from "next/navigation";
import { LockApp } from "../lock-app";
import { LockDetail } from "../lock-detail";

export default function LocksRoute() {
  const routerPath = usePathname();
  const pathname = typeof window === "undefined" ? routerPath : window.location.pathname;
  const segs = (pathname?.split("/").filter(Boolean) ?? []).map(decodeURIComponent);
  // /lock/<id>, /lock/v2/<id>, plus legacy /<id>, /v2/<id>
  if (segs[0] === "lock") {
    if (segs[1] === "v2" && segs[2]) return <LockDetail id={segs[2]} v="2" />;
    if (segs[1]) return <LockDetail id={segs[1]} />;
  }
  if (segs[0] === "v2" && segs[1] && segs[1] !== "_") return <LockDetail id={segs[1]} v="2" />;
  if (segs[0] && segs[0] !== "_") return <LockDetail id={segs[0]} />;
  return <LockApp />;
}
