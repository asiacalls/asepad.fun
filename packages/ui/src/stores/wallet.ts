import { create } from "zustand";

/**
 * Mirror of the connected wallet state so non-React code and existing
 * selectors keep working. Defaults to disconnected — populated by whichever
 * wallet provider bridge is mounted; do not set these fields anywhere else.
 */
type WalletState = {
  status: "disconnected" | "connecting" | "connected";
  address: string | null;
  providerId: string | null;
  error: string | null;
  /** Opens the wallet chooser (Asentum extension/Telegram or AseVault mobile). */
  openConnect: () => void;
  disconnect: () => Promise<void>;
};

export const useWalletStore = create<WalletState>(() => ({
  status: "disconnected",
  address: null,
  providerId: null,
  error: null,
  openConnect: () => {},
  disconnect: async () => {}
}));
