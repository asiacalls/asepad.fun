"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { focusManager, onlineManager, useQueryClient } from "@tanstack/react-query";
import { installLiveFetchGate, isLivePaused, LIVE_IDLE_MS, setLivePaused, subscribeLiveSession } from "@/lib/live-session";

export const useLivePaused = () => useSyncExternalStore(subscribeLiveSession, isLivePaused, () => false);
// Idle pause applies to market surfaces only — static/info pages never gate.
const IDLE_EXCLUDED = (path: string) =>
  path === "/" || path.startsWith("/docs") || path.startsWith("/asevault") || path.startsWith("/auditreport");

export function LiveSessionProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const pathname = usePathname();
  const paused = useLivePaused();
  const enabled = !IDLE_EXCLUDED(pathname);
  const lastActivity = useRef(Date.now());
  const activity = useRef<() => void>(() => {});

  useEffect(() => {
    if (!enabled) { if (isLivePaused()) setLivePaused(false); return; }
    const restoreFetch = installLiveFetchGate();
    let timer: ReturnType<typeof setTimeout>;
    const pause = () => {
      setLivePaused(true);
      focusManager.setFocused(false);
      onlineManager.setOnline(false);
      void client.cancelQueries();
    };
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(pause, Math.max(0, LIVE_IDLE_MS - (Date.now() - lastActivity.current)));
    };
    const onActivity = () => {
      // Check wall time before resetting it: background tabs may throttle timers.
      if (isLivePaused() || Date.now() - lastActivity.current >= LIVE_IDLE_MS) {
        pause();
        return;
      }
      lastActivity.current = Date.now();
      arm();
    };
    activity.current = onActivity;
    const onVisible = () => {
      if (document.visibilityState === "visible") onActivity();
    };
    const onOnline = () => {
      if (isLivePaused()) onlineManager.setOnline(false);
    };
    const unsubscribe = subscribeLiveSession(() => {
      if (!isLivePaused()) { lastActivity.current = Date.now(); arm(); }
    });
    const events = ["scroll", "pointerdown", "keydown", "touchstart"] as const;
    events.forEach((name) => window.addEventListener(name, onActivity, { capture: true, passive: true }));
    document.addEventListener("visibilitychange", onVisible, true);
    window.addEventListener("online", onOnline);
    arm();
    return () => {
      clearTimeout(timer);
      unsubscribe();
      restoreFetch();
      events.forEach((name) => window.removeEventListener(name, onActivity, true));
      document.removeEventListener("visibilitychange", onVisible, true);
      window.removeEventListener("online", onOnline);
      focusManager.setFocused(undefined);
      onlineManager.setOnline(navigator.onLine);
    };
  }, [client, enabled]);

  useEffect(() => { activity.current(); }, [pathname]);

  const [refreshing, setRefreshing] = useState(false);
  const resume = () => {
    lastActivity.current = Date.now();
    setRefreshing(true);
    focusManager.setFocused(document.visibilityState === "visible");
    onlineManager.setOnline(navigator.onLine);
    // Refresh the whole platform — every query, not just active ones — then
    // unpause so the strip clears once the wave is underway.
    void client.invalidateQueries({ refetchType: "all" }, { cancelRefetch: false })
      .finally(() => {
        setLivePaused(false);
        setTimeout(() => setRefreshing(false), 400);
      });
  };

  return <>
    {children}
    {paused && enabled && (
      <div className="fixed inset-x-0 top-0 z-[100] flex h-10 items-center justify-center gap-3 border-b border-amber-400/25 bg-slate-950/95 px-4 backdrop-blur">
        <span className="truncate text-xs text-amber-100/90">
          A new market update is available · Kindly refresh to see the latest data
        </span>
        <button type="button" onClick={resume} disabled={refreshing}
          className="shrink-0 rounded-full bg-emerald-400 px-4 py-1 text-xs font-semibold text-slate-950 hover:bg-emerald-300 disabled:opacity-60">
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
    )}
  </>;
}
