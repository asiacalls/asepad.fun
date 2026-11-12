import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, KeyRound, ShieldCheck, Globe, Database, Smartphone, FileText } from "lucide-react";
import { cn } from "@/lib/cn";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How asepad.fun handles your information: a fully decentralized, non-custodial platform that never sees your private keys, collects no accounts, and reads everything straight from the Asentum blockchain.",
  alternates: { canonical: "/privacypolicy" },
  openGraph: {
    title: "Privacy Policy | AsePad",
    description: "Decentralized by design: no accounts, no key custody, no tracking.",
    url: "/privacypolicy",
  },
};

/* ── primitives ────────────────────────────────────────────────────── */

const H2 = ({ children }: { children: ReactNode }) => (
  <h2 className="text-lg font-semibold tracking-tight text-white sm:text-xl">{children}</h2>
);

const P = ({ children, className }: { children: ReactNode; className?: string }) => (
  <p className={cn("mt-2 text-sm leading-relaxed text-white/65 sm:text-[15px]", className)}>{children}</p>
);

const Li = ({ children }: { children: ReactNode }) => (
  <li className="flex items-start gap-2.5 text-sm leading-relaxed text-white/65 sm:text-[15px]">
    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent/70" />
    <span>{children}</span>
  </li>
);

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="mt-10 border-t border-white/[0.07] pt-7 first:mt-8 first:border-0 first:pt-0">
    <H2>{title}</H2>
    {children}
  </section>
);

