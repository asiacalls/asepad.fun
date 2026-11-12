import { z } from "zod";

export const asentumNetworkSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  rpcHttp: z.string().url(),
  rpcWs: z.string().url().optional(),
  explorerBaseUrl: z.string().url().optional(),
  chainId: z.string().min(1).optional()
});

export type AsentumNetworkConfig = z.infer<typeof asentumNetworkSchema>;

export function getAsentumNetworkFromEnv(env: {
  ASENTUM_NETWORK_KEY?: string;
  ASENTUM_NETWORK_NAME?: string;
  ASENTUM_RPC_HTTP?: string;
  ASENTUM_RPC_WS?: string;
  ASENTUM_EXPLORER_BASE_URL?: string;
  ASENTUM_CHAIN_ID?: string;
}): AsentumNetworkConfig {
  return asentumNetworkSchema.parse({
    key: env.ASENTUM_NETWORK_KEY ?? "asentum-testnet",
    name: env.ASENTUM_NETWORK_NAME ?? "Asentum Testnet",
    rpcHttp: env.ASENTUM_RPC_HTTP,
    rpcWs: env.ASENTUM_RPC_WS,
    explorerBaseUrl: env.ASENTUM_EXPLORER_BASE_URL,
    chainId: env.ASENTUM_CHAIN_ID
  });
}
