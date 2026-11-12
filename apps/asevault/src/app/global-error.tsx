"use client";

import { useEffect } from "react";

// Last-resort boundary for client exceptions — replaces the stock
// "Application error" screen. Almost every production hit is transient: an
// open tab requesting a JS chunk a newer deploy removed (stale deploy), or a
// data stream arriving mid-render. A reload resolves it, so do that once
// automatically; the flag window keeps a genuinely broken page from looping.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    let last = 0;
    try { last = Number(sessionStorage.getItem("aer:crash") ?? 0); } catch { }
    if (Date.now() - last > 60_000) {
      try { sessionStorage.setItem("aer:crash", String(Date.now())); } catch { }
      window.location.reload();
    }
  }, []);
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#07080d", color: "#e6e8ee", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
        <div style={{ textAlign: "center", padding: "0 24px" }}>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Something went wrong</p>
          <p style={{ margin: "8px 0 18px", fontSize: 13, color: "rgba(230,232,238,.5)" }}>
            {error?.message || "The page hit an unexpected error."}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ borderRadius: 10, border: "1px solid rgba(255,255,255,.12)", background: "rgba(255,255,255,.06)", color: "#e6e8ee", padding: "9px 22px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
