import { ConvexError } from "convex/values";
import { appError, ERROR_CODES, type AppErrorData } from "./errors";
import { env } from "../_generated/server";

// a8 encrypts connection secrets (tokens, client secrets) with AES-GCM under
// CONNECTION_ENCRYPTION_KEY before storing them. A stored value is
// "v2.<keyId>.<iv>.<ciphertext>". The key id is the first 8 base64url
// characters of the SHA-256 of the raw key. A value with another key id
// means the deployment runs with the wrong key. A value with this key id
// that doesn't decrypt is damaged. Values stored before key ids are
// "v1.<iv>.<ciphertext>". They still decrypt, and
// reencryptSecrets (convex/connectorStore.ts) rewrites them as v2.

const VERSION = "v2";
const LEGACY_VERSION = "v1";
const IV_LENGTH = 12;
const KEY_ID_LENGTH = 8;

/** CONNECTION_ENCRYPTION_KEY, imported, and its key id. */
export type EncryptionKey = { cryptoKey: CryptoKey; id: string };

/**
 * Imports CONNECTION_ENCRYPTION_KEY. Throws a ConvexError that names the
 * env var if it isn't a base64-encoded 32-byte key. Call it before storing
 * anything, so a misconfigured deployment stores nothing.
 */
export async function getEncryptionKey(): Promise<EncryptionKey> {
  const raw = env.CONNECTION_ENCRYPTION_KEY;
  let bytes: Uint8Array<ArrayBuffer> | undefined;
  try {
    bytes = raw ? base64ToBytes(raw) : undefined;
  } catch {
    bytes = undefined;
  }
  if (bytes?.length !== 32) {
    throw appError(
      ERROR_CODES.MISCONFIGURED,
      "Connectors need CONNECTION_ENCRYPTION_KEY, a base64-encoded 32-byte key. Ask whoever runs this a8 to set it.",
    );
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return {
    cryptoKey: await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]),
    id: bytesToBase64Url(digest).slice(0, KEY_ID_LENGTH),
  };
}

/** True for the ConvexError a8 throws when the deployment is set up wrong. */
export function isMisconfigured(
  error: unknown,
): error is ConvexError<AppErrorData<typeof ERROR_CODES.MISCONFIGURED>> {
  return (
    error instanceof ConvexError &&
    error.data?.code === ERROR_CODES.MISCONFIGURED
  );
}

export async function encryptSecret(
  key: EncryptionKey,
  plaintext: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key.cryptoKey,
    new TextEncoder().encode(plaintext),
  );
  return [
    VERSION,
    key.id,
    bytesToBase64(iv),
    bytesToBase64(new Uint8Array(ciphertext)),
  ].join(".");
}

/** encryptSecret for a value that may be absent, like a refresh token. */
export async function encryptOptionalSecret(
  key: EncryptionKey,
  plaintext: string | undefined,
): Promise<string | undefined> {
  return plaintext === undefined
    ? undefined
    : await encryptSecret(key, plaintext);
}

/**
 * Decrypts a stored secret. Throws a MISCONFIGURED ConvexError if it was
 * encrypted under another key, and a plain error if it's damaged.
 */
export async function decryptSecret(
  key: EncryptionKey,
  stored: string,
): Promise<string> {
  const parts = stored.split(".");
  let iv: string | undefined;
  let ciphertext: string | undefined;
  if (parts[0] === VERSION && parts.length === 4) {
    if (parts[1] !== key.id) {
      throw appError(
        ERROR_CODES.MISCONFIGURED,
        "CONNECTION_ENCRYPTION_KEY isn't the key a8 encrypted the connector tokens with. Ask whoever runs this a8 to put the old key back.",
      );
    }
    [, , iv, ciphertext] = parts;
  } else if (parts[0] === LEGACY_VERSION && parts.length === 3) {
    [, iv, ciphertext] = parts;
  }
  if (!iv || !ciphertext) {
    throw new Error("Unknown encrypted secret format.");
  }
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(iv) },
    key.cryptoKey,
    base64ToBytes(ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

/**
 * decryptSecret, or undefined if the stored value is damaged. Still throws
 * if it was encrypted under another key, since every value would fail the
 * same way and fixing the key brings them back.
 */
export async function decryptOrUndefined(
  key: EncryptionKey,
  stored: string,
): Promise<string | undefined> {
  try {
    return await decryptSecret(key, stored);
  } catch (error) {
    if (isMisconfigured(error)) throw error;
    return undefined;
  }
}

/** True for a value stored before key ids, which reencryptSecrets rewrites. */
export function isLegacySecret(stored: string): boolean {
  return stored.startsWith(`${LEGACY_VERSION}.`);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
