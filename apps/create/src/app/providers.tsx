"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { useEffect, useState } from "react";
import { AsentumWalletProvider } from "@/components/wallet/asentum-wallet-provider";
import { LiveChainProvider } from "@/components/live/live-chain";
import { queryPersistOptions } from "@/lib/query-persist";
import { LiveSessionProvider } from "@/components/live/live-session";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        // Cached data stays usable for a day (matches the persister's maxAge)
        // so a reload always paints the snapshot; staleness only decides when
        // the background refresh fires, never what's shown first.
        staleTime: 15_000,
        gcTime: 24 * 60 * 60 * 1000,
        retry: 2,
        // Back on screen = back to fresh: returning to the tab refetches
        // whatever went stale while away.
        refetchOnWindowFocus: true
      }
    }
  }));
  const [persist] = useState(queryPersistOptions);

  // Stale-deploy safety net: a tab opened before a deploy holds script tags
  // for chunks the new deployment deleted. The next lazy load/nav fails with
  // a chunk error that can escape React entirely — reload once (shared flag
  // with global-error.tsx so the two never loop each other).
  useEffect(() => {
    const isChunkFail = (x: unknown) => {
      const s = x instanceof Error ? x.message : String(x ?? "");
      return /Loading chunk [\w-]+ failed|ChunkLoadError|dynamically imported module|Importing a module script failed/i.test(s);
    };
    const reloadOnce = () => {
      let last = 0;
      try { last = Number(sessionStorage.getItem("aer:crash") ?? 0); } catch { }
      if (Date.now() - last > 60_000) {
        try { sessionStorage.setItem("aer:crash", String(Date.now())); } catch { }
        window.location.reload();
      }
    };
    const onRejection = (e: PromiseRejectionEvent) => { if (isChunkFail(e.reason)) reloadOnce(); };
    const onError = (e: ErrorEvent) => { if (isChunkFail(e.error ?? e.message)) reloadOnce(); };
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }, []);

  const tree = (
    <LiveSessionProvider>
      <AsentumWalletProvider>
        <LiveChainProvider>{children}</LiveChainProvider>
      </AsentumWalletProvider>
    </LiveSessionProvider>
  );
  return persist ? (
    <PersistQueryClientProvider client={client} persistOptions={persist}>
      {tree}
    </PersistQueryClientProvider>
  ) : (
    <QueryClientProvider client={client}>{tree}</QueryClientProvider>
  );
}
