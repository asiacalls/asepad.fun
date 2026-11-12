/** Human token amount (e.g. "1000000000") → smallest units using decimals. */
export function humanSupplyToBaseUnits(totalSupply: string, decimals: number): string {
  const whole = BigInt(totalSupply.replace(/\D/g, "") || "0");
  if (whole === 0n) return "0";
  return (whole * 10n ** BigInt(decimals)).toString();
}

/** Percent of total supply in base units (integer percent 0–100). */
export function percentOfBaseUnits(totalBaseUnits: string, percent: number): string {
  const total = BigInt(totalBaseUnits.replace(/\D/g, "") || "0");
  const p = Math.min(100, Math.max(0, Math.round(percent)));
  if (total === 0n || p === 0) return "0";
  return ((total * BigInt(p)) / 100n).toString();
}
