// Patched noble ML-DSA-65 lives in @asentrise/contracts scripts (runtime path from dist/ is valid).
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error — .mjs has a sibling .d.ts; cross-package resolution is not picked up by tsc
import { publicKeyFromSecretKeyMlDsa65 } from "../../contracts/scripts/lib/noble-ml-dsa65-patch.mjs";

/** ML-DSA-65 public key (1952 bytes) from wallet "private key" export (4032-byte expanded secret). */
export function publicKeyFromSecretKey(secretKey: Uint8Array): Uint8Array {
  if (secretKey.length !== 4032) {
    throw new Error(
      `Expected 4032-byte ML-DSA-65 secret key, got ${secretKey.length} bytes`
    );
  }
  return publicKeyFromSecretKeyMlDsa65(secretKey);
}
