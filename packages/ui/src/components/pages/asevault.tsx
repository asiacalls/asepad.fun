"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight, ChevronLeft, ChevronRight, Download, Fingerprint, Globe, KeyRound, Layers, Lock,
  QrCode, Rocket, ShieldCheck, Smartphone, TrendingUp, X
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollReveal } from "@/components/motion/scroll-reveal";
import { Button } from "@/components/ui/button";
import { href as siteHref } from "@/lib/site";

const APP_VERSION = "1.1.1";
// APK downloads ride Google Drive — serving the 125 MB binary from the site
// burned Netlify CDN bandwidth on every install.
const APK_URL = "https://drive.usercontent.google.com/download?id=1vPvSlUBZK0i8EWgVH5Oo7OfkdccB17Db&export=download&confirm=t";

function SectionTitle({ eyebrow, title, desc }: { eyebrow: string; title: string; desc: string }) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <div className="text-xs font-semibold tracking-[0.22em] text-chrome-400/90">{eyebrow}</div>
      <h2 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">{title}</h2>
      <p className="mt-3 text-sm text-white/60 md:text-base">{desc}</p>
    </div>
  );
}

const fadeUp = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 } };

const FEATURES = [
  { icon: KeyRound, t: "You hold the keys", d: "Wallets are created and stored only on your device. No accounts, no email, no company that can move your funds." },
  { icon: Lock, t: "Post-quantum signatures", d: "Every transaction signs with ML-DSA-65, the signature scheme built for Asentum, straight on your phone." },
  { icon: Fingerprint, t: "Locked by default", d: "Biometric unlock, an optional passcode, and auto-lock keep the vault sealed the moment you look away." },
  { icon: Layers, t: "Every wallet you need", d: "Create or import as many wallets as you like and switch between them in a tap." },
  { icon: TrendingUp, t: "Markets built in", d: "AseDex and AURAS pools, AsePad launches, and live token pages, all inside the wallet." },
  { icon: Globe, t: "A browser for dApps", d: "Connect to AsePad, AseDex, AURAS and more. Every action asks for your approval first." }
];

const STEPS = [
  { n: "01", icon: Download, t: "Download the APK", d: "Grab the Android build straight from this page and install it. iOS support is on the way." },
  { n: "02", icon: Smartphone, t: "Create or import", d: "Spin up a fresh wallet with a recovery phrase, or bring in an existing one. Takes about a minute." },
  { n: "03", icon: QrCode, t: "Fund and go", d: "Receive ASE by QR or address, then trade, launch, and connect from your pocket." }
];

function DownloadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [shot, setShot] = useState<number | null>(null);
  useEffect(() => {
    if (!open) { setShot(null); return; }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") shot !== null ? setShot(null) : onClose();
      if (shot !== null) {
        if (e.key === "ArrowLeft") setShot((shot + 7) % 8);
        if (e.key === "ArrowRight") setShot((shot + 1) % 8);
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose, shot]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          role="dialog" aria-modal="true" aria-label="Download AseVault"
        >
          <button type="button" aria-label="Close" onClick={onClose}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="relative max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-[#1b1b1f] shadow-2xl"
          >
            <button type="button" aria-label="Close" onClick={onClose}
              className="absolute right-3 top-3 z-10 rounded-full p-2 text-white/60 transition hover:bg-white/[0.08] hover:text-white">
              <X className="h-4.5 w-4.5" />
            </button>

            {/* store header: icon + title + dev */}
            <div className="flex items-center gap-4 px-6 pt-6">
              <Image src="/brand/asevault-icon.png" alt="AseVault" width={72} height={72}
                className="h-[72px] w-[72px] rounded-2xl border border-white/10 object-cover" />
              <div className="min-w-0">
                <p className="text-xl font-semibold leading-tight">AseVault</p>
                <p className="mt-0.5 text-sm font-medium text-emerald-400">AsePad Team</p>
                <p className="mt-0.5 text-xs text-white/70">A Post-Quantum Wallet · Built For Asentum Blockchain · Free</p>
              </div>
            </div>

            {/* stats row */}
            <div className="mt-5 flex items-stretch divide-x divide-white/10 px-6 text-center">
              <div className="flex-1 py-1">
                <p className="text-sm font-semibold text-white">v{APP_VERSION}</p>
                <p className="mt-0.5 text-[11px] uppercase tracking-wide text-white/60">Version</p>
              </div>
              <div className="flex-1 py-1">
                <p className="text-sm font-semibold text-white">New</p>
                <p className="mt-0.5 text-[11px] uppercase tracking-wide text-white/60">Just released</p>
              </div>
              <div className="flex-1 py-1">
                <p className="text-sm font-semibold text-white">Everyone</p>
                <p className="mt-0.5 text-[11px] uppercase tracking-wide text-white/60">Rated for all</p>
              </div>
            </div>

            {/* install */}
            <div className="mt-4 px-6">
              <a href={APK_URL} target="_blank" rel="noopener noreferrer"
                className="block w-full rounded-full bg-[#01875f] py-3 text-center text-sm font-semibold text-white transition hover:bg-[#02a06f]">
                Install
              </a>
              <p className="mt-2 text-center text-xs text-white/60">
                Direct APK · v{APP_VERSION} · Android 8.0+ · Official asepad.fun build
              </p>
            </div>

            {/* screenshots — tap to expand */}
            <div className="mt-5 flex gap-3 overflow-x-auto px-6 pb-1">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                <button key={n} type="button" onClick={() => setShot(n - 1)}
                  className="group relative shrink-0 cursor-zoom-in overflow-hidden rounded-lg border border-white/10 transition hover:border-white/30">
                  <Image src={`/brand/asevault-shot-${n}.png`} alt={`AseVault screenshot ${n}`} width={220} height={440}
                    className="h-48 w-auto object-cover transition group-hover:scale-[1.03]" />
                </button>
              ))}
            </div>

            {/* about */}
            <div className="mt-4 px-6">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-white/90">About this app</p>
                <ChevronRight className="h-4 w-4 text-white/40" />
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-white/75">
                AseVault is the mobile wallet of the Asentum network. It holds your ASE and ARC-20 tokens, connects to AsePad, AseDex, AURAS and other apps, and signs every transaction with the post-quantum signature scheme Asentum is built on. Fully non-custodial: no account, no email, your wallet lives on your device.
              </p>
            </div>

            {/* install note */}
            <p className="mt-4 px-6 pb-6 text-center text-xs leading-relaxed text-white/60">
              If Android asks, allow installs from your browser. The APK is the official asepad.fun build.
            </p>
          </motion.div>

          {/* screenshot lightbox */}
          <AnimatePresence>
            {shot !== null ? (
              <motion.div
                className="fixed inset-0 z-[90] flex items-center justify-center"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                role="dialog" aria-modal="true" aria-label="Screenshot viewer"
              >
                <button type="button" aria-label="Close viewer" onClick={() => setShot(null)}
                  className="absolute inset-0 bg-black/90 backdrop-blur-md" />

                <button type="button" aria-label="Close viewer" onClick={() => setShot(null)}
                  className="absolute right-4 top-4 z-10 rounded-full border border-white/15 bg-white/[0.08] p-2.5 text-white/80 backdrop-blur transition hover:bg-white/15 hover:text-white">
                  <X className="h-5 w-5" />
                </button>
                <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full border border-white/15 bg-white/[0.08] px-3.5 py-1.5 text-xs font-semibold tracking-wide text-white/80 backdrop-blur">
                  {shot + 1} / 8
                </div>

                <button type="button" aria-label="Previous" onClick={() => setShot((shot + 7) % 8)}
                  className="absolute left-3 z-10 rounded-full border border-white/15 bg-white/[0.08] p-2.5 text-white/80 backdrop-blur transition hover:bg-white/15 hover:text-white sm:left-6">
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button type="button" aria-label="Next" onClick={() => setShot((shot + 1) % 8)}
                  className="absolute right-3 z-10 rounded-full border border-white/15 bg-white/[0.08] p-2.5 text-white/80 backdrop-blur transition hover:bg-white/15 hover:text-white sm:right-6">
                  <ChevronRight className="h-5 w-5" />
                </button>

                <motion.div key={shot}
                  initial={{ opacity: 0, scale: 0.94, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className="relative pointer-events-none">
                  <Image src={`/brand/asevault-shot-${shot + 1}.png`} alt={`AseVault screenshot ${shot + 1}`}
                    width={540} height={1080}
                    className="max-h-[82vh] w-auto rounded-xl border border-white/15 object-contain shadow-2xl" />
                </motion.div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function AsevaultPage() {
  const [dlOpen, setDlOpen] = useState(false);
  return (
    <main className="relative">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative w-full overflow-hidden">
        <Image src="/brand/asevault-hero.png" alt="" fill priority sizes="100vw" className="hidden object-cover object-center opacity-60 sm:block" />
        {/* mobile: whole image visible, contain, never zoom/crop */}
        <Image src="/brand/asevault-mobile-hero.png" alt="" fill priority sizes="100vw" className="object-contain object-top opacity-60 sm:hidden" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/40 via-black/60 to-[#05060a]" aria-hidden />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#05060a] to-transparent" aria-hidden />

        <div className="relative mx-auto flex max-w-4xl flex-col items-center px-4 pb-20 pt-28 text-center sm:pt-36 md:pt-44">
          <motion.div {...fadeUp} transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-4 py-1.5 text-xs font-medium text-white/70 backdrop-blur">
            <ShieldCheck className="h-3.5 w-3.5 text-chrome-300" />
            A product of asepad.fun
          </motion.div>

          <motion.h1 {...fadeUp} transition={{ duration: 0.7, delay: 0.08 }}
            className="mt-6 text-4xl font-semibold tracking-tight sm:text-5xl md:text-6xl">
            <span className="bg-gradient-to-r from-white via-chrome-300 to-chrome-500 bg-[length:200%_auto] bg-clip-text text-transparent animate-shimmer">
              AseVault
            </span>
          </motion.h1>

          <motion.p {...fadeUp} transition={{ duration: 0.7, delay: 0.16 }}
            className="mt-5 max-w-2xl text-base leading-relaxed text-white/80 md:text-lg">
            The post-quantum wallet-Built for Asentum. Hold ASE and ARC-20 tokens, buy AsePad launches, swap on AseDex and AURAS, and connect to dApps, all from one app with no accounts and no sign up.
          </motion.p>

          <motion.div {...fadeUp} transition={{ duration: 0.7, delay: 0.24 }}
            className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" onClick={() => setDlOpen(true)}>
              <Download className="mr-1.5 h-4 w-4" /> Download for Android
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link prefetch={false} href={siteHref("/auditreport")}>App Audit Report</Link>
            </Button>
          </motion.div>

          <motion.p {...fadeUp} transition={{ duration: 0.7, delay: 0.3 }}
            className="mt-4 text-xs text-white/60">
            Now on Android, with iOS on the way. Free, open, and yours alone.
          </motion.p>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 py-16 md:py-20">
        <ScrollReveal>
          <SectionTitle
            eyebrow="WHY ASEVAULT"
            title="A vault, not an account"
            desc="No sign up, no backend custody, no permission needed. The keys never leave your phone."
          />
        </ScrollReveal>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <ScrollReveal key={f.t} delay={(i % 3) * 0.06}>
              <div className="h-full rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-chrome-400/25">
                <f.icon className="h-5 w-5 text-chrome-300" />
                <h3 className="mt-3.5 text-base font-semibold">{f.t}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-white/70">{f.d}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </section>

      {/* ── Get started ──────────────────────────────────────── */}
      <section className="border-y border-white/[0.06] bg-white/[0.02] py-16 md:py-20">
        <div className="mx-auto max-w-7xl px-4">
          <ScrollReveal>
            <SectionTitle
              eyebrow="GET STARTED"
              title="Pocket vault in three steps"
              desc="From download to your first transaction in about a minute."
            />
          </ScrollReveal>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <ScrollReveal key={s.n} delay={i * 0.08}>
                <div className="group relative h-full overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-chrome-400/30">
                  <span className="absolute right-5 top-5 font-mono text-4xl font-black text-white/[0.06] group-hover:text-white/10">{s.n}</span>
                  <s.icon className="h-6 w-6 text-chrome-300" />
                  <h3 className="mt-4 text-lg font-semibold">{s.t}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/55">{s.d}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── AsePad inside ────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 py-16 md:py-20">
        <ScrollReveal>
          <SectionTitle
            eyebrow="ASEPAD, IN YOUR POCKET"
            title="Launches and liquidity, mobile"
            desc="Everything this site does, the wallet does: watch launches, buy the curve, and manage liquidity without a desktop."
          />
        </ScrollReveal>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {[
            { icon: Rocket, t: "AsePad launches", d: "New tokens, live bonding curves, and migrations, watchable and tradeable in-app." },
            { icon: TrendingUp, t: "AseDex + AURAS", d: "Every pool on both exchanges, with swaps routed and approved from the wallet." },
            { icon: ShieldCheck, t: "Approve first", d: "Nothing moves without a review screen. Sends, swaps, approvals, all gated by you." }
          ].map((f, i) => (
            <ScrollReveal key={f.t} delay={i * 0.06}>
              <div className="h-full rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-chrome-400/25">
                <f.icon className="h-5 w-5 text-chrome-300" />
                <h3 className="mt-3.5 text-base font-semibold">{f.t}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-white/70">{f.d}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </section>

      {/* ── CTA band ─────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 pb-20">
        <ScrollReveal>
          <Card className="relative overflow-hidden border-chrome-400/20 bg-gradient-to-r from-chrome-400/[0.08] via-white/[0.03] to-transparent">
            <CardContent className="flex flex-col items-start gap-5 p-8 md:flex-row md:items-center md:justify-between md:p-10">
              <div>
                <h3 className="text-2xl font-semibold tracking-tight md:text-3xl">Carry the vault</h3>
                <p className="mt-2 max-w-lg text-sm text-white/55">
                  Download AseVault, set it up in a minute, and the whole Asentum network lives in your pocket.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button asChild size="lg"><Link prefetch={false} href={siteHref("/docs")}>Read the docs <ArrowRight className="ml-1.5 h-4 w-4" /></Link></Button>
              </div>
            </CardContent>
          </Card>
        </ScrollReveal>
      </section>

      <DownloadModal open={dlOpen} onClose={() => setDlOpen(false)} />
    </main>
  );
}