/* ── page ──────────────────────────────────────────────────────────── */

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-16 sm:px-6 md:pb-20 md:pt-20">
      <Link href="/" className="inline-flex items-center gap-1.5 text-xs font-medium text-white/50 transition hover:text-white">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to AsePad
      </Link>

      <header className="mt-6">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/[0.08] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-accent">
          <ShieldCheck className="h-3 w-3" /> Privacy
        </span>
        <h1 className="text-chrome-gradient text-neon mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
          Privacy Policy
        </h1>
        <P className="mt-3 max-w-xl">
          AsePad is a decentralized platform. There are no accounts, no sign ups, and no servers holding
          anything about you. This page explains, in plain words, exactly what the site does and does not touch.
        </P>
        <p className="mt-4 text-xs text-white/40">Applies to asepad.fun and every page on it · Last updated March 2026</p>
      </header>

      <Section title="1. What asepad.fun actually is">
        <P>
          This website is a window onto smart contracts running on the Asentum blockchain. AsePad (the
          launchpad), AseDex (the exchange), AseLock (token locking and vesting) and the ARC-20 factory are
          contracts, not company servers. When you trade, launch a token, add liquidity or lock LP, your
          wallet signs a transaction and the contract executes it directly. We never sit in the middle.
        </P>
        <P>
          Because the platform is fully decentralized, there is no account database, no login system and no
          central store of user information that could be sold, leaked or handed over. The contracts hold
          assets; the chain holds the public record; your device holds your keys.
        </P>
      </Section>

      <Section title="2. Your keys are never ours">
        <ul className="mt-3 space-y-2">
          <Li><span className="font-semibold text-white/85">We never see your private keys.</span> The site never asks for, receives, stores or transmits private keys, seed phrases, mnemonics or wallet passwords. There is no code path on this site that could.</Li>
          <Li><span className="font-semibold text-white/85">Signing stays inside your wallet.</span> Every transaction is built in the open, sent to your wallet, and signed there. Whether you use AseVault or another wallet, the signature happens on your device, not on our site.</Li>
          <Li><span className="font-semibold text-white/85">Connecting shares only an address.</span> When you connect a wallet, the only thing the site learns is your public address, the same thing anyone can already see on the chain.</Li>
          <Li><span className="font-semibold text-white/85">We cannot move your funds.</span> Non-custodial means we have no ability to withdraw, freeze, reverse or recover anything. Only the keys on your device can authorize a transaction.</Li>
        </ul>
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-accent/20 bg-accent/[0.06] p-4">
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <p className="text-[13px] leading-relaxed text-white/75">
            If any page, app or person claiming to be AsePad ever asks for your seed phrase or private key,
            it is not us. Close it.
          </p>
        </div>
      </Section>

      <Section title="3. What we do not collect">
        <ul className="mt-3 space-y-2">
          <Li>No accounts, emails, phone numbers, names or passwords.</Li>
          <Li>No identity verification or KYC data.</Li>
          <Li>No tracking cookies, advertising trackers, or cross site fingerprinting.</Li>
          <Li>No analytics profiles tied to you as a person.</Li>
          <Li>No transaction history stored about you beyond what the public blockchain already records.</Li>
        </ul>
      </Section>

      <Section title="4. What the site works with">
        <P>To show you live markets and let your wallet talk to the chain, the site does read and send some data:</P>
        <ul className="mt-3 space-y-2">
          <Li><span className="font-semibold text-white/85">Public blockchain data.</span> Prices, pools, trades, locks and launch progress are read directly from the Asentum contracts. Your balances and positions come from the same public state.</Li>
          <Li><span className="font-semibold text-white/85">Your public address.</span> When connected, the site queries the chain for that address so it can show your holdings, orders, locks and vesting claims.</Li>
          <Li><span className="font-semibold text-white/85">Transaction requests.</span> When you act, the site builds an unsigned transaction and hands it to your wallet. Only you can sign it.</Li>
          <Li><span className="font-semibold text-white/85">Local storage on your device.</span> Small preferences live in your browser only, never on our servers: favorite pairs, display settings, and your last connected address so reconnecting is one tap. Clearing your browser storage removes them completely.</Li>
        </ul>
      </Section>

      <Section title="5. The blockchain is public by nature">
        <P>
          Everything that settles on Asentum is a public, permanent record: addresses, amounts, trades,
          launches, LP positions and lock schedules. Anyone in the world can look them up on the explorer,
          with or without this site. That transparency is the point of the platform, but it also means:
        </P>
        <ul className="mt-3 space-y-2">
          <Li>Never put personal information in token names, descriptions or on chain fields.</Li>
          <Li>On chain data cannot be edited or deleted by us or anyone else.</Li>
          <Li>Your address is pseudonymous, not anonymous. Treat it accordingly.</Li>
        </ul>
      </Section>

      <Section title="6. Infrastructure and third parties">
        <P>The site is static and served through a CDN. To work it contacts a small set of services:</P>
        <ul className="mt-3 space-y-2">
          <Li><span className="font-semibold text-white/85">Asentum network nodes.</span> Your browser sends read requests and signed transactions to public Asentum RPC endpoints, either directly or through the site's relay. Like any web request, these technically include your IP address, handled by the infrastructure that routes them.</Li>
          <Li><span className="font-semibold text-white/85">The market indexer.</span> Pool stats, charts and trade history are served by an indexer that reads the same public chain data. It knows markets, not identities.</Li>
          <Li><span className="font-semibold text-white/85">Hosting.</span> Pages are delivered by our CDN provider, which processes standard connection data such as IP addresses as part of serving any website.</Li>
          <Li><span className="font-semibold text-white/85">External links.</span> Links to the explorer, auras.finance, our X and Telegram channels take you to services run by others. Their own policies apply there.</Li>
          <Li><span className="font-semibold text-white/85">Wallet apps.</span> Connecting through AseVault or another wallet involves that app's own software and policies. Your signature approvals happen inside it.</Li>
        </ul>
      </Section>

      <Section title="7. AseVault, our mobile wallet">
        <P>
          AseVault follows the same rule: keys are generated and stored on your phone, encrypted under your
          biometrics or passcode, and never sent anywhere. The app talks to the chain directly. Nothing in
          the wallet or this site can see your recovery phrase after setup, so nobody can recover it for you.
        </P>
        <P>
          The full security review is on the <Link href="/auditreport" className="font-medium text-accent underline underline-offset-2 transition hover:text-white">audit report page</Link>.
        </P>
      </Section>

      <Section title="8. Your choices">
        <ul className="mt-3 space-y-2">
          <Li><span className="font-semibold text-white/85">Browse without connecting.</span> Every market, launch and lock is readable without a wallet connected.</Li>
          <Li><span className="font-semibold text-white/85">Clear local data anytime.</span> Your browser's site settings wipe every stored preference instantly.</Li>
          <Li><span className="font-semibold text-white/85">Use your own RPC.</span> Advanced users can point the app at a custom RPC endpoint if they prefer.</Li>
          <Li><span className="font-semibold text-white/85">Verify everything.</span> Contract addresses are listed on the <Link href="/docs/contracts" className="font-medium text-accent underline underline-offset-2 transition hover:text-white">contracts page</Link>, and every transaction links to the public explorer.</Li>
        </ul>
      </Section>

      <Section title="9. Children">
        <P>
          The platform is not directed at anyone under 18. Since we collect nothing, we also cannot verify
          ages. Anyone using a wallet to interact with public blockchain applications is responsible for
          their own activity.
        </P>
      </Section>

      <Section title="10. Changes to this policy">
        <P>
          If this policy changes, the updated version will be posted at this same address before it takes
          effect. Because the platform is decentralized, no change here can ever affect your keys, your
          assets or the contracts themselves.
        </P>
      </Section>

      <Section title="11. Contact">
        <P>
          Questions about this policy or the platform reach us through the official channels listed on the
          site: <a href="https://x.com/asepadfun" target="_blank" rel="noreferrer" className="font-medium text-accent underline underline-offset-2 transition hover:text-white">x.com/asepadfun</a> and <a href="https://t.me/asepadfun" target="_blank" rel="noreferrer" className="font-medium text-accent underline underline-offset-2 transition hover:text-white">t.me/asepadfun</a>. This page is informational and not legal advice.
        </P>
      </Section>

      <footer className="mt-14 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/[0.07] pt-6 text-[11px] text-white/35">
        <span className="inline-flex items-center gap-1.5"><Globe className="h-3 w-3" /> asepad.fun</span>
        <span className="inline-flex items-center gap-1.5"><Database className="h-3 w-3" /> Fully decentralized, non-custodial</span>
        <span className="inline-flex items-center gap-1.5"><Smartphone className="h-3 w-3" /> Keys stay on your device</span>
        <span className="inline-flex items-center gap-1.5"><FileText className="h-3 w-3" /> Public chain data only</span>
      </footer>
    </main>
  );
}
