"use client";

import { useEffect, type ReactNode } from "react";
import { AsentumProvider, useAsentum, useWallet } from "@asentum/connect";
import { AseConnectModal } from "@/components/wallet/connect-modal";
import { toAseAddress } from "@asentrise/utils";
import { useWalletStore } from "@/stores/wallet";
import { connectedWalletMethod, setActiveAsentumClient, walletProviderId } from "@/lib/asentum-wallet";
import { seedWalletSession, syncWalletSession } from "@/lib/session-bridge";

// The SDK probes `${rpc}/metadata` + `/v3/heads` and falls back to its own
// default node when the base fails. Explorer's RPC is CORS-open and serves
// both endpoints — usable directly, so the SDK doesn't depend on the
// same-origin /rpc function being alive (free Workers quota is finite).
const RPC = (process.env.NEXT_PUBLIC_ASENTUM_RPC_HTTP || "https://explorer.asentum.com/rpc").replace(/\/$/, "");
const TELEGRAM_BOT = process.env.NEXT_PUBLIC_ASENTUM_TELEGRAM_BOT ?? "AsentumBot";

// Runs at module eval — before AsentumProvider reads its persisted session.
seedWalletSession();

/** Mirrors @asentum/connect state into the zustand store used across the app. */
function WalletStoreBridge() {
  const client = useAsentum();
  const { address, connected, connecting, error, disconnect, openConnect } = useWallet();

  useEffect(() => {
    setActiveAsentumClient(client);
    return () => setActiveAsentumClient(null);
  }, [client]);

  useEffect(() => {
    syncWalletSession(connected);
    useWalletStore.setState({
      status: connected ? "connected" : connecting ? "connecting" : "disconnected",
      // ase1 is the platform's canonical address form (wallets may still emit hex).
      address: address ? toAseAddress(address) : null,
      providerId: connected ? walletProviderId(connectedWalletMethod()) : null,
      error,
      openConnect,
      disconnect: async () => {
        await disconnect();
      }
    });
  }, [address, connected, connecting, error, disconnect, openConnect]);

  return null;
}

export function AsentumWalletProvider({ children }: { children: ReactNode }) {
  return (
    <AsentumProvider
      rpc={RPC}
      dappName="AsePad"
      telegramBot={TELEGRAM_BOT}
    >
      <WalletStoreBridge />
      <AseConnectModal />
      {children}
    </AsentumProvider>
  );
}
