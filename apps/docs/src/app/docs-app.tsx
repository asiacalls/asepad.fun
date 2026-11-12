"use client";

import { useEffect, useState, type ReactNode } from "react";
import { DOC_META } from "./docs-meta";
import Link from "next/link";
import {
  ArrowDownUp, BookOpen, FilePlus2, Flame, LayoutDashboard,
  LineChart, LockKeyhole, PanelLeftOpen, Rocket, ScrollText, ShieldCheck, TrendingUp, Vault as VaultIcon,
  Wallet as WalletIcon, X, Zap, type LucideIcon
} from "lucide-react";
import { cn } from "@/lib/cn";
import { explorerAddressUrl } from "@/lib/explorer";
import { useQuery } from "@tanstack/react-query";
import { asepadGetConfig, getStandardTokenFeeWei, getTaxTokenFeeWei, fmtAse } from "@/lib/asepad";
import { href as siteHref } from "@/lib/site";

/* ── prose primitives ──────────────────────────────────────────────── */

// Deploy costs read the live fee from the contracts (AsePad creationFeeWei,
// factory token_deploy:STANDARD / token_deploy:TAX) so an owner-side fee
// change never leaves the docs stale.
function DeployCost({ kind, bare }: { kind: "pad" | "standard" | "tax"; bare?: boolean }) {
  const q = useQuery({
    queryKey: ["docs-deploy-fee", kind],
    queryFn: () =>
      kind === "pad"
        ? asepadGetConfig().then((c) => c.config?.creationFeeWei ?? "")
        : kind === "standard" ? getStandardTokenFeeWei() : getTaxTokenFeeWei(),
    staleTime: 60_000
  });
  const fee = q.data ? `${fmtAse(q.data, 0)} ASE` : "…";
  return <>{bare ? fee : `${fee} plus gas`}</>;
}

