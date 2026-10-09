import { ConvexError } from "convex/values";
import { env } from "../_generated/server";

// a8 encrypts connection secrets (tokens, client secrets) with AES-GCM under
// CONNECTION_ENCRYPTION_KEY before storing them. A stored value is
// "v1.<iv>.<ciphertext>", both base64. The version prefix leaves room to
// rotate the key later.

const VERSION = "v1";
const IV_LENGTH = 12;

/**
 * Imports CONNECTION_ENCRYPTION_KEY. Throws a ConvexError that names the
 * env var if it isn't a base64-encoded 32-byte key. Call it before storing
 * anything, so a misconfigured deployment stores nothing.
 */
export async function getEncryptionKey(): Promise<CryptoKey> {
  const raw = env.CONNECTION_ENCRYPTION_KEY;
  let bytes: Uint8Array<ArrayBuffer> | undefined;
  try {
    bytes = raw ? base64ToBytes(raw) : undefined;
  } catch {
    bytes = undefined;
  }
  if (bytes?.length !== 32) {
    throw new ConvexError({
      code: "MISCONFIGURED",
      message:
        "Connectors need CONNECTION_ENCRYPTION_KEY, a base64-encoded 32-byte key. Ask whoever runs this a8 to set it.",
    });
  }
  return await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptSecret(
  key: CryptoKey,
  plaintext: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return [
    VERSION,
    bytesToBase64(iv),
    bytesToBase64(new Uint8Array(ciphertext)),
  ].join(".");
}

/** encryptSecret for a value that may be absent, like a refresh token. */
export async function encryptOptionalSecret(
  key: CryptoKey,
  plaintext: string | undefined,
): Promise<string | undefined> {
  return plaintext === undefined
    ? undefined
    : await encryptSecret(key, plaintext);
}

export async function decryptSecret(
  key: CryptoKey,
  stored: string,
): Promise<string> {
  const [version, iv, ciphertext] = stored.split(".");
  if (version !== VERSION || !iv || !ciphertext) {
    throw new Error("Unknown encrypted secret format.");
  }
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(iv) },
    key,
    base64ToBytes(ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
