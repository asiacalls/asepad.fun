import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  ShieldCheck, Lock, KeyRound, Fingerprint, Smartphone, Cpu, Globe,
  ArrowLeft, Sparkles, Rocket, Eye, Bell,
  ChevronDown
} from "lucide-react";
import { cn } from "@/lib/cn";

export const metadata: Metadata = {
  title: "AseVault Security Report",
  description:
    "How AseVault keeps your wallet safe: post-quantum ML-DSA-65 signatures, hardware-backed encryption, and a full independent-style security review of the app.",
  alternates: { canonical: "/auditreport" },
  openGraph: {
    title: "AseVault Security Report | AsePad",
    description: "Post-quantum keys, hardware-backed vault, and a full security review of the AseVault wallet.",
    url: "/auditreport",
  },
};

/* ── primitives ────────────────────────────────────────────────────── */

const Kicker = ({ children }: { children: ReactNode }) => (
  <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-accent">{children}</p>
);

const H2 = ({ children }: { children: ReactNode }) => (
  <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{children}</h2>
);

const P = ({ children, className }: { children: ReactNode; className?: string }) => (
  <p className={cn("text-sm leading-relaxed text-white/80 sm:text-[15px]", className)}>{children}</p>
);

const Rating = ({ level }: { level: "strong" | "good" | "moderate" | "limited" }) => (
  <span className={cn(
    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider",
    level === "strong" && "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
    level === "good" && "border-accent/40 bg-accent/10 text-accent",
    level === "moderate" && "border-amber-400/40 bg-amber-400/10 text-amber-300",
    level === "limited" && "border-white/25 bg-white/[0.06] text-white/70",
  )}>
    <span className={cn(
      "h-1.5 w-1.5 rounded-full",
      level === "strong" && "bg-emerald-400",
      level === "good" && "bg-accent",
      level === "moderate" && "bg-amber-400",
      level === "limited" && "bg-white/40",
    )} />
    {level}
  </span>
);

function Feature({ icon: Icon, title, children }: { icon: typeof Lock; title: string; children: ReactNode }) {
  return (
    <div className="group rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5 transition hover:border-accent/30 hover:bg-white/[0.045]">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-accent/25 bg-accent/10 text-accent">
        <Icon className="h-4 w-4" />
      </div>
      <h3 className="mt-4 text-sm font-semibold text-white">{title}</h3>
      <p className="mt-1.5 text-[13px] leading-relaxed text-white/75">{children}</p>
    </div>
  );
}

function Faq({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="group rounded-2xl border border-white/[0.08] bg-white/[0.02] px-5 transition open:border-accent/25 open:bg-white/[0.04]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-4 text-sm font-medium text-white/85 marker:hidden [&::-webkit-details-marker]:hidden">
        {q}
        <ChevronDown className="h-4 w-4 shrink-0 text-white/35 transition-transform group-open:rotate-180" />
      </summary>
      <p className="pb-4 text-[13px] leading-relaxed text-white/75">{children}</p>
    </details>
  );
}

const SCORECARD: { area: string; rating: "strong" | "good" | "moderate" | "limited"; note: string }[] = [
  { area: "Key generation", rating: "strong", note: "256-bit entropy, 24-word phrase, post-quantum ML-DSA-65" },
  { area: "Encryption at rest", rating: "strong", note: "AES-256-GCM behind a hardware-gated vault key" },
  { area: "Secret handling", rating: "strong", note: "Keys live in memory only, wiped the moment you lock" },
  { area: "Spending authorization", rating: "strong", note: "Biometric or passcode gate on every send and reveal" },
  { area: "Brute-force protection", rating: "strong", note: "Escalating lockouts up to 10 hours, saved across restarts" },
  { area: "Backup & recovery", rating: "strong", note: "Masked phrase entry, 6-word confirmation, clipboard scrub" },
  { area: "dApp connections", rating: "strong", note: "Every request needs your approval; nothing signs silently" },
  { area: "Transaction safety", rating: "strong", note: "Exact-amount approvals, real fee estimates, replay protection" },
  { area: "On-screen privacy", rating: "strong", note: "Screenshot blocking, hidden lock-screen alerts, masked entry" },
  { area: "Network layer", rating: "good", note: "Everything over TLS; a bad server can mislead reads, never spend" },
  { area: "Device health checks", rating: "moderate", note: "Warns on emulators and custom ROMs; deeper checks need native modules" },
  { area: "Rooted phones", rating: "limited", note: "No software wallet can survive a fully compromised OS" },
];

