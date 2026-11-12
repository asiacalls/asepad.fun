"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { href as siteHref } from "@/lib/site";

/** AseVault launch promo strip. One global campaign clock shared by every
 *  device: 60 seconds visible at the top of each 15-minute window, and the
 *  campaign dies completely 24 hours after FLASH_START. FLASH_START is the
 *  build timestamp baked into the bundle, so each deploy restarts the
 *  campaign. When unset (dev), the strip stays live. */
const FLASH_START = Number(process.env.NEXT_PUBLIC_BUILD_TS ?? 0);
const CYCLE_MS = 15 * 60_000;
const SHOW_MS = 60_000;
const LIFE_MS = 24 * 60 * 60_000;

function flashing(now: number): boolean {
  if (!FLASH_START) return true;
  const el = now - FLASH_START;
  return el >= 0 && el < LIFE_MS && el % CYCLE_MS < SHOW_MS;
}

/** One half of the marquee - duplicated so the -50% translate loops clean. */
function Lane() {
  return (
    <div className="flex shrink-0 items-center text-xs sm:text-sm">
      {Array.from({ length: 4 }).map((_, i) => (
        <span key={i} className="flex items-center whitespace-nowrap">
          <span className="flex items-center gap-2 font-semibold text-white">
            ASEVAULT 1.1.1 IS LIVE <span aria-hidden>🔥🔥🔥</span>
          </span>
          <span className="mx-6 text-white/55">A post-quantum wallet for your Android mobile</span>
          <span className="rounded-full bg-white px-4 py-1 text-[11px] font-bold text-black sm:text-xs">
            DOWNLOAD NOW
          </span>
          <span className="mx-6 h-1 w-1 rounded-full bg-white/25" aria-hidden />
        </span>
      ))}
    </div>
  );
}

// Kill-switch: flip to true to silence the campaign strip everywhere.
const FLASH_PAUSED = false;

export function AseVaultFlash() {
  const [on, setOn] = useState(false);
  const [navBottom, setNavBottom] = useState(0);
  useEffect(() => {
    if (FLASH_PAUSED) return;
    // Preview overrides: localhost always shows it, and ?flash=1 forces it
    // on anywhere, so the design can be reviewed without waiting for a
    // flash window. Real visitors only see the campaign schedule.
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1" || new URLSearchParams(window.location.search).has("flash")) {
      setOn(true);
      return;
    }
    const tick = () => setOn(flashing(Date.now()));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  // Sit directly under the site header by tracking its real bottom edge.
  // Header hides (mobile, or any slide-away) -> rect bottom collapses and the
  // strip rides up to the viewport top; header back -> strip drops under it.
  useEffect(() => {
    const header = document.querySelector("header");
    if (!header) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      setNavBottom(Math.max(0, Math.round(header.getBoundingClientRect().bottom)));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <AnimatePresence initial={false}>
      {on ? (
        <motion.div
          key="asevault-flash"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          // Sticky directly under the site header; rides to the viewport top
          // whenever the header is gone (mobile has no top nav).
          style={{ top: navBottom }}
          className="sticky top-0 z-40 overflow-hidden"
        >
          <Link
            prefetch={false}
            href={siteHref("/asevault")}
            aria-label="AseVault wallet app - download now"
            className="block border-b border-white/[0.08] bg-black/40 py-2.5 backdrop-blur-2xl transition-colors hover:bg-black/55"
          >
            <div className="flex w-max animate-ticker-marquee">
              <Lane />
              <Lane />
            </div>
          </Link>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
