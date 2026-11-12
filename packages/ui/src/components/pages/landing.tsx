"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight, Coins, Droplets, Percent, Rocket, ShieldCheck, Smartphone, TrendingUp, Zap
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { ScrollReveal } from "@/components/motion/scroll-reveal";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  asepadGetLatestLaunches, asepadPeekLaunches, asepadGetStats, fmtAse, fmtAseCompact, fmtTokens, linkUrl
} from "@/lib/asepad";
import { SocialLinks } from "@/components/social-links";
import { cn } from "@/lib/cn";
import { toAseAddress } from "@asentrise/utils";
import { href as siteHref } from "@/lib/site";

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

export function LandingPage() {
  const stats = useQuery({ queryKey: ["asepad-stats"], queryFn: asepadGetStats, staleTime: 0 });
  // Keyed under "asepad-launches" so it shares the sweep memo + persisted cache
  // and stays out of the per-block "asepad" invalidation root.
  // Fast path: newest 40 via one apiLaunches read — AWS-indexer ordered, no
  // chain enumeration. Warm persisted records still paint instantly via the peek.
  const launches = useQuery({
    queryKey: ["asepad-launches", "landing"],
    queryFn: async () => ({ launches: await asepadGetLatestLaunches(40) }),
    initialData: () => {
      const peek = asepadPeekLaunches("new");
      return peek?.launches.length ? peek : undefined;
    },
    initialDataUpdatedAt: () => 0,
    staleTime: 0
  });

  const statItems = [
    { label: "Tokens launched", v: stats.data?.launches },
    { label: "Migrated to AseDex", v: stats.data?.migrated },
    { label: "Real ASE TVL", v: stats.data ? `${fmtAseCompact(stats.data.tvlWei)} ASE` : undefined },
    { label: "Total volume", v: stats.data ? `${fmtAseCompact(stats.data.volumeWei)} ASE` : undefined }
  ];

  return (
    <main className="relative">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative w-full overflow-hidden">
        <Image src="/brand/asepad-hero.png" alt="" fill priority sizes="100vw" className="hidden object-cover object-center opacity-60 sm:block" />
        {/* mobile: whole image visible — contain, never zoom/crop */}
        <Image src="/brand/mobileview-hero.png" alt="" fill priority sizes="100vw" className="object-contain object-top opacity-60 sm:hidden" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/40 via-black/60 to-[#05060a]" aria-hidden />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#05060a] to-transparent" aria-hidden />

        <div className="relative mx-auto flex max-w-4xl flex-col items-center px-4 pb-20 pt-28 text-center sm:pt-36 md:pt-44">
          <motion.div {...fadeUp} transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-4 py-1.5 text-xs font-medium text-white/70 backdrop-blur">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            Live on Asentum Testnet
          </motion.div>

          <motion.h1 {...fadeUp} transition={{ duration: 0.7, delay: 0.08 }}
            className="mt-6 text-4xl font-semibold tracking-tight sm:text-5xl md:text-6xl">
            Launch tokens on{" "}
            <span className="bg-gradient-to-r from-white via-chrome-300 to-chrome-500 bg-[length:200%_auto] bg-clip-text text-transparent animate-shimmer">
              Asentum
            </span>
          </motion.h1>

          <motion.p {...fadeUp} transition={{ duration: 0.7, delay: 0.16 }}
            className="mt-5 max-w-2xl text-sm leading-relaxed text-white/60 md:text-lg">
            The first post-quantum launchpad and the very first ecosystem on the Asentum blockchain. Create a token in seconds, open an instant bonding-curve market, and let liquidity migrate to AseDex automatically. LP burned forever, no rugs by design.
          </motion.p>

          <motion.div {...fadeUp} transition={{ duration: 0.7, delay: 0.24 }}
            className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg">
              <Link prefetch={false} href={siteHref("/create")}>Launch a token <ArrowRight className="ml-1.5 h-4 w-4" /></Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link prefetch={false} href={siteHref("/asepad")}>Explore AsePad</Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link prefetch={false} href={siteHref("/asevault")}><Smartphone className="mr-1.5 h-4 w-4" /> Get AseVault</Link>
            </Button>
            <Button asChild variant="ghost" size="lg">
              <Link prefetch={false} href={siteHref("/docs")}>Read docs</Link>
            </Button>
          </motion.div>

          <motion.div {...fadeUp} transition={{ duration: 0.7, delay: 0.3 }} className="mt-6 flex justify-center">
            <SocialLinks />
          </motion.div>

          {/* live stats strip */}
          <motion.div {...fadeUp} transition={{ duration: 0.7, delay: 0.34 }}
            className="mt-14 grid w-full grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 backdrop-blur-md sm:grid-cols-4">
            {statItems.map((s) => (
              <div key={s.label} className="bg-black/50 px-4 py-5">
                <p className="text-[11px] uppercase tracking-wider text-white/60">{s.label}</p>
                {s.v != null
                  ? <p className="mt-1.5 text-2xl font-bold tracking-tight">{s.v}</p>
                  : <Skeleton className="mt-2 h-7 w-24" />}
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 py-16 md:py-20">
        <ScrollReveal>
          <SectionTitle
            eyebrow="HOW IT WORKS"
            title="Launch to liquidity in three steps"
            desc="No presales and no team allocation spreadsheets. A fair, contract-run curve from first buy to a real market."
          />
        </ScrollReveal>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {[
            { n: "01", icon: Rocket, t: "Create & launch", d: "Pick a fixed-supply ARC-20 or an AsePad launch. Metadata, logo, and socials go on-chain with it." },
            { n: "02", icon: TrendingUp, t: "Bond the curve", d: "Trades settle instantly against the bonding curve, with real ASE reserves priced by math, not listings." },
            { n: "03", icon: Droplets, t: "Migrate & burn", d: "At the bonding target, liquidity moves into a fresh AseDex pool and every LP share is burned permanently." }
          ].map((s, i) => (
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
      </section>

      {/* ── Live launches ────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 pb-16 md:pb-20">
        <ScrollReveal>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-xs font-semibold tracking-[0.22em] text-chrome-400/90">LIVE NOW</div>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">Launches on the curve</h2>
            </div>
            <Button asChild variant="secondary">
              <Link prefetch={false} href={siteHref("/asepad")}>View all <ArrowRight className="ml-1.5 h-4 w-4" /></Link>
            </Button>
          </div>
        </ScrollReveal>

        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {launches.isPending ? (
            Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)
          ) : (launches.data?.launches ?? []).filter((l) => l.status === "BONDING").length === 0 ? (
            <div className="col-span-full rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-10 text-center">
              <p className="text-sm text-white/55">No launches yet, the first one is yours to make.</p>
              <Button asChild className="mt-4"><Link prefetch={false} href={siteHref("/create")}>Create token</Link></Button>
            </div>
          ) : (
            (launches.data?.launches ?? [])
              .filter((l) => l.status === "BONDING")
              .sort((a, b) => Number(b.createdTs || "0") - Number(a.createdTs || "0"))
              .slice(0, 6).map((launch) => {
              const pct = Math.min(100, (launch.progressBps ?? 0) / 100);

              return (
                <Link key={launch.token} prefetch={false} href={siteHref(`/asepad/token/${toAseAddress(launch.token)}`)}
                  className="group rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-chrome-400/30 hover:bg-white/[0.05]">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {linkUrl(launch.meta?.logoUrl) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={linkUrl(launch.meta?.logoUrl)} alt="" className="h-11 w-11 rounded-full border border-white/10 object-cover" />
                      ) : (
                        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-chrome-400/30 to-zinc-500/30 text-sm font-bold">
                          {(launch.symbol || "?").slice(0, 2)}
                        </div>
                      )}
                      <div>
                        <p className="font-semibold leading-tight">{launch.name}</p>
                        <p className="text-xs text-white/65">${launch.symbol || "?"}</p>
                      </div>
                    </div>
                    <StatusBadge status={launch.status} lpBurned={launch.lpBurned} liveLabel="BONDED" />
                  </div>
                  <div className="mt-4 flex items-center justify-between text-[11px] text-white/65">
                    <span>Bonding {pct.toFixed(1)}%</span>
                    <span className="font-mono">{fmtAse(launch.reserve, 1)} / {fmtAse(launch.targetWei ?? "0", 0)} ASE</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-gradient-to-r from-zinc-400 via-zinc-100 to-zinc-400 transition-all" style={{ width: `${Math.max(2, pct)}%` }} />
                  </div>
                  <div className="mt-3 flex justify-between text-[11px] text-white/60">
                    <span>Volume <span className="font-mono text-white/60">{fmtAse(launch.volume, 1)} ASE</span></span>
                    <span>Supply <span className="font-mono text-white/60">{fmtTokens(launch.supply)}</span></span>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </section>

      {/* ── Three launch paths ───────────────────────────────── */}
      <section className="border-y border-white/[0.06] bg-white/[0.02] py-16 md:py-20">
        <div className="mx-auto max-w-7xl px-4">
          <ScrollReveal>
            <SectionTitle
              eyebrow="THREE WAYS TO LAUNCH"
              title="Pick your launch"
              desc="A clean self-custodial token, a taxed token with locked fees, or a fully managed bonding-curve launch. All signed by your wallet, backed by contracts."
            />
          </ScrollReveal>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <ScrollReveal>
              <Link prefetch={false} href={siteHref("/create")}
                className="group flex h-full flex-col rounded-2xl border border-white/10 bg-[#0b0d14] p-7 transition hover:border-chrome-400/30">
                <Coins className="h-7 w-7 text-chrome-300" />
                <h3 className="mt-4 text-xl font-semibold">Standard token</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/55">
                  Deploy a fixed-supply ARC-20 with your chosen decimals. No taxes, no hidden mint, the entire supply lands in your wallet.
                </p>
                <ul className="mt-4 space-y-1.5 text-xs text-white/65">
                  <li>You hold 100% of the supply</li>
                  <li>Configurable supply &amp; decimals</li>
                  <li>Registered with the platform factory</li>
                </ul>
                <span className="mt-6 inline-flex items-center text-sm font-medium text-chrome-300 group-hover:text-white">
                  Create token <ArrowRight className="ml-1.5 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            </ScrollReveal>
            <ScrollReveal delay={0.06}>
              <Link prefetch={false} href={siteHref("/create")}
                className="group flex h-full flex-col rounded-2xl border border-white/10 bg-[#0b0d14] p-7 transition hover:border-chrome-400/30">
                <Percent className="h-7 w-7 text-chrome-300" />
                <h3 className="mt-4 text-xl font-semibold">Tax token</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/55">
                  Deploy an ARC-20 with buy and sell fees locked at deploy. Every trade sends its tax to your wallet automatically.
                </p>
                <ul className="mt-4 space-y-1.5 text-xs text-white/65">
                  <li>Buy &amp; sell tax rates set at deploy</li>
                  <li>Fees locked in the contract, paid to your tax wallet</li>
                  <li>Registered with the platform factory</li>
                </ul>
                <span className="mt-6 inline-flex items-center text-sm font-medium text-chrome-300 group-hover:text-white">
                  Create tax token <ArrowRight className="ml-1.5 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            </ScrollReveal>
            <ScrollReveal delay={0.12} className="sm:col-span-2 lg:col-span-1">
              <Link prefetch={false} href={siteHref("/create")}
                className="group flex h-full flex-col rounded-2xl border border-chrome-400/20 bg-gradient-to-b from-chrome-400/[0.08] to-transparent p-7 transition hover:border-chrome-400/40">
                <Zap className="h-7 w-7 text-chrome-200" />
                <h3 className="mt-4 text-xl font-semibold">AsePad launch</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/55">
                  The fair-launch curve: instant buys and sells on real reserves, a bonding target, and automatic migration to AseDex.
                </p>
                <ul className="mt-4 space-y-1.5 text-xs text-white/65">
                  <li>Instant trading on the bonding curve</li>
                  <li>Liquidity migrates to AseDex at the target</li>
                  <li>LP shares burned, liquidity can never be pulled</li>
                </ul>
                <span className="mt-6 inline-flex items-center text-sm font-medium text-white group-hover:text-chrome-200">
                  Launch on the curve <ArrowRight className="ml-1.5 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            </ScrollReveal>
          </div>
        </div>
      </section>

      {/* ── Why AsePad ───────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 py-16 md:py-20">
        <ScrollReveal>
          <SectionTitle
            eyebrow="WHY ASEPAD"
            title="Built for fair launches"
            desc="Every rule lives in the contract, not in a backend, not in a promise."
          />
        </ScrollReveal>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { icon: ShieldCheck, t: "Rug-proof liquidity", d: "LP shares are burned to the zero address at migration. Nobody can ever withdraw the pool." },
            { icon: Zap, t: "Instant settlement", d: "Buys and sells settle in the same transaction, no pending sells, no queued payouts." },
            { icon: Coins, t: "Creator rewards", d: "Creators earn a fixed reward at bonding, set by the contract and paid automatically." }
          ].map((f, i) => (
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

      {/* ── CTA band ─────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 pb-20">
        <ScrollReveal>
          <Card className="relative overflow-hidden border-chrome-400/20 bg-gradient-to-r from-chrome-400/[0.08] via-white/[0.03] to-transparent">
            <CardContent className="flex flex-col items-start gap-5 p-8 md:flex-row md:items-center md:justify-between md:p-10">
              <div>
                <h3 className="text-2xl font-semibold tracking-tight md:text-3xl">Ready to launch?</h3>
                <p className="mt-2 max-w-lg text-sm text-white/55">
                  Deploy a token or open a bonding curve on Asentum. Two signatures, no backend, no waiting for listings.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button asChild size="lg"><Link prefetch={false} href={siteHref("/create")}>Create token</Link></Button>
                <Button asChild variant="secondary" size="lg"><Link prefetch={false} href={siteHref("/asepad")}>Browse launches</Link></Button>
              </div>
            </CardContent>
          </Card>
        </ScrollReveal>
      </section>
    </main>
  );
}