function ScoreDonut() {
  const segs: { color: string; count: number }[] = [
    { color: "#34d399", count: 9 },   // strong - emerald
    { color: "#9be7ff", count: 1 },   // good - accent
    { color: "#fbbf24", count: 1 },   // moderate - amber
    { color: "#4b5563", count: 1 },   // limited - grey
  ];
  const total = segs.reduce((a, s) => a + s.count, 0);
  const R = 52;
  const C = 2 * Math.PI * R;
  const GAP = 2.5; // px of arc gap between segments
  let acc = 0;
  return (
    <div className="relative h-[168px] w-[168px] shrink-0">
      <svg viewBox="0 0 140 140" className="h-full w-full">
        <circle cx="70" cy="70" r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="14" />
        {segs.map((s, i) => {
          const len = (s.count / total) * C;
          const el = (
            <circle
              key={i}
              cx="70" cy="70" r={R}
              fill="none"
              stroke={s.color}
              strokeWidth="14"
              strokeDasharray={`${Math.max(0, len - GAP)} ${C - len + GAP}`}
              strokeDashoffset={-(acc) + C / 4}
              strokeLinecap="round"
            />
          );
          acc += len;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold tracking-tight text-white">9<span className="text-lg text-white/50">/12</span></span>
        <span className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.18em] text-emerald-300">Strong</span>
      </div>
    </div>
  );
}

const NEXT_STEPS = [
  { icon: Cpu, title: "Managed release signing", body: "Moving app signing to EAS-managed credentials so no build machine ever holds them directly." },
  { icon: Smartphone, title: "Deeper device checks", body: "A native module for stronger root and jailbreak detection beyond today's heuristics." },
  { icon: Eye, title: "Independent third-party review", body: "An external cryptography and mobile-security audit is planned before wider rollout." },
  { icon: Sparkles, title: "Continuous hardening", body: "Each release tightens something. Findings from this review feed straight into the roadmap." },
];

/* ── page ──────────────────────────────────────────────────────────── */

export default function AuditReportPage() {
  return (
    <main className="mx-auto w-full max-w-4xl px-5 pb-28 pt-10 sm:px-8">
      <Link href="/asevault" className="inline-flex items-center gap-1.5 text-sm font-medium text-white/60 transition hover:text-white">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to AseVault
      </Link>

      {/* hero */}
      <header className="relative mt-10 overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-accent/[0.09] via-white/[0.03] to-transparent p-7 sm:p-10">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-accent/10 blur-3xl" aria-hidden />
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300">
            <ShieldCheck className="h-3 w-3" /> Security report
          </span>
          <span className="rounded-full border border-white/15 bg-white/[0.05] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/70">App v1.1.1</span>
        </div>
        <h1 className="mt-5 max-w-xl text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Your keys never leave your phone.
        </h1>
        <P className="mt-4 max-w-xl">
          We reviewed the entire AseVault wallet, line by line: how keys are made, how the vault locks them away,
          how every transaction gets your approval first. Here is what it means for you, in plain words.
        </P>
        <p className="mt-6 text-xs text-white/60">Reviewed against the real app source · v1.1.1</p>
      </header>

      {/* verdict strip */}
      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        {[
          { icon: KeyRound, t: "Keys stay yours", d: "Created on your device with 256 bits of randomness. There is no server that could ever see or send them." },
          { icon: Fingerprint, t: "You approve everything", d: "Every spend, signature, and secret reveal asks for your fingerprint or passcode first. Nothing signs silently." },
          { icon: Cpu, t: "Post-quantum by design", d: "Signed with ML-DSA-65, the NIST standard built to resist even future quantum computers." },
        ].map((c) => (
          <div key={c.t} className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5">
            <c.icon className="h-5 w-5 text-accent" />
            <p className="mt-3 text-sm font-semibold text-white">{c.t}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-white/75">{c.d}</p>
          </div>
        ))}
      </div>

      {/* how it protects you */}
      <section className="mt-16">
        <Kicker>What we verified</Kicker>
        <H2>Six layers that keep the vault shut</H2>
        <div className="mt-7 grid gap-3 sm:grid-cols-2">
          <Feature icon={KeyRound} title="Keys are born on your device">
            A 24-word phrase built from 256 bits of operating-system randomness becomes your post-quantum
            keypair. The same phrase restores the same wallet in any official Asentum app, and it is shown to you exactly once.
          </Feature>
          <Feature icon={Lock} title="The vault is hardware-locked">
            Everything sits under AES-256-GCM encryption, and the key that opens it lives inside your phone&apos;s
            secure hardware (Android Keystore / iOS Keychain). Copying the app data gives an attacker unreadable ciphertext.
          </Feature>
          <Feature icon={Fingerprint} title="Every action needs you">
            Sends, signatures, exports, and dApp connections all pass a biometric or passcode gate.
            Approval screens show the real origin, amounts, and full payload before anything signs.
          </Feature>
          <Feature icon={Smartphone} title="Guessing is shut down">
            Wrong passcodes trigger escalating lockouts that climb to 10 hours and survive restarts.
            The answer is verified by actual decryption, not a stored check, so there is nothing to shortcut.
          </Feature>
          <Feature icon={Globe} title="dApps see approval screens, not keys">
            The in-app browser and deep-link connector validate origins, cap payloads, and route every
            request through the same human approval. A malicious site can ask; it cannot sign.
          </Feature>
          <Feature icon={Bell} title="Quiet by default">
            Notifications never show amounts, stay hidden on the lock screen, and the app blocks
            screenshots on every sensitive surface.
          </Feature>
        </div>
      </section>

      {/* scorecard */}
      <section className="mt-16">
        <Kicker>The scorecard</Kicker>
        <H2>How each area rated</H2>
        <P className="mt-3">Twelve areas, reviewed against the shipped code. Most landed at the top mark.</P>

        {/* score donut */}
        <div className="mt-6 flex flex-col items-center gap-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-7 sm:flex-row sm:gap-10">
          <ScoreDonut />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white">Overall: Strong</p>
            <p className="mt-1 text-[13px] leading-relaxed text-white/60">
              Nine of twelve areas earned the top mark. The rest reflect the honest limits of any mobile hot wallet
              and previews, not code flaws.
            </p>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
              {[
                ["Strong", "bg-emerald-400", "text-emerald-300", 9],
                ["Good", "bg-accent", "text-accent", 1],
                ["Moderate", "bg-amber-400", "text-amber-300", 1],
                ["Limited", "bg-white/40", "text-white/60", 1],
              ].map(([label, dot, text, n]) => (
                <span key={label as string} className={cn("inline-flex items-center gap-1.5 text-xs font-medium", text as string)}>
                  <span className={cn("h-2 w-2 rounded-full", dot as string)} />
                  {label} · {n}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6 overflow-hidden rounded-2xl border border-white/[0.08]">
          {SCORECARD.map((s, i) => (
            <div key={s.area} className={cn("flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between", i % 2 === 0 && "bg-white/[0.02]", i !== 0 && "border-t border-white/[0.05]")}>
              <div className="min-w-0">
                <p className="text-sm font-medium text-white/85">{s.area}</p>
                <p className="mt-0.5 text-xs text-white/65">{s.note}</p>
              </div>
              <Rating level={s.rating} />
            </div>
          ))}
        </div>
      </section>

      {/* honest notes */}
      <section className="mt-16">
        <Kicker>Straight talk</Kicker>
        <H2>Good to know</H2>
        <P className="mt-3">
          A trustworthy report says where the edges are. None of these can take your funds on a healthy phone,
          but you deserve to know them.
        </P>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {[
            { t: "Your phone + PIN is your wallet", d: "Whoever holds both can spend. Set a strong passcode, turn on biometrics, and keep your phrase written down somewhere offline." },
            { t: "Rooted phones weaken the walls", d: "A jailbroken or rooted OS can bypass the hardware protections every wallet relies on. AseVault warns when it detects a modified device." },
            { t: "Web builds are previews only", d: "Browsers have no secure hardware, so the web version is for testing, not for real funds. Production is iOS and Android." },
            { t: "A bad network can lie about numbers", d: "A hostile server could show wrong balances or quotes, but it can never move your funds. Every transaction still needs your local signature." },
            { t: "While unlocked, keys live in memory", d: "True of every software wallet. Auto-lock shrinks that window to minutes." },
            { t: "Keep installs official", d: "Only download the APK from asepad.fun. The team is moving release signing to fully managed credentials so updates stay verifiably ours." },
          ].map((c) => (
            <div key={c.t} className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
              <p className="text-sm font-semibold text-white">{c.t}</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-white/75">{c.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* what's next */}
      <section className="mt-16">
        <Kicker>The roadmap</Kicker>
        <H2>What the AsePad team is doing next</H2>
        <div className="mt-7 grid gap-3 sm:grid-cols-2">
          {NEXT_STEPS.map((s) => (
            <div key={s.title} className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 transition hover:border-accent/25">
              <s.icon className="h-5 w-5 text-accent" />
              <p className="mt-3 text-sm font-semibold text-white">{s.title}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-white/75">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* faq */}
      <section className="mt-16">
        <Kicker>Questions</Kicker>
        <H2>Frequently asked</H2>
        <div className="mt-7 space-y-2.5">
          <Faq q="Why should I use AseVault?">
            It is the first wallet built natively for Asentum&apos;s post-quantum signatures. It holds your ASE and
            ARC-20 tokens, connects to AsePad, AseDex, AURAS and other apps, and asks for your approval before
            anything signs. No account, no email, no custodian: the wallet lives on your device.
          </Faq>
          <Faq q="How secure is it, really?">
            Keys are generated with 256 bits of randomness, sealed under AES-256-GCM, and anchored to your phone&apos;s
            secure hardware. Every spend needs your fingerprint or passcode, and wrong guesses trigger lockouts that
            climb to ten hours. Nine of the twelve areas we reviewed rated Strong; the rest are the honest limits every
            mobile hot wallet shares.
          </Faq>
          <Faq q="Can AsePad or AseVault see my keys or phrase?">
            No. Keys are created and stored only on your device. Nothing, including us, ever receives them. The app has
            no accounts, no analytics of secrets, and no backend holding user data.
          </Faq>
          <Faq q="What does post-quantum actually mean for me?">
            Signatures use ML-DSA-65 (Dilithium3), a NIST-standard scheme designed to stay unforgeable even against
            future quantum computers. It is the same scheme the Asentum chain itself runs on, so your wallet is as
            future-proof as the network.
          </Faq>
          <Faq q="What happens if I lose my phone?">
            Your 24-word recovery phrase restores the same wallet on a new device, because key generation is fully
            deterministic. Write it down, keep it offline, and never store it in screenshots or cloud notes.
          </Faq>
          <Faq q="What if someone steals my phone?">
            They still cannot open the vault without your biometric or passcode, and passcode guesses are throttled
            hard. The encryption key sits in hardware the OS guards. If they somehow have your passcode too, restore
            your phrase on a new device and move funds.
          </Faq>
          <Faq q="Is the web or desktop version safe to use?">
            It is a development preview. Browsers have no secure hardware, so use it to explore, not to hold funds.
            The real security model applies to the iOS and Android apps.
          </Faq>
          <Faq q="How does the team keep improving security?">
            Each review turns findings into fixes. Recent passes added masked phrase entry, clipboard auto-clearing,
            stricter connection validation, and escalating lockouts. Next up: managed release signing, deeper device
            checks, and an independent third-party audit.
          </Faq>
        </div>
      </section>

      {/* footer note */}
      <div className="mt-16 flex flex-col items-start justify-between gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 sm:flex-row sm:items-center">
        <div>
          <p className="text-sm font-semibold text-white">Independent review welcome</p>
          <p className="mt-1 text-xs text-white/65">
            This report reflects the audited app source. A formal third-party review is encouraged before large-value use.
          </p>
        </div>
        <Link
          href="/asevault"
          className="inline-flex shrink-0 items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-5 py-2.5 text-sm font-semibold text-accent transition hover:bg-accent/20"
        >
          <Rocket className="h-4 w-4" /> Explore AseVault
        </Link>
      </div>
    </main>
  );
}
