import { AsentumClient } from "@asentum/sdk";
import type { AsentumNetworkConfig } from "@asentrise/config";

export function createAsentumClient(network: AsentumNetworkConfig): AsentumClient {
  return new AsentumClient(network.rpcHttp);
}