const P = ({ children }: { children: ReactNode }) => (
  <p className="mt-3 text-sm leading-relaxed text-white/65">{children}</p>
);
const H = ({ id, children }: { id: string; children: ReactNode }) => (
  <h2 id={id} className="mt-10 scroll-mt-28 border-t border-white/[0.06] pt-7 text-lg font-semibold tracking-tight text-white">
    {children}
  </h2>
);
const Ul = ({ children }: { children: ReactNode }) => (
  <ul className="mt-3 space-y-2 text-sm leading-relaxed text-white/65">{children}</ul>
);
const Li = ({ children }: { children: ReactNode }) => (
  <li className="flex gap-2.5">
    <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-accent/70" aria-hidden />
    <span className="min-w-0">{children}</span>
  </li>
);
const Code = ({ children }: { children: ReactNode }) => (
  <code className="rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-[11px] text-white/85">{children}</code>
);
const Tag = ({ tone = "neutral", children }: { tone?: "neutral" | "purple" | "white" | "accent"; children: ReactNode }) => (
  <span className={cn("mx-0.5 inline-flex items-center rounded border px-1.5 py-px align-middle font-mono text-[9px] font-bold uppercase tracking-wider",
    tone === "neutral" && "border-white/15 bg-white/[0.06] text-white/70",
    tone === "purple" && "border-violet-400/30 bg-violet-500 text-white",
    tone === "white" && "border-white bg-white text-black",
    tone === "accent" && "border-accent/40 bg-accent/15 text-accent")}>
    {children}
  </span>
);
const Callout = ({ tone = "accent", title, children }: { tone?: "accent" | "amber" | "rose"; title: string; children: ReactNode }) => (
  <div className={cn("mt-5 rounded-xl border p-4",
    tone === "accent" && "border-accent/25 bg-accent/[0.07]",
    tone === "amber" && "border-amber-400/25 bg-amber-400/[0.06]",
    tone === "rose" && "border-rose-400/25 bg-rose-400/[0.06]")}>
    <p className={cn("text-[10px] font-bold uppercase tracking-[0.18em]",
      tone === "accent" ? "text-accent" : tone === "amber" ? "text-amber-300" : "text-rose-300")}>{title}</p>
    <div className="mt-1.5 text-sm leading-relaxed text-white/70">{children}</div>
  </div>
);
const Tbl = ({ head, rows }: { head: string[]; rows: ReactNode[][] }) => (
  <div className="mt-4 overflow-x-auto rounded-xl border border-white/[0.07]">
    <table className="w-full min-w-[480px] text-left text-[13px]">
      <thead>
        <tr className="border-b border-white/[0.07] bg-white/[0.03]">
          {head.map((h) => <th key={h} className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-white/55">{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-white/[0.04] last:border-0">
            {r.map((c, j) => <td key={j} className="px-4 py-2.5 align-top text-white/65 first:font-medium first:text-white/85">{c}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
const DocLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link href={href} className="font-medium text-accent underline-offset-2 transition hover:text-white hover:underline">{children}</Link>
);
/* Replicas of the real row tags, so docs show exactly what the app renders. */
const PadTagIcon = ({ label = false }: { label?: boolean }) => (
  <span title="AsePad Migrated · view token page" className={cn("mx-0.5 inline-flex h-5 shrink-0 items-center justify-center gap-1 rounded-full border border-accent/40 bg-accent/15 align-middle text-accent", label ? "px-2" : "w-5")}>
    <Rocket className="h-3 w-3" />
    {label ? <span className="text-[10px] font-bold uppercase leading-none tracking-wider">AsePad</span> : null}
  </span>
);
const BurnTagIcon = ({ label = false }: { label?: boolean }) => (
  <span title="Burn 100% · view burn transaction" className={cn("mx-0.5 inline-flex h-5 shrink-0 items-center justify-center gap-1 rounded-full border border-orange-500/40 bg-orange-500/15 align-middle text-orange-400 shadow-[0_0_10px_rgba(249,115,22,0.25)]", label ? "px-2" : "w-5")}>
    <Flame className="h-3 w-3" />
    {label ? <span className="text-[10px] font-bold leading-none">Burn 100%</span> : null}
  </span>
);
const LowLpTagIcon = () => (
  <span title="Pool reserves are too thin to price this market, headline stats are hidden" className="mx-0.5 inline-flex h-4 shrink-0 items-center rounded-full border border-amber-400/40 bg-amber-400/15 px-1.5 align-middle text-[8px] font-bold uppercase leading-none tracking-wider text-amber-300">Low LP</span>
);
const HotTagIcon = ({ rank }: { rank: number }) => (
  <span title={`#${rank} on Trending`} className="mx-0.5 inline-flex items-center gap-0.5 rounded-full border border-orange-400/40 bg-orange-400/10 px-1.5 py-px align-middle text-[9px] font-bold text-orange-300">
    <Flame className="h-2.5 w-2.5" />HOT #{rank}
  </span>
);
const AseDexTagIcon = () => (
  <span title="AseDex pool" className="mx-0.5 inline-flex h-5 shrink-0 items-center rounded-full border border-white/25 bg-white/10 px-2 align-middle text-[10px] font-bold uppercase leading-none tracking-wider text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]">ASEDEX</span>
);
const AurasTagIcon = () => (
  <span title="AURAS pool" className="mx-0.5 inline-flex h-5 shrink-0 items-center rounded-full border border-violet-300/40 bg-violet-400/20 px-2 align-middle text-[10px] font-bold uppercase leading-none tracking-wider text-violet-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]">AURAS</span>
);

/* ── navigation tree ───────────────────────────────────────────────── */

type NavPage = { slug: string; title: string; icon: LucideIcon };
type DocGroup = { group: string; pages: NavPage[] };

const NAV: DocGroup[] = [
  {
    group: "Start here",
    pages: [
      { slug: "welcome", title: "Welcome", icon: BookOpen },
      { slug: "getting-started", title: "Getting started", icon: Zap }
    ]
  },
  {
    group: "AsePad launchpad",
    pages: [
      { slug: "create-token", title: "Create a token", icon: FilePlus2 },
      { slug: "launch-page", title: "Launch page", icon: Rocket },
      { slug: "bonding-curve", title: "Bonding curve", icon: TrendingUp },
      { slug: "migration", title: "Migration & LP burn", icon: Flame }
    ]
  },
  {
    group: "AseDex exchange",
    pages: [
      { slug: "terminal", title: "Terminal", icon: LayoutDashboard },
      { slug: "orders", title: "Swap, Limit & DCA", icon: ArrowDownUp },
      { slug: "markets", title: "Radar, Markets & Pools", icon: LineChart },
      { slug: "wallet", title: "Wallet & PnL", icon: WalletIcon }
    ]
  },
  {
    group: "AseLock",
    pages: [
      { slug: "token-lock", title: "Lock & vesting", icon: LockKeyhole }
    ]
  },
  {
    group: "AseVault wallet",
    pages: [
      { slug: "asevault", title: "AseVault wallet", icon: VaultIcon }
    ]
  },
  {
    group: "Reference",
    pages: [
      { slug: "auras", title: "AURAS pools", icon: LineChart },
      { slug: "contracts", title: "Platform contracts", icon: ScrollText },
      { slug: "fees-safety", title: "Fees & safety", icon: ShieldCheck }
    ]
  }
];

/* ── pages ─────────────────────────────────────────────────────────── */

type DocSection = { id: string; label: string };
type DocPage = NavPage & { intro: string; toc: DocSection[]; body: ReactNode };

export const PAGES: DocPage[] = [
  {
        slug: "welcome", ...DOC_META["welcome"], icon: BookOpen,
    toc: [
      { id: "products", label: "What you can do here" },
      { id: "safe", label: "Why it is safe" },
      { id: "network", label: "Network" }
    ],
    body: (
      <>
        <P>AsePad is the first post-quantum launchpad on Asentum and the very first ecosystem on the Asentum blockchain. Launchpad, exchange, and wallet, all secured by the post-quantum signatures the network is built on.</P>
        <H id="products">What you can do here</H>
        <Ul>
          <Li><span className="font-semibold text-white/85">Launch a token.</span> Pick a name, a picture, and your launch goes live instantly with its own price curve. Anyone can buy and sell from the first second.</Li>
          <Li><span className="font-semibold text-white/85">Buy and sell on the curve.</span> Early tokens trade on the launch page. The more people buy, the higher the price climbs. Selling pays you out instantly.</Li>
          <Li><span className="font-semibold text-white/85">Trade on the exchange.</span> Tokens that finish their curve move to AseDex, our full trading terminal with charts, orders, and liquidity pools.</Li>
        </Ul>
        <H id="safe">Why it is safe</H>
        <Ul>
          <Li><span className="font-semibold text-white/85">Liquidity is burned forever.</span> When a launch graduates to the exchange, its pool shares are sent to the dead address. The liquidity can never be pulled, not even by the token creator.</Li>
          <Li><span className="font-semibold text-white/85">Sells always work.</span> Selling on the curve pays out instantly in the same transaction. Your money never gets stuck in a pending state.</Li>
          <Li><span className="font-semibold text-white/85">No middleman.</span> You trade directly with the smart contracts from your own wallet. We never hold your funds or your tokens.</Li>
          <Li><span className="font-semibold text-white/85">Verified tokens.</span> Tokens launched through AsePad carry a Verified badge so you know they came from the standard contract, not a copy.</Li>
        </Ul>
        <H id="network">Network</H>
        <P>AsePad runs on the Asentum network and is currently on testnet, so tokens here are for testing. Prices, balances, and pools are real on the chain and can always be checked on the explorer.</P>
        <Callout title="Good to know">
          Everything the site shows comes straight from the chain. If the site ever looks empty, the contracts still hold your tokens and liquidity.
        </Callout>
      </>
    )
  },
  {
        slug: "getting-started", ...DOC_META["getting-started"], icon: Zap,
    toc: [
      { id: "wallet", label: "Connect your wallet" },
      { id: "ase", label: "Get ASE" },
      { id: "explore", label: "Finding your way" }
    ],
    body: (
      <>
        <H id="wallet">Connect your wallet</H>
        <Ul>
          <Li>Click <span className="font-semibold text-white/85">Connect</span> at the top right of any page and pick your Asentum wallet. The Telegram mini app wallet works too.</Li>
          <Li>After connecting, your balance shows in the header and you can buy, sell, add liquidity, and place orders everywhere.</Li>
          <Li>Your keys stay in your wallet. Every action asks you to sign it, so nothing moves without your approval.</Li>
        </Ul>
        <H id="ase">Get ASE</H>
        <P>ASE is the coin of the Asentum network. You use it for gas and for buying tokens, since most pairs trade against ASE. On testnet you can grab free ASE from the faucet or the Playground, both linked in the footer.</P>
        <H id="explore">Finding your way</H>
        <Ul>
          <Li><span className="font-semibold text-white/85">AsePad</span> lists every live launch. <span className="font-semibold text-white/85">Create token</span> is where new tokens start. <span className="font-semibold text-white/85">AseDex</span> is the exchange.</Li>
          <Li>Addresses and tokens show a copy button and an explorer shortcut so you can always double check what you are trading.</Li>
          <Li>Every page link is shareable, so you can send a friend straight to a launch or a trading pair.</Li>
        </Ul>
      </>
    )
  },
  {
        slug: "create-token", ...DOC_META["create-token"], icon: FilePlus2,
    toc: [
      { id: "modes", label: "The three modes" },
      { id: "fields", label: "What to fill in" },
      { id: "tax", label: "Tax tokens" },
      { id: "verified", label: "The Verified badge" }
    ],
    body: (
      <>
        <H id="modes">The three modes</H>
        <Tbl
          head={["", "AsePad Launch", "Standard Token", "Tax Token"]}
          rows={[
            ["What you get", "A token with its own live market from second one", "A plain token sent to your wallet", "A plain token sent to your wallet with a trade fee"],
            ["Price", "Set by the bonding curve as people buy", "None until you add it to a pool yourself", "None until you add it to a pool yourself"],
            ["Liquidity", "Handled for you and burned forever at graduation", "You add and manage it yourself", "You add and manage it yourself"],
            ["Supply", "Fixed at launch", "You choose supply and decimals", "You choose supply and decimals"],
            ["Deploy cost", <DeployCost key="pad" kind="pad" />, <DeployCost key="std" kind="standard" />, <DeployCost key="tax" kind="tax" />],
            ["Best for", "Fair community launches", "Projects that already have their own plan", "Projects that fund marketing from trades"]
          ]}
        />
        <P>The three options are checkboxes and only one can be on at a time. Picking one hides the fields you do not need, so the form always stays short. Standard and Tax Token both take one click that sends two transactions, the first prepares your token and the second activates it with the factory.</P>
        <H id="tax">Tax tokens</H>
        <Ul>
          <Li><span className="font-semibold text-white/85">You set the rates</span> anywhere from 0 to 4 percent on buys and 0 to 4 percent on sells. The rates are locked into the contract at deploy and can never be changed after.</Li>
          <Li><span className="font-semibold text-white/85">The marketing wallet</span> collects the tax. Leave the box empty and your own wallet receives it, or paste any wallet address and that one collects it from the start.</Li>
          <Li><span className="font-semibold text-white/85">How the tax lands.</span> On a buy it comes out of the tokens you receive, so a 100 token quote pays you 96 at 4 percent. On a sell the amount you type is your total spend: sell 100 and the pool trades 96 while 4 goes to the tax wallet.</Li>
          <Li><span className="font-semibold text-white/85">Tax only applies to dex trades.</span> Wallet to wallet sends are always free, and the contract itself knows both AseDex and the legacy venue so the fee cannot be dodged.</Li>
          <Li><span className="font-semibold text-white/85">No honeypot tricks.</span> The 4 percent cap and the wallet are fixed at deploy, nobody can raise the tax later, and the terminal shows the exact buy and sell rates next to the pair name.</Li>
        </Ul>
        <H id="fields">What to fill in</H>
        <Ul>
          <Li><span className="font-semibold text-white/85">Name and ticker</span> shown everywhere the token appears. Pick a short clean ticker.</Li>
          <Li><span className="font-semibold text-white/85">Logo</span> is a link to an image. Use a stable link so it never breaks on the site.</Li>
          <Li><span className="font-semibold text-white/85">Socials</span> like website, X, and Telegram show up on your launch page and help buyers trust the project.</Li>
          <Li><span className="font-semibold text-white/85">Creator reserve</span> on a launch lets you keep a small slice at the starting price before the crowd buys in.</Li>
        </Ul>
        <H id="verified">The Verified badge</H>
        <P>Tokens made here use the standard AsePad contract, and the site byte-matches the deployed source against the template before showing the Verified badge. If a token is verified, you know it behaves exactly like every other launch, with no surprise rules hidden inside.</P>
        <P>A token whose source does not match any official template gets an amber <span className="font-semibold text-amber-300">Custom contract</span> badge instead, and its token page locks buys and sells entirely. Tokens deployed under older template versions still verify, since every retired template is kept on file.</P>
        <Callout tone="amber" title="Before you sign">
          A token cannot be edited after launch. Double check the name, ticker, and logo link before you confirm.
        </Callout>
      </>
    )
  },
  {
        slug: "launch-page", ...DOC_META["launch-page"], icon: Rocket,
    toc: [
      { id: "trade", label: "Buying and selling" },
      { id: "chart", label: "Chart and numbers" },
      { id: "holders", label: "Holders and activity" }
    ],
    body: (
      <>
        <H id="trade">Buying and selling</H>
        <Ul>
          <Li><span className="font-semibold text-white/85">Buy</span> by typing how much ASE you want to spend. You see the tokens you will get before you sign, and they land in your wallet the moment it confirms.</Li>
          <Li><span className="font-semibold text-white/85">Sell</span> works the same in reverse. Type tokens in, get ASE back right away. There is no waiting and no one can block your sell.</Li>
          <Li>The percentage buttons fill a share of your balance for you, handy for quick entries.</Li>
        </Ul>
        <H id="chart">Chart and numbers</H>
        <P>The chart draws the token's trade history as candles. Switch between <Code>1m 5m 15m 1h 1d</Code> and flip the price between ASE and USD. Above it you get the live price, how far the curve has filled, market cap, and holder count.</P>
        <P>A launch holding a trending slot wears a <HotTagIcon rank={1} /> tag (ranks 1 to 10) on its card and on this page, so the movers are easy to spot.</P>
        <H id="holders">Holders and activity</H>
        <P>The holders list shows who owns the token and how much, straight from the chain. The activity feed lists every buy and sell as it happens so you can watch momentum build in real time.</P>
        <Callout title="After graduation">
          Once the curve fills, the token moves to AseDex and this same page follows it. Nothing is lost, trading just moves to the exchange.
        </Callout>
      </>
    )
  },
  {
        slug: "bonding-curve", ...DOC_META["bonding-curve"], icon: TrendingUp,
    toc: [
      { id: "how", label: "How the price moves" },
      { id: "money", label: "Where the money sits" },
      { id: "creator", label: "Creator reserve" }
    ],
    body: (
      <>
        <H id="how">How the price moves</H>
        <P>Every buy puts ASE into the launch and moves the price a step up the curve. Every sell takes ASE back out and steps it down. The math is fixed and public, so everyone pays the same fair curve and nobody can change the rules mid way.</P>
        <H id="money">Where the money sits</H>
        <P>The ASE that buyers put in stays held inside the contract as the launch's reserve. It does not go to the creator and it does not go to us. When the curve finishes, that reserve becomes the liquidity for the exchange pool.</P>
        <H id="creator">Creator reserve</H>
        <P>A launch creator can keep a small slice at the starting price. This exists so the person who launched the token gets a fair entry instead of a bot buying the whole first minute before anyone else sees it.</P>
        <Callout tone="amber" title="Why this design">
          Since the reserve lives in the contract and ends up as burned liquidity in the pool, there is no liquidity wallet anyone can run off with. The safety comes from the code itself.
        </Callout>
      </>
    )
  },
  {
        slug: "migration", ...DOC_META["migration"], icon: Flame,
    toc: [
      { id: "flow", label: "What graduation looks like" },
      { id: "burn", label: "Burned liquidity" },
      { id: "protect", label: "Why pools stay on AseDex" }
    ],
    body: (
      <>
        <H id="flow">What graduation looks like</H>
        <Ul>
          <Li>The progress bar on the launch shows how full the curve is. The buy that completes it triggers the move in the same transaction.</Li>
          <Li>A new pool opens on AseDex at the final curve price, seeded with everything the launch raised.</Li>
          <Li>From that moment the token trades on the exchange like any other pair. The launch page still works and now links to the pool.</Li>
        </Ul>
        <H id="burn">Burned liquidity</H>
        <P>The pool's ownership shares are sent to the dead address, which means the liquidity can never be withdrawn. Look for the <BurnTagIcon label /> badge on pools to see how much is burned. 100% burned means that liquidity is there to stay.</P>
        <H id="protect">Why pools stay on AseDex</H>
        <P>A launch token can only ever join its own official AseDex pool. Before graduation it cannot be added to any other pool, so nobody can fake an early market or split the liquidity to confuse buyers.</P>
      </>
    )
  },
  {
        slug: "terminal", ...DOC_META["terminal"], icon: LayoutDashboard,
    toc: [
      { id: "layout", label: "What is on screen" },
      { id: "chart", label: "Chart" },
      { id: "stats", label: "The numbers row" },
      { id: "tabs", label: "Trades, Depth, Orders, Holders" }
    ],
    body: (
      <>
        <H id="layout">What is on screen</H>
        <P>The pair name and live price sit at the top with its venue tag. Migrated launch tokens also carry <PadTagIcon label /> linking back to their launch page, and <BurnTagIcon label /> linking to the liquidity burn transaction on the explorer. The chart takes the center and the trade panel sits on the right. The little <Code>»</Code> tab on the left edge of your screen opens the Markets drawer so you can jump between pairs without leaving the page.</P>
        <H id="chart">Chart</H>
        <P>Candles for the pair in <Code>15m 1h 4h 1d 1w</Code>, with a USD or ASE price switch. Buy and sell arrows mark where real trades landed, and your open limit orders show up as price lines on the chart.</P>
        <H id="stats">The numbers row</H>
        <P>Price, 24 hour change and volume, total fees earned, market cap, liquidity, and your pool share. A zero means the number is really zero, while a dash only shows when there is no price to report yet.</P>
        <H id="tabs">Trades, Depth, Orders, Holders</H>
        <Tbl
          head={["Tab", "What you see"]}
          rows={[
            ["Trades", "Every swap on this pair, with side, price, size, and who made it"],
            ["Depth", "The open limit orders sitting above and below the current price"],
            ["My orders", "Your open orders on this pair, with a cancel button on each"],
            ["Holders", "Everyone holding the token, with balances and share of supply. Your wallet, the pad, and the pools get name tags so the list stays readable"]
          ]}
        />
      </>
    )
  },
  {
        slug: "orders", ...DOC_META["orders"], icon: ArrowDownUp,
    toc: [
      { id: "swap", label: "Swap" },
      { id: "limit", label: "Limit orders" },
      { id: "dca", label: "DCA" },
      { id: "rules", label: "Order rules" }
    ],
    body: (
      <>
        <H id="swap">Swap</H>
        <P>The instant option. Pick how much to trade, choose a slippage preset, and confirm. Slippage is simply how much price movement you are willing to accept before the trade goes through. If the price slips past it, the trade cancels itself and your funds never move.</P>
        <H id="limit">Limit orders</H>
        <P>Set the price you want and the contract holds your funds until the pool reaches it. When the price touches your target the order fills at exactly that rate. Until then you can cancel anytime and get your funds back instantly.</P>
        <H id="dca">DCA</H>
        <P>Dollar cost averaging for the impatient. You lock in a total amount, split it into slices, and the contract buys or sells one slice at each interval. Great for building a position without guessing the perfect moment. DCA is available on AseDex pairs only.</P>
        <H id="rules">Order rules</H>
        <Ul>
          <Li>Each pair keeps its own order book with room for up to 256 open orders.</Li>
          <Li>Each wallet can have up to 32 open orders at once.</Li>
          <Li>The smallest order needs to be worth at least 0.25 ASE.</Li>
          <Li>Orders fill automatically as the pool price crosses them. Every swap on the pool helps clear the book.</Li>
        </Ul>
      </>
    )
  },
  {
        slug: "markets", ...DOC_META["markets"], icon: LineChart,
    toc: [
      { id: "radar", label: "Radar" },
      { id: "drawer", label: "Markets drawer" },
      { id: "pools", label: "Pools" },
      { id: "tags", label: "The little tags" }
    ],
    body: (
      <>
        <H id="radar">Radar</H>
        <P>A quick feed of pairs across both exchanges, fresh launches and busy movers first. The <Code>All · ASEDEX · AURAS</Code> switch filters the feed to one venue. Tap a row to open its terminal, or quick buy straight from the row: pick <Code>0.5 · 1 · 2.5 · 5</Code> ASE at the top and hit <Code>buy</Code> to swap instantly with your slippage setting. The button flashes <Code>bought $TKN</Code> when it confirms. Token/token pairs show a disabled buy since there is no ASE side to spend.</P>
        <H id="drawer">Markets drawer</H>
        <P>From the terminal, the <Code>»</Code> tab on the left edge of the screen slides out the full pair list. Every pool is listed, busiest pairs on top, and the hottest movers wear a flame <HotTagIcon rank={1} /> tag (ranks 1 to 3) that any pair can pick up or drop as trading moves. Each row shows the logo, price, liquidity, and market cap. Pick a pair and the drawer tucks itself away.</P>
        <H id="pools">Pools</H>
        <P>The pools page lists every trading pair with its fee tier, liquidity, total volume, total fees, and APR. <span className="font-semibold text-white/85">My pools</span> shows the pools you have a share in, and <span className="font-semibold text-white/85">Create pool</span> lets you pair any token with ASE on whichever venue you pick.</P>
        <H id="tags">The little tags</H>
        <Ul>
          <Li><AseDexTagIcon /> a pool on the main exchange.</Li>
          <Li><AurasTagIcon /> a pool on the Asentum team's AURAS exchange, fully tradeable here.</Li>
          <Li><PadTagIcon /> an AsePad launch token that migrated to the exchange. Click it to open the token's AsePad page.</Li>
          <Li><BurnTagIcon /> how much of the pool's liquidity shares are burned forever, shown as a real percentage. Grey means none burned. Click it to open the burn transaction on the explorer.</Li>
          <Li><LowLpTagIcon /> the pool holds less than 100 ASE on its quote side, so market cap and FDV are hidden because a pool that thin cannot price them honestly.</Li>
          <Li><Tag>No LP</Tag> the pool exists but has no liquidity yet, so swaps wait for a deposit.</Li>
        </Ul>
        <P>In market rows the rocket and flame are icon-only. Inside the terminal header they grow their labels: <PadTagIcon label /> and <BurnTagIcon label />.</P>
      </>
    )
  },
  {
        slug: "wallet", ...DOC_META["wallet"], icon: WalletIcon,
    toc: [
      { id: "holdings", label: "Holdings" },
      { id: "pnl", label: "Average paid and PnL" },
      { id: "history", label: "Trade history" }
    ],
    body: (
      <>
        <H id="holdings">Holdings</H>
        <P>Every token in your wallet gets a live price from its pool, so you see what each position is worth right now. Pool shares show under My pools with your slice of the liquidity and any rewards waiting for you.</P>
        <H id="pnl">Average paid and PnL</H>
        <P>For each token we work out your average entry from your actual buys, including curve buys before graduation and exchange trades after it. The PnL line compares that average to today's price so you can see at a glance if you are up or down.</P>
        <H id="history">Trade history</H>
        <P>Your fills from both exchanges in one list. Each row links to the transaction on the explorer so you can verify everything yourself.</P>
        <Callout title="Older AURAS trades">
          AURAS only started tracking trade history when its stats service came online, so very old trades may not show. Your balances and positions are always correct since they read straight from the chain.
        </Callout>
      </>
    )
  },
  {
        slug: "token-lock", ...DOC_META["token-lock"], icon: LockKeyhole,
    toc: [
      { id: "what", label: "What AseLock is" },
      { id: "kinds", label: "The four lock types" },
      { id: "lp", label: "LP lock" },
      { id: "token", label: "Token lock" },
      { id: "vesting", label: "Vesting" },
      { id: "unlockburn", label: "Unlock vs burn" },
      { id: "manage", label: "Managing a lock" },
      { id: "verify", label: "Verifying on chain" }
    ],
    body: (
      <>
        <H id="what">What AseLock is</H>
        <P>AseLock is the platform's locker contract, and the Token Lock page is its frontend. Locked assets live inside the contract's own storage, not in a wallet or on a server, so nobody can touch them early, not the site, not the locker owner, and not us. The contract decides when things move.</P>
        <P>Every lock gets a number and its own public page at <Code>/lock/&lt;number&gt;</Code>, with the token, amount, dates and current state laid out. A lock can only ever be in one of three states: <Tag tone="accent">LOCKED</Tag>, <Tag>RELEASED</Tag> or <Tag>BURNED</Tag>.</P>
        <H id="kinds">The four lock types</H>
        <Tbl
          head={["Type", "What it escrows", "Who gets paid", "How it ends"]}
          rows={[
            ["LP lock", "Your AseDex pool shares", "Back to you after the date", "Unlock or burn"],
            ["Token lock", "Any ARC-20 token", "Back to you after the date", "Unlock or burn"],
            ["Vesting", "Any ARC-20 token", "The owner, released linearly", "Claimed out fully"],
            ["Multi vesting", "Any ARC-20 token", "Up to 64 named beneficiaries", "Each claimed out fully"]
          ]}
        />
        <H id="lp">LP lock</H>
        <Ul>
          <Li>Pick a pool you provide liquidity to, the amount of shares, and an unlock date. The shares move from your wallet into the lock contract, while the liquidity itself stays in the pool.</Li>
          <Li>Two signatures: the first approves the lock contract to move your pool shares, the second creates the lock.</Li>
          <Li>The unlock date must be in the future, and the contract enforces it. Even you cannot withdraw before it passes.</Li>
          <Li>After the date, tap Unlock on the lock page and the same shares come back to your wallet.</Li>
        </Ul>
        <H id="token">Token lock</H>
        <Ul>
          <Li>Escrow any ARC-20 token until a date you choose. Team allocations, treasury reserves, airdrop supplies, whatever needs a visible commitment.</Li>
          <Li>Same flow as LP: approve the token spend first, then create the lock.</Li>
          <Li>The contract measures what actually arrived, not what you typed. A token that taxes the transfer and under-delivers fails the lock instead of quietly locking less.</Li>
        </Ul>
        <H id="vesting">Vesting</H>
        <P>Vesting is a token lock that pays out gradually instead of all at once. The amount releases on a straight line between a start and end date: nothing before the start, everything by the end, and a proportional slice in between.</P>
        <Ul>
          <Li><span className="font-semibold text-white/85">Single beneficiary.</span> Lock an amount for yourself or a wallet you control, then claim whatever has vested at any time.</Li>
          <Li><span className="font-semibold text-white/85">Multi beneficiary.</span> One lock covers a whole team: one <Code>address,amount</Code> per line, up to 64 people, each with their own allocation on the same schedule.</Li>
          <Li><span className="font-semibold text-white/85">Claim whenever.</span> Claims can happen as often as you like, even daily. Each claim pays the vested amount minus what was already paid, so nothing is lost by claiming early and often.</Li>
          <Li><span className="font-semibold text-white/85">Tax tokens stay fair.</span> If a token's transfer fee eats part of a claim, the contract records only what actually arrived. The missing remainder stays claimable, so the schedule still pays the full allocation in the end.</Li>
          <Li><span className="font-semibold text-white/85">Beneficiary handoff.</span> On a multi vesting lock, each beneficiary can move their own slot, every unpaid and future payout, to a different wallet without affecting anyone else.</Li>
        </Ul>
        <H id="unlockburn">Unlock vs burn</H>
        <P>Once an LP or token lock exists it has exactly two exits, both permanent and both owner only:</P>
        <Ul>
          <Li><span className="font-semibold text-white/85">Unlock</span> returns the assets to the owner. Only possible after the unlock date passes.</Li>
          <Li><span className="font-semibold text-white/85">Burn</span> sends the locked shares or tokens to the zero address at any time, even before the date. A burned lock stays on the list marked <Tag>BURNED</Tag> as a public proof that those assets can never move again.</Li>
        </Ul>
        <P>Burning an LP lock is how you prove liquidity is gone for good. It is different from the automatic migration burn on AsePad launches, which happens inside the pad contract at graduation; a manual lock and burn is the way to make the same commitment on any pool, any time.</P>
        <P>Vesting locks have no unlock and no burn. They only move through claims, so a vesting schedule can never be cut short by anyone.</P>
        <H id="manage">Managing a lock</H>
        <Ul>
          <Li><span className="font-semibold text-white/85">Transfer.</span> The whole ownership of an LP or token lock can move to another wallet. The date and amount do not change, the new owner simply steps into your place. This cannot be undone.</Li>
          <Li><span className="font-semibold text-white/85">My locks.</span> The Token Lock page lists every lock your wallet owns plus every vesting slot where you are a beneficiary, and any token or pool page links straight to the locks that touch it.</Li>
        </Ul>
        <H id="verify">Verifying on chain</H>
        <P>Locks are public state. The lock page reads the record straight from the AseLock contract, and the contract address itself is listed on the <DocLink href="/contracts">contracts page</DocLink>. Because burn sends assets to the zero address on chain, a BURNED lock can be checked on the explorer like any other transaction, no trust in this site required.</P>
        <Callout title="The contract decides, not the site">
          Locking moves your assets into the contract's own storage and only its rules can move them again. The site is a window onto that state: if asepad.fun disappeared tomorrow, your locks and their dates would still be exactly where the chain put them.
        </Callout>
      </>
    )
  },
  {
        slug: "asevault", ...DOC_META["asevault"], icon: VaultIcon,
    toc: [
      { id: "what", label: "What AseVault is" },
      { id: "get", label: "Getting the app" },
      { id: "inside", label: "Inside the wallet" },
      { id: "safety", label: "Staying safe" }
    ],
    body: (
      <>
        <H id="what">What AseVault is</H>
        <P>AseVault is the mobile wallet of the Asentum network, a product of asepad.fun. It holds your ASE and ARC-20 tokens, connects to AsePad, AseDex, AURAS and other apps, and signs every transaction with the post-quantum signature scheme Asentum is built on.</P>
        <P>It is fully non-custodial. There is no account, no email, and no server holding anything for you. Your wallet is created on your device and stays on your device.</P>
        <H id="get">Getting the app</H>
        <Ul>
          <Li>Open <Link prefetch={false} href={siteHref("/asevault")} className="font-medium text-accent underline underline-offset-2">the AseVault page</Link> and tap <span className="font-semibold text-white/85">Download for Android</span>.</Li>
          <Li>Install the APK. If Android asks, allow installs from your browser.</Li>
          <Li>Launch the app and create a new wallet or import an existing one with a recovery phrase. Setup takes about a minute.</Li>
          <Li>Protect it with biometric unlock or a passcode, and the vault locks itself when you are away.</Li>
        </Ul>
        <H id="inside">Inside the wallet</H>
        <Ul>
          <Li><span className="font-semibold text-white/85">Home</span> shows every balance with live prices, plus quick send, receive, and buy actions.</Li>
          <Li><span className="font-semibold text-white/85">Markets</span> lists every AseDex and AURAS pool, live leaderboards, and every AsePad launch with its curve progress.</Li>
          <Li><span className="font-semibold text-white/85">Swap</span> trades any pair in a tap with the fee shown before you confirm.</Li>
          <Li><span className="font-semibold text-white/85">The dApp browser</span> connects to AsePad, AseDex, AURAS and more. Every action from a site opens an approval screen first, nothing signs silently.</Li>
          <Li><span className="font-semibold text-white/85">Activity</span> keeps a full feed of sends, receives, swaps, and approvals, each linked to the explorer.</Li>
          <Li><span className="font-semibold text-white/85">Multiple wallets</span> are supported. Create or import as many as you like and switch in a tap.</Li>
        </Ul>
        <H id="safety">Staying safe</H>
        <Ul>
          <Li><span className="font-semibold text-white/85">Your recovery phrase is the only backup.</span> Write it down and keep it offline. If the phone is lost without it, the wallet is gone for good and nobody can recover it.</Li>
          <Li><span className="font-semibold text-white/85">Every action asks first.</span> Sends, swaps, and approvals all show a review screen. If you did not start it, do not approve it.</Li>
          <Li><span className="font-semibold text-white/85">Verify before you trust.</span> Token pages and transactions link out to the explorer so you can always check the real address.</Li>
          <Li><span className="font-semibold text-white/85">Only download from here.</span> The AseVault page on asepad.fun is the official source. Do not install builds shared in chats or channels.</Li>
        </Ul>
        <Callout title="Keys never leave the phone">
          Signing happens on your device. The app talks to the network directly, so no backend ever sees your wallet secrets.
        </Callout>
        <P>For a deeper look at how the wallet is built and reviewed, check the <DocLink href="https://asevault.asepad.fun/audit">APP AUDIT REPORT</DocLink>. It covers AseVault's security model, signing flow, and what was checked.</P>
      </>
    )
  },
  {
        slug: "auras", ...DOC_META["auras"], icon: LineChart,
    toc: [
      { id: "data", label: "Where its numbers come from" },
      { id: "supported", label: "What works" },
      { id: "not", label: "What does not" }
    ],
    body: (
      <>
        <H id="data">Where its numbers come from</H>
        <P>AURAS pools read live from the chain just like AseDex, but the older contract did not keep a trade history. Charts, trade lists, and 24 hour stats for AURAS pairs come from its public stats feed, while your liquidity and quotes always come from the contract itself.</P>
        <H id="supported">What works</H>
        <Ul>
          <Li>Swaps, exactly like on AseDex.</Li>
          <Li>Limit orders, including the open order book in the Depth tab.</Li>
          <Li>Adding and removing liquidity, with positions in My pools.</Li>
          <Li>Creating new AURAS pools through the venue picker on Create pool.</Li>
        </Ul>
        <H id="not">What does not</H>
        <Ul>
          <Li><span className="font-semibold text-white/85">DCA</span> is AseDex only, so the tab hides on AURAS pairs.</Li>
          <Li><span className="font-semibold text-white/85">Old order history.</span> My orders shows your open AURAS orders, but filled and cancelled ones are not listed per wallet.</Li>
          <Li><span className="font-semibold text-white/85">LP rewards</span> are an AseDex feature.</Li>
        </Ul>
      </>
    )
  },
  {
        slug: "fees-safety", ...DOC_META["fees-safety"], icon: ShieldCheck,
    toc: [
      { id: "fees", label: "Fees" },
      { id: "guarantees", label: "What is guaranteed" },
      { id: "dyor", label: "A gentle reminder" }
    ],
    body: (
      <>
        <H id="fees">Fees</H>
        <Ul>
          <Li><span className="font-semibold text-white/85">Swaps</span> take a small fee, usually around 0.3%, which is shared between liquidity providers and the platform.</Li>
          <Li><span className="font-semibold text-white/85">Launches</span> have their own fee split that is visible in the launch numbers, and creator rewards come out of it at graduation.</Li>
          <Li><span className="font-semibold text-white/85">Limit and DCA orders</span> pay the same swap fee when they fill. Placing and cancelling is just gas.</Li>
          <Li><span className="font-semibold text-white/85">Tax tokens</span> take their own buy and sell fee set by the creator, up to 4 percent per side. The rates show beside the pair name in the terminal, and collected tokens go to the token's marketing wallet.</Li>
          <Li><span className="font-semibold text-white/85">Creating a token</span> costs <DeployCost kind="standard" bare /> for Standard, <DeployCost kind="tax" bare /> for Tax, and <DeployCost kind="pad" bare /> for an AsePad Launch, all paid to the platform treasury.</Li>
        </Ul>
        <H id="guarantees">What is guaranteed</H>
        <Ul>
          <Li>Liquidity from graduated launches is burned forever, it can never be pulled.</Li>
          <Li>Launch tokens can only trade on their official pool, so no fake markets exist.</Li>
          <Li>Sells pay out instantly inside the same transaction, funds never sit pending.</Li>
          <Li>Only tokens built through the platform get the Verified badge and a launch.</Li>
        </Ul>
        <H id="dyor">A gentle reminder</H>
        <P>The contracts make sure trades settle fairly, but they cannot promise prices. Tokens can still go down, projects can go quiet, and this is testnet so balances carry no real value. Check the Verified badge, look at the numbers, and only trade what you are happy to lose.</P>
      </>
    )
  },
  {
        slug: "contracts", ...DOC_META["contracts"], icon: ScrollText,
    toc: [
      { id: "list", label: "The contracts" },
      { id: "auras", label: "AURAS and auras.finance" }
    ],
    body: (
      <>
        <H id="list">The contracts</H>
        <P>Five contracts run the whole platform. Every launch, token, pool, lock and trade settles through one of them, and nothing sits on a server you have to trust.</P>
        <Tbl
          head={["Contract", "Address", "What it does"]}
          rows={[
            ["AsePad",
              <a key="p" href={explorerAddressUrl("ase1r57zd8sstugu4km2axf7ar85q0fj793vdlzt6v")} target="_blank" rel="noreferrer" className="break-all font-medium text-accent transition hover:text-white"><Code>ase1r57zd8sstugu4km2axf7ar85q0fj793vdlzt6v</Code></a>,
              "Bonding-curve launches: buys, sells, migration and the LP burn."],
            ["AseDex",
              <a key="d" href={explorerAddressUrl("ase1cwpnkultxqjz9z09xwe7jlztw2uhuf8fklhzsm")} target="_blank" rel="noreferrer" className="break-all font-medium text-accent transition hover:text-white"><Code>ase1cwpnkultxqjz9z09xwe7jlztw2uhuf8fklhzsm</Code></a>,
              "The exchange: pools, swaps, liquidity, limit and DCA orders."],
            ["ARC20 Factory",
              <a key="f" href={explorerAddressUrl("ase1t76r7d2vaymuggt35e8jag8qpmd7p3cxazjtx9")} target="_blank" rel="noreferrer" className="break-all font-medium text-accent transition hover:text-white"><Code>ase1t76r7d2vaymuggt35e8jag8qpmd7p3cxazjtx9</Code></a>,
              "Deploys every Standard, Tax and AsePad launch token from the verified template."],
            ["AseLock v1",
              <a key="l" href={explorerAddressUrl("ase17whr442xyc7t3lnkrhpzyzw8hr6rgfzdfmkeda")} target="_blank" rel="noreferrer" className="break-all font-medium text-accent transition hover:text-white"><Code>ase17whr442xyc7t3lnkrhpzyzw8hr6rgfzdfmkeda</Code></a>,
              "Legacy locker: LP-share, token and vesting locks created before v2 (watch and claim only)."],
            ["AseLock v2",
              <a key="l2" href={explorerAddressUrl("ase1wd3zm7as7s7qx0trfxt2r63hslc4zc3j8xv6mm")} target="_blank" rel="noreferrer" className="break-all font-medium text-accent transition hover:text-white"><Code>ase1wd3zm7as7s7qx0trfxt2r63hslc4zc3j8xv6mm</Code></a>,
              "Current locker: escrows LP shares, tokens, NFTs and vesting schedules, extends, relocks, tops up and migrates v1 locks, and burns locked assets to the zero address."]
          ]}
        />
        <H id="auras">AURAS and auras.finance</H>
        <P>AURAS is the official exchange built by the Asentum team, not an AsePad team contract, which is why it is not listed above. The integration runs both ways: its pools show up in Radar, Markets and Pools with the <Tag tone="purple">AURAS</Tag> tag and trade normally here, and AseDex pools are likewise tradeable on the Asentum team's own <a href="https://auras.finance" target="_blank" rel="noreferrer" className="font-medium text-accent underline-offset-2 transition hover:text-white hover:underline">auras.finance</a>.</P>
      </>
    )
  }
];

export const PAGE_MAP = new Map(PAGES.map((p) => [p.slug, p]));
const ALL_PAGES = NAV.flatMap((g) => g.pages);
const pageIndex = (slug: string) => ALL_PAGES.findIndex((p) => p.slug === slug);

/* ── app ───────────────────────────────────────────────────────────── */

function DocsNav({ active, onNavigate }: { active: string; onNavigate?: () => void }) {
  return (
    <>
      {NAV.map((g) => (
        <div key={g.group} className="mb-5">
          <p className="px-2 pb-1.5 text-[9px] font-bold uppercase tracking-[0.2em] text-white/40">{g.group}</p>
          <ul className="space-y-px">
            {g.pages.map((p) => (
              <li key={p.slug}>
                <Link href={`/${p.slug}`} onClick={onNavigate}
                  className={cn("flex items-center gap-2 rounded-lg border-l-2 px-2.5 py-1.5 text-[13px] transition",
                    p.slug === active
                      ? "border-accent bg-accent/[0.08] font-medium text-white"
                      : "border-transparent text-white/55 hover:bg-white/[0.04] hover:text-white")}>
                  <p.icon className={cn("h-3.5 w-3.5 shrink-0", p.slug === active ? "text-accent" : "text-white/40")} />
                  {p.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="mt-6 border-t border-white/[0.07] pt-4">
        <Link prefetch={false} href={siteHref("/privacypolicy")} onClick={onNavigate}
          className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] text-white/40 transition hover:bg-white/[0.04] hover:text-white">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-white/30" />
          Privacy Policy
        </Link>
      </div>
    </>
  );
}

export function DocsApp({ slug }: { slug: string }) {
  const page = PAGE_MAP.get(slug) ?? PAGE_MAP.get("welcome")!;
  const idx = pageIndex(page.slug);
  const prev = ALL_PAGES[idx - 1];
  const next = ALL_PAGES[idx + 1];
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => {
    setNavOpen(false);
  }, [slug]);
  useEffect(() => {
    if (!navOpen) return;
    const html = document.documentElement;
    const prevOverflow = html.style.overflow;
    html.style.overflow = "hidden";
    return () => { html.style.overflow = prevOverflow; };
  }, [navOpen]);

  return (
    <div className="mx-auto max-w-7xl px-4 pb-8 pt-16 md:pb-10 md:pt-20">
      {/* mobile nav: GitBook-style slide-in drawer */}
      <div className="mb-6 flex items-center justify-between gap-3 lg:hidden">
        <button onClick={() => setNavOpen(true)}
          className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-white/80 transition hover:border-accent/30 hover:text-white">
          <PanelLeftOpen className="h-3.5 w-3.5 text-accent" /> AsePad Docs
        </button>
        <span className="truncate text-[11px] text-white/40">{page.title}</span>
      </div>
      {navOpen ? <button aria-label="Close docs navigation" onClick={() => setNavOpen(false)} className="fixed inset-0 z-50 cursor-default bg-black/60 backdrop-blur-sm lg:hidden" /> : null}
      <div className={cn("fixed inset-y-0 left-0 z-[55] flex w-[85vw] max-w-[300px] flex-col overflow-hidden border-r border-white/10 bg-[#0b0d14] shadow-2xl shadow-black/60 transition-transform duration-300 lg:hidden",
        navOpen ? "translate-x-0" : "-translate-x-full")}>
        <div className="flex items-center gap-2 border-b border-white/[0.07] px-3 py-3">
          <BookOpen className="h-3.5 w-3.5 text-accent" />
          <span className="text-xs font-semibold text-white/80">AsePad Docs</span>
          <button onClick={() => setNavOpen(false)} className="ml-auto text-white/50 transition hover:text-white" title="Close"><X className="h-3.5 w-3.5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <DocsNav active={page.slug} onNavigate={() => setNavOpen(false)} />
        </div>
      </div>

      <div className="grid gap-10 lg:grid-cols-[230px_minmax(0,1fr)] xl:grid-cols-[230px_minmax(0,1fr)_180px]">
        {/* sidebar */}
        <aside className="hidden lg:block">
          <div className="sticky top-28 max-h-[calc(100vh-8rem)] overflow-y-auto pr-3">
            <p className="flex items-center gap-2 px-2 pb-4 text-xs font-semibold text-white/80">
              <BookOpen className="h-3.5 w-3.5 text-accent" /> AsePad Docs
            </p>
            <DocsNav active={page.slug} />
          </div>
        </aside>

        {/* content */}
        <article className="min-w-0 max-w-3xl">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-accent/80">
            {NAV.find((g) => g.pages.some((p) => p.slug === page.slug))?.group}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">{page.title}</h1>
          <p className="mt-3 text-sm leading-relaxed text-white/55 md:text-base">{page.intro}</p>

          {page.body}

          {/* prev / next */}
          <div className="mt-14 grid gap-3 border-t border-white/[0.07] pt-6 sm:grid-cols-2">
            {prev ? (
              <Link href={`/${prev.slug}`} className="group rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 transition hover:border-accent/30">
                <p className="text-[9px] font-bold uppercase tracking-widest text-white/40">← Previous</p>
                <p className="mt-1 text-sm font-medium text-white/80 transition group-hover:text-accent">{prev.title}</p>
              </Link>
            ) : <span />}
            {next ? (
              <Link href={`/${next.slug}`} className="group rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 text-right transition hover:border-accent/30 sm:col-start-2">
                <p className="text-[9px] font-bold uppercase tracking-widest text-white/40">Next →</p>
                <p className="mt-1 text-sm font-medium text-white/80 transition group-hover:text-accent">{next.title}</p>
              </Link>
            ) : null}
          </div>
        </article>

        {/* on this page */}
        <aside className="hidden xl:block">
          <div className="sticky top-28">
            <p className="px-2 text-[9px] font-bold uppercase tracking-[0.2em] text-white/40">On this page</p>
            <ul className="mt-3 space-y-1 border-l border-white/[0.08]">
              {page.toc.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="block px-3 py-1 text-[12px] text-white/50 transition hover:text-accent">
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
