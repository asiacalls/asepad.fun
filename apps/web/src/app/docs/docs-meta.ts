// Doc page titles + intros shared by the server page (metadata) and the
// client docs app. Kept in a server-safe module: docs-app.tsx is a client
// component and cannot be read during prerender.
export const DOC_META: Record<string, { title: string; intro: string }> = {
  "welcome": {
    title: "Welcome to AsePad",
    intro: "AsePad is the first post-quantum launchpad and the very first ecosystem on the Asentum blockchain. Launch a coin in a couple of clicks, watch it grow on the curve, and trade it on the exchange. Everything runs on smart contracts, so what you see is what the chain holds."
  },
  "getting-started": {
    title: "Getting started",
    intro: "All you need is a wallet and a little ASE. Connect once and every page unlocks, no accounts and no sign up forms."
  },
  "create-token": {
    title: "Create a token",
    intro: "One page, three ways to launch. Pick AsePad Launch for the full curve experience, Standard Token for a plain token in your own wallet, or Tax Token when your project needs a small buy and sell fee that funds marketing."
  },
  "launch-page": {
    title: "Launch page",
    intro: "Every launch gets its own page with a live price, a progress bar toward graduation, a buy and sell box, a chart, holders, and the full activity feed."
  },
  "bonding-curve": {
    title: "Bonding curve",
    intro: "The bonding curve is the automatic market behind every launch. Price rises as people buy and falls as they sell, no order book needed and no one setting the price by hand."
  },
  "migration": {
    title: "Migration & LP burn",
    intro: "When a launch fills its curve, it graduates. The raised ASE and the remaining tokens move into a fresh AseDex pool automatically, and that liquidity is burned forever."
  },
  "terminal": {
    title: "Terminal",
    intro: "The terminal is the trading page for a pair on AseDex. Live chart, trade box, order book, history, and holders, all in one place."
  },
  "orders": {
    title: "Swap, Limit & DCA",
    intro: "Three ways to trade a pair. Swap for instant trades, Limit for a target price, and DCA to spread a big trade over time."
  },
  "markets": {
    title: "Radar, Markets & Pools",
    intro: "Three ways to discover pairs. Radar is the fast feed, Markets is the full searchable list, and Pools is where you watch liquidity and earnings."
  },
  "wallet": {
    title: "Wallet & PnL",
    intro: "Your wallet page collects everything you hold across the platform: tokens, pool shares, your average buy price, profit and loss, and your trade history."
  },
  "token-lock": {
    title: "Token lock & vesting",
    intro: "AseLock escrows LP shares and tokens inside the contract itself. Lock pool liquidity to a date, vault team tokens, or set a linear vesting schedule that beneficiaries claim against whenever they want. Every lock is public and gets its own page."
  },
  "asevault": {
    title: "AseVault wallet",
    intro: "AseVault is the official mobile wallet for Asentum, a product of asepad.fun. Your keys live on your phone, every transaction signs post-quantum, and the whole platform fits in your pocket."
  },
  "auras": {
    title: "AURAS pools",
    intro: "AURAS is the official exchange built by the Asentum team, and its pools still hold liquidity and trade here. You get one terminal for everything, AURAS and AseDex pools side by side."
  },
  "fees-safety": {
    title: "Fees & safety",
    intro: "What trades cost, what the platform guarantees, and a few sensible reminders."
  },
  "contracts": {
    title: "Platform contracts",
    intro: "The on-chain contracts that run AsePad and AseDex. Copy the ase1 address or open any of them on the explorer to check the code yourself."
  }
};
