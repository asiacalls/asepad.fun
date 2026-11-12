import { addressFromPublicKey } from "@asentum/crypto";
import { toHexAddress } from "@asentrise/utils";
import { publicKeyFromSecretKey } from "./ml-dsa-public-from-secret.js";
import { ml_dsa65 } from "./lib/noble-ml-dsa65-patch.mjs";

export const ML_DSA65_SECRET_BYTES = 4032;
export const ML_DSA65_PUBLIC_BYTES = 1952;

function hexToBytes(hex: string): Uint8Array {
  let h = hex.trim();
  if (h.startsWith("0x") || h.startsWith("0X")) h = h.slice(2);
  if (h.length % 2 !== 0) h = `0${h}`;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "0x";
  for (let i = 0; i < bytes.length; i++) {
    hex += (bytes[i] ?? 0).toString(16).padStart(2, "0");
  }
  return hex;
}

export function resolveDeployerKeyMaterial(
  env: Record<string, string | undefined> = process.env
) {
  const rawInput =
    env.DEPLOYER_PRIVATE_KEY?.trim() || env.DEPLOYER_SECRET_KEY?.trim() || "";
  const explicitPublic = env.DEPLOYER_PUBLIC_KEY?.trim() || "";

  if (!rawInput && !explicitPublic) {
    throw new Error(
      "Set DEPLOYER_PRIVATE_KEY (Asentum wallet export) or DEPLOYER_SECRET_KEY + DEPLOYER_PUBLIC_KEY"
    );
  }

  let secretKeyHex = "";
  let publicKeyHex = explicitPublic;

  if (rawInput) {
    const bytes = hexToBytes(rawInput);
    const combinedLen = ML_DSA65_SECRET_BYTES + ML_DSA65_PUBLIC_BYTES;

    if (bytes.length >= combinedLen) {
      secretKeyHex = bytesToHex(bytes.slice(0, ML_DSA65_SECRET_BYTES));
      publicKeyHex = bytesToHex(bytes.slice(ML_DSA65_SECRET_BYTES, combinedLen));
    } else if (bytes.length === 32) {
      // 32-byte ML-DSA seed (ξ) — expand to the full FIPS 204 keypair.
      const kp = ml_dsa65.keygen(bytes);
      secretKeyHex = bytesToHex(kp.secretKey);
      publicKeyHex = bytesToHex(kp.publicKey);
    } else if (bytes.length === ML_DSA65_SECRET_BYTES) {
      // Asentum wallet export is the expanded ML-DSA secret only (4032 bytes). Public key is derived per FIPS 204.
      secretKeyHex = bytesToHex(bytes);
      publicKeyHex = bytesToHex(publicKeyFromSecretKey(bytes));
    } else {
      throw new Error(
        `Unexpected key size: ${bytes.length} bytes (expected ${ML_DSA65_SECRET_BYTES} secret or >= ${combinedLen} combined)`
      );
    }
  }

  if (!secretKeyHex || !publicKeyHex) {
    throw new Error(
      "Need both ML-DSA secret and public key. Use combined export in DEPLOYER_PRIVATE_KEY or set DEPLOYER_PUBLIC_KEY."
    );
  }

  const signerAddress = addressFromPublicKey(hexToBytes(publicKeyHex));

  const expectedWallet = env.DEPLOYER_WALLET_ADDRESS?.trim();
  // DEPLOYER_WALLET_ADDRESS may be ase1 (native) or legacy hex — compare canonical bytes.
  if (
    expectedWallet &&
    signerAddress.toLowerCase() !== toHexAddress(expectedWallet).toLowerCase()
  ) {
    throw new Error(
      `Deployer key does not match DEPLOYER_WALLET_ADDRESS. ` +
        `Derived signer: ${signerAddress}, expected: ${expectedWallet}. ` +
        `Re-export the private key from the same Asentum account shown in the extension.`
    );
  }

  return { secretKeyHex, publicKeyHex, address: signerAddress };
}
