"use client";

import { useParams, usePathname } from "next/navigation";
import { LockDetail } from "../lock-detail";

export default function LockDetailPage() {
  const params = useParams<{ id: string }>();
  // Static hosting serves every lock from the prebuilt "_" shell, so the
  // address bar (not the route param) is the source of truth for the id.
  const routerPath = usePathname();
  const pathname = typeof window === "undefined" ? routerPath : window.location.pathname;
  const segs = (pathname?.split("/").filter(Boolean) ?? []).map(decodeURIComponent);
  // /lock/<id> → v1, /lock/v2/<id> → v2 contract. ?v=2 still works (old links).
  const v2 = segs[1] === "v2";
  const fromPath = (v2 ? segs[2] : segs[1] ?? "").replace(/^#/, "");
  const id = fromPath && fromPath !== "_" ? fromPath : String(params.id ?? "");
  return <LockDetail id={id} v={v2 ? "2" : undefined} />;
}
