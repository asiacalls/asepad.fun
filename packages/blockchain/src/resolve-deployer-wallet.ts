import { AsentumClient, AsentumWallet } from "@asentum/sdk";
import { addressFromPublicKey, generateKeypair } from "@asentum/crypto";
import { toAseAddress } from "@asentrise/utils";
import { publicKeyFromSecretKey } from "./ml-dsa-public-from-secret.js";

/** ML-DSA-65 (Dilithium3) key sizes used by Asentum. */
export const ML_DSA65_SECRET_BYTES = 4032;
export const ML_DSA65_PUBLIC_BYTES = 1952;
/** FIPS 204 KeyGen seed — newer Asentum wallet "private key" exports are this 32-byte seed. */
export const ML_DSA65_SEED_BYTES = 32;

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

export type DeployerKeyMaterial = {
  secretKeyHex: string;
  publicKeyHex: string;
  address: string;
};

/**
 * Resolve deployer keys from env.
 *
 * Asentum Wallet labels the export "private key" — it is the ML-DSA **secret** (~4032 bytes),
 * not a 32-byte Ethereum key. Some exports concatenate secret + public (~5984 bytes).
 */
export function resolveDeployerKeyMaterial(
  env: Record<string, string | undefined> = process.env
): DeployerKeyMaterial {
  const rawInput =
    env.DEPLOYER_PRIVATE_KEY?.trim() ||
    env.DEPLOYER_SECRET_KEY?.trim() ||
    "";
  const explicitPublic = env.DEPLOYER_PUBLIC_KEY?.trim() || "";

  if (!rawInput && !explicitPublic) {
    throw new Error(
      "Set DEPLOYER_PRIVATE_KEY (from Asentum wallet export) or DEPLOYER_SECRET_KEY + DEPLOYER_PUBLIC_KEY"
    );
  }

  let secretKeyHex = "";
  let publicKeyHex = explicitPublic;

  if (rawInput) {
    const bytes = hexToBytes(rawInput);
    const combinedLen = ML_DSA65_SECRET_BYTES + ML_DSA65_PUBLIC_BYTES;

    if (bytes.length === ML_DSA65_SEED_BYTES) {
      const keypair = generateKeypair(bytes);
      secretKeyHex = bytesToHex(keypair.secretKey);
      publicKeyHex = bytesToHex(keypair.publicKey);
    } else if (bytes.length >= combinedLen) {
      secretKeyHex = bytesToHex(bytes.slice(0, ML_DSA65_SECRET_BYTES));
      publicKeyHex = bytesToHex(bytes.slice(ML_DSA65_SECRET_BYTES, combinedLen));
    } else if (bytes.length === ML_DSA65_SECRET_BYTES) {
      secretKeyHex = bytesToHex(bytes);
      publicKeyHex = bytesToHex(publicKeyFromSecretKey(bytes));
    } else {
      throw new Error(
        `Unexpected deployer key size: ${bytes.length} bytes. ` +
          `Expected ${ML_DSA65_SEED_BYTES} (seed), ${ML_DSA65_SECRET_BYTES} (secret key) or ${combinedLen} (secret + public combined). ` +
          `If you only have the secret, also set DEPLOYER_PUBLIC_KEY from the wallet (if shown) or re-export.`
      );
    }
  }

  if (!secretKeyHex || !publicKeyHex) {
    throw new Error(
      "Missing deployer public key. Asentum signing needs both ML-DSA secret and public keys. " +
        "Use a combined export in DEPLOYER_PRIVATE_KEY, or add DEPLOYER_PUBLIC_KEY."
    );
  }

  const signerAddress = toAseAddress(addressFromPublicKey(hexToBytes(publicKeyHex)));

  const expectedWallet = env.DEPLOYER_WALLET_ADDRESS?.trim();
  if (expectedWallet && signerAddress !== toAseAddress(expectedWallet)) {
    throw new Error(
      `Deployer key does not match DEPLOYER_WALLET_ADDRESS. ` +
        `Derived signer: ${signerAddress}, expected: ${expectedWallet}. ` +
        `Re-export the private key from the same Asentum account shown in the extension.`
    );
  }

  return { secretKeyHex, publicKeyHex, address: signerAddress };
}

export function createDeployerWallet(
  client: AsentumClient,
  env: Record<string, string | undefined> = process.env
): AsentumWallet {
  const { secretKeyHex, publicKeyHex } = resolveDeployerKeyMaterial(env);
  return AsentumWallet.fromSecretKey(client, secretKeyHex, publicKeyHex);
}

/** Returns deployer keys from env, or null if not configured. */
export function tryResolveDeployerKeyMaterial(
  env: Record<string, string | undefined> = process.env
): DeployerKeyMaterial | null {
  try {
    return resolveDeployerKeyMaterial(env);
  } catch {
    return null;
  }
}
