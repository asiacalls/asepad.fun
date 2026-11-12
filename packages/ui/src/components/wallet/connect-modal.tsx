"use client";

import { useEffect, useRef, useState } from "react";
import { useAsentumContext } from "@asentum/connect";
import {
  ArrowLeft, ChevronRight, Download, Loader2, Puzzle, Send, ShieldCheck, Sparkles, Timer, X,
  type LucideIcon
} from "lucide-react";
import { humanizeWalletError } from "@/lib/asentum-wallet";
import { cn } from "@/lib/cn";

const CHROME_WEB_STORE_URL =
  "https://chromewebstore.google.com/detail/asentum-wallet/eanbehbkdekcfgfjfaaocfipmlkdbnoc";

type Option = {
  key: string;
  title: string;
  sub: string;
  cta: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  chip?: string;
};

/**
 * AsePad-themed connect modal — replaces the SDK's plain <ConnectModal/>.
 * Same flow (extension connect / Telegram 6-digit pairing / create wallet),
 * driven straight through useAsentumContext so all session logic stays in the
 * SDK; this is purely the visual layer.
 */
export function AseConnectModal() {
  const c = useAsentumContext();
  const [view, setView] = useState<"options" | "code">("options");
  const [code, setCode] = useState("------");
  const [ttl, setTtl] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ttlRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimers = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (ttlRef.current) clearInterval(ttlRef.current);
    pollRef.current = null;
    ttlRef.current = null;
  };
  useEffect(() => () => stopTimers(), []);

  const close = () => {
    stopTimers();
    setView("options");
    c._setError(null);
    c._closeModal();
  };

  useEffect(() => {
    if (!c._modalOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c._modalOpen]);

  async function startCode() {
    setView("code");
    c._setError(null);
    setCode("------");
    setTtl("");
    try {
      const data = await c.client.createBotSession(c.dappName);
      setCode(data.code);
      const expires = data.expiresAt ? new Date(data.expiresAt).getTime() : Date.now() + 5 * 60_000;
      const tick = () => {
        const ms = expires - Date.now();
        if (ms <= 0) {
          stopTimers();
          setTtl("expired");
          c._setError("Code expired. Go back and try again.");
          return;
        }
        const s = Math.floor(ms / 1000);
        setTtl(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
      };
      tick();
      ttlRef.current = setInterval(tick, 1000);
      pollRef.current = setInterval(async () => {
        try {
          const s = await c.client.getBotSessionStatus(data.sessionId);
          if (s.status === "connected" && s.address) {
            stopTimers();
            c._connectBot({ address: s.address, sessionId: data.sessionId });
            setView("options");
          } else if (s.status === "rejected") {
            stopTimers();
            c._setError("Connection rejected in the wallet.");
          } else if (s.status === "expired") {
            stopTimers();
            c._setError("Session expired. Try again.");
          }
        } catch { /* relay hiccup — next poll retries */ }
      }, 2000);
    } catch (e) {
      c._setError(e instanceof Error ? e.message : "Could not start pairing.");
    }
  }

  if (!c._modalOpen) return null;

  const options: Option[] = [];
  if (c.extensionStatus === "soon") {
    options.push({
      key: "extension",
      title: "Browser extension",
      sub: "Connect with the Asentum extension once it ships",
      cta: "Soon",
      icon: Puzzle,
      onClick: () => {},
      disabled: true,
      chip: "Soon"
    });
  } else {
    options.push({
      key: "extension",
      title: c.hasWallet ? "Asentum extension" : "Get the extension",
      sub: c.hasWallet ? "Sign with the wallet already in your browser" : "Install Asentum Wallet, then reconnect",
      cta: c.hasWallet ? "Connect" : "Get it",
      icon: c.hasWallet ? Puzzle : Download,
      busy: c.hasWallet && c.connecting,
      onClick: () => {
        if (c.hasWallet) void c.connect();
        else window.open(CHROME_WEB_STORE_URL, "_blank", "noopener");
      }
    });
  }
  if (c.telegramBot) {
    options.push({
      key: "telegram",
      title: "Telegram wallet",
      sub: "Pair with a 6-digit code — no app switch",
      cta: "Pair",
      icon: Send,
      onClick: () => void startCode()
    });
  }
  if (c.onCreateWallet) {
    options.push({
      key: "create",
      title: "Create a new wallet",
      sub: "Generated in your browser, keystore download",
      cta: "Create",
      icon: Sparkles,
      onClick: () => void c.onCreateWallet?.()
    });
  }

  const error = c.error ? humanizeWalletError(c.error) : null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center bg-black/75 p-4 backdrop-blur-md sm:items-center"
      onClick={close}
    >
      <div
        className="relative w-full max-w-[400px] overflow-hidden rounded-2xl border border-white/10 bg-[#0a0b12] shadow-[0_32px_90px_-20px_rgba(0,0,0,0.95)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* chrome hairline + top glow */}
        <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />
        <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-72 -translate-x-1/2 rounded-full bg-white/[0.07] blur-3xl" />

        {/* head */}
        <div className="relative flex items-start justify-between border-b border-white/[0.07] px-5 pb-4 pt-5">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/asepad-mark.png" alt="" className="h-9 w-9 object-contain" />
            <div>
              <div className="text-[9px] font-semibold uppercase tracking-[0.22em] text-white/40">AsePad · Wallet</div>
              <div className="mt-0.5 text-[16px] font-semibold text-white">
                {view === "code" ? "Pair Telegram wallet" : "Connect to Asentum"}
              </div>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-white/50 transition-colors hover:border-white/25 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {view === "options" ? (
          <div className="relative space-y-2.5 p-4">
            {options.map((o) => (
              <button
                key={o.key}
                type="button"
                disabled={o.disabled || o.busy}
                onClick={o.onClick}
                className={cn(
                  "group flex w-full items-center gap-3.5 rounded-xl border px-4 py-3.5 text-left transition-all",
                  o.disabled
                    ? "cursor-not-allowed border-dashed border-white/10 bg-white/[0.02] opacity-60"
                    : "border-white/10 bg-gradient-to-b from-white/[0.05] to-white/[0.02] hover:border-white/25 hover:from-white/[0.08]"
                )}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.10] to-transparent text-chrome-200">
                  {o.busy ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <o.icon className="h-[18px] w-[18px]" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-[13.5px] font-semibold text-white">
                    {o.title}
                    {o.chip ? (
                      <span className="rounded-full border border-white/15 bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white/50">
                        {o.chip}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block truncate text-[11.5px] text-white/45">{o.sub}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-chrome-200/80 transition-colors group-hover:text-chrome-100">
                  {o.cta}
                  <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
              </button>
            ))}
            {error ? (
              <div className="rounded-xl border border-red-400/20 bg-red-500/[0.08] px-3.5 py-2.5 text-[12px] leading-relaxed text-red-200/90">
                {error}
              </div>
            ) : null}
            {c.rpcState.allowed ? <RpcSettings /> : null}
          </div>
        ) : (
          <div className="relative space-y-4 p-5">
            <p className="text-[12.5px] leading-relaxed text-white/55">
              Open <span className="font-semibold text-white">@{c.telegramBot}</span> in Telegram, tap{" "}
              <span className="font-semibold text-white">Connect wallet</span>, then enter this code:
            </p>
            <div className="flex justify-center gap-2">
              {code.split("").map((ch, i) => (
                <span
                  key={i}
                  className={cn(
                    "flex h-12 w-10 items-center justify-center rounded-lg border font-mono text-xl font-bold",
                    ch === "-"
                      ? "border-white/[0.07] bg-white/[0.02] text-white/20"
                      : "border-white/15 bg-gradient-to-b from-white/[0.09] to-white/[0.03] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]"
                  )}
                >
                  {ch === "-" ? "·" : ch}
                </span>
              ))}
            </div>
            <div className="flex items-center justify-center gap-1.5 text-[11px] font-medium text-white/45">
              <Timer className="h-3 w-3" />
              {ttl === "expired" ? "Code expired" : ttl ? `Expires in ${ttl}` : "Waiting for wallet…"}
            </div>
            {c.telegramBot ? (
              <a
                href={`https://t.me/${c.telegramBot}`}
                target="_blank"
                rel="noreferrer"
                className="mx-auto flex w-fit items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-[11.5px] font-semibold text-chrome-200 transition-colors hover:border-white/25 hover:text-white"
              >
                <Send className="h-3 w-3" />
                Open @{c.telegramBot}
              </a>
            ) : null}
            {error ? (
              <div className="rounded-xl border border-red-400/20 bg-red-500/[0.08] px-3.5 py-2.5 text-[12px] leading-relaxed text-red-200/90">
                {error}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => { stopTimers(); c._setError(null); setView("options"); }}
              className="flex items-center gap-1.5 text-[12px] font-medium text-white/50 transition-colors hover:text-white"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to options
            </button>
          </div>
        )}

        {/* foot */}
        <div className="relative flex items-center gap-2 border-t border-white/[0.07] px-5 py-3 text-[10.5px] text-white/35">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-300/60" />
          Read-only access plus signature requests — your keys never leave the wallet.
        </div>
      </div>
    </div>
  );
}

const rpcHost = (url: string) => {
  try { return new URL(url).host; } catch { return url; }
};

/** Compact custom-RPC row — parity with the SDK modal's NetworkSettings.
 *  This is the escape hatch when the public node rate-limits: users point the
 *  app (and thus the wallet's reads) at their own node. */
function RpcSettings() {
  const c = useAsentumContext();
  const r = c.rpcState;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "err" | "ok" | "info"; text: string } | null>(null);

  const open = () => {
    setValue(r.isCustom ? r.rpc : "");
    setMsg(null);
    setEditing(true);
  };
  const save = async () => {
    if (busy) return;
    if (!value.trim()) {
      setMsg({ kind: "err", text: "Enter your node's address, or reset to default." });
      return;
    }
    setBusy(true);
    setMsg({ kind: "info", text: "Checking the node…" });
    try {
      const res = await c.setRpc(value);
      if (res.ok && res.height != null) {
        setMsg({ kind: "ok", text: `Connected — block ${res.height.toLocaleString()}` });
        setEditing(false);
      } else {
        setMsg({ kind: "err", text: `Not saved. ${res.error || ""}`.trim() });
      }
    } finally {
      setBusy(false);
    }
  };
  const reset = () => {
    c.resetRpc();
    setEditing(false);
    setMsg({ kind: "info", text: "Using the default RPC." });
  };

  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3.5 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">Network</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-white/60" title={r.rpc}>
          {rpcHost(r.rpc)}
          {r.isCustom ? (
            <span className="ml-1.5 rounded-full border border-white/15 bg-white/[0.06] px-1.5 py-px text-[8.5px] font-semibold uppercase tracking-wider text-white/50">
              Custom
            </span>
          ) : null}
        </span>
        {!editing ? (
          <button
            type="button"
            onClick={open}
            className="text-[11px] font-semibold text-chrome-200/80 transition-colors hover:text-chrome-100"
          >
            Change
          </button>
        ) : null}
      </div>

      {r.isCustom && r.failing && !r.readingFromDefault ? (
        <div className="mt-2 rounded-lg border border-amber-400/20 bg-amber-500/[0.08] px-3 py-2 text-[11px] leading-relaxed text-amber-200/90">
          Your custom RPC is not answering.
          <div className="mt-1.5 flex gap-2">
            <button type="button" onClick={reset} className="font-semibold text-amber-100 underline-offset-2 hover:underline">Switch to default</button>
            <button type="button" onClick={() => c.readFromDefault(true)} className="text-amber-200/70 underline-offset-2 hover:underline">Read from default for now</button>
          </div>
        </div>
      ) : null}
      {r.isCustom && r.readingFromDefault ? (
        <div className="mt-2 rounded-lg border border-amber-400/20 bg-amber-500/[0.08] px-3 py-2 text-[11px] leading-relaxed text-amber-200/90">
          Reading from the default RPC for now.
          <div className="mt-1.5 flex gap-2">
            <button type="button" onClick={reset} className="font-semibold text-amber-100 underline-offset-2 hover:underline">Switch to default</button>
            <button type="button" onClick={() => c.readFromDefault(false)} className="text-amber-200/70 underline-offset-2 hover:underline">Use my RPC again</button>
          </div>
        </div>
      ) : null}

      {editing ? (
        <div className="mt-2.5 space-y-2">
          <input
            type="url"
            value={value}
            placeholder="https://your-node.example.com"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            disabled={busy}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void save(); if (e.key === "Escape") setEditing(false); }}
            className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-[11.5px] text-white placeholder:text-white/25 focus:border-white/30 focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className="rounded-lg border border-white/15 bg-white/[0.08] px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-white/[0.12] disabled:opacity-50"
            >
              {busy ? "Checking…" : "Save"}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={busy}
              className="px-2 py-1.5 text-[11px] font-medium text-white/55 transition-colors hover:text-white disabled:opacity-50"
            >
              Reset to default
            </button>
            <button
              type="button"
              onClick={() => { setEditing(false); setMsg(null); }}
              disabled={busy}
              className="ml-auto text-[11px] text-white/40 transition-colors hover:text-white/70 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
          <p className="text-[10px] leading-relaxed text-white/30">
            Reads from this app use your node. The browser extension has its own RPC setting.
          </p>
        </div>
      ) : null}
      {!editing && r.isCustom && !msg ? (
        <button
          type="button"
          onClick={reset}
          className="mt-1.5 text-[10.5px] font-medium text-white/40 transition-colors hover:text-white/70"
        >
          Reset to default
        </button>
      ) : null}
      {msg ? (
        <div className={cn(
          "mt-2 rounded-lg px-3 py-2 text-[11px] leading-relaxed",
          msg.kind === "err" ? "border border-red-400/20 bg-red-500/[0.08] text-red-200/90"
            : msg.kind === "ok" ? "border border-emerald-400/20 bg-emerald-500/[0.08] text-emerald-200/90"
              : "border border-white/10 bg-white/[0.04] text-white/55"
        )}>
          {msg.text}
        </div>
      ) : null}
    </div>
  );
}
