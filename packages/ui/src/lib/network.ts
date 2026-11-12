import { getAsentumNetworkFromEnv } from "@asentrise/config";

const emptyToUndef = (v: string | undefined) => (v && v.trim() ? v : undefined);

export const network = getAsentumNetworkFromEnv({
  ASENTUM_NETWORK_KEY: process.env.NEXT_PUBLIC_ASENTUM_NETWORK_KEY,
  ASENTUM_NETWORK_NAME: process.env.NEXT_PUBLIC_ASENTUM_NETWORK_NAME,
  ASENTUM_RPC_HTTP: process.env.NEXT_PUBLIC_ASENTUM_RPC_HTTP,
  ASENTUM_RPC_WS: emptyToUndef(process.env.NEXT_PUBLIC_ASENTUM_RPC_WS),
  ASENTUM_EXPLORER_BASE_URL: process.env.NEXT_PUBLIC_ASENTUM_EXPLORER_BASE_URL,
  ASENTUM_CHAIN_ID: process.env.NEXT_PUBLIC_ASENTUM_CHAIN_ID
});

