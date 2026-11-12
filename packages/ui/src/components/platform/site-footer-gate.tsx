"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { SiteFooter } from "./site-footer";

// The pair terminal and token page run as an app-style screen on mobile
// (sticky Buy/Sell action bar, no site chrome) — the footer drops out there.
export function SiteFooterGate() {
  const routerPath = usePathname();
  const [appView, setAppView] = useState(false);
  useEffect(() => {
    const p = window.location.pathname || routerPath || "";
    setAppView(p.startsWith("/asedex/terminal") || p.startsWith("/asepad/token/") || p.startsWith("/terminal") || p.startsWith("/token/"));
  }, [routerPath]);
  return (
    <div className={appView ? "hidden lg:block" : undefined}>
      <SiteFooter />
    </div>
  );
}
