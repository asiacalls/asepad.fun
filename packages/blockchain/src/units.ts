import { parseAse } from "@asentum/sdk";

/** Human ASE amount (e.g. "1" or "0.5") → wei decimal string, as wallets expect for msg.value. */
export function aseToWei(amount?: string): string {
  if (!amount || amount === "0") return "0";
  return parseAse(amount).toString();
}
