// The only code that encrypts or decrypts connection secrets: OAuth tokens,
// registered OAuth clients and PKCE verifiers. AES-GCM through Web Crypto,
// so it runs in Convex's default runtime. Decrypt only inside actions, and
// never return what it gives back to the browser or put it in the model's
// context.
import { env } from "../_generated/server";

/**
 * The version of VAULT_KEY that new ciphertexts use. Every ciphertext starts
 * with it, so a later key can sit next to this one while old rows are
 * re-encrypted.
 */
const KEY_VERSION = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;

/** Whether the vault is set up. It needs the optional VAULT_KEY. */
export const canUseVault = Boolean(env.VAULT_KEY);

let cachedKey: Promise<CryptoKey> | undefined;

function vaultKey(): Promise<CryptoKey> {
  cachedKey ??= importKey();
  return cachedKey;
}

async function importKey(): Promise<CryptoKey> {
  if (!env.VAULT_KEY) throw new Error("The vault isn't set up.");
  const raw = fromBase64(env.VAULT_KEY);
  if (raw.length !== KEY_BYTES) {
    throw new Error(`VAULT_KEY must be ${KEY_BYTES} bytes, base64-encoded.`);
  }
  return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

/** Encrypts `plaintext` as `v1:<base64 of IV and ciphertext>`. */
async function encrypt(plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await vaultKey(),
    new TextEncoder().encode(plaintext),
  );
  const sealed = new Uint8Array(IV_BYTES + ciphertext.byteLength);
  sealed.set(iv);
  sealed.set(new Uint8Array(ciphertext), IV_BYTES);
  return `${KEY_VERSION}:${toBase64(sealed)}`;
}

/** Decrypts what `encrypt` returned. Throws if it was tampered with. */
async function decrypt(sealed: string): Promise<string> {
  const [version, body] = sealed.split(":", 2);
  if (version !== KEY_VERSION || !body) {
    throw new Error(`Unknown vault key version: ${version}`);
  }
  const bytes = fromBase64(body);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.subarray(0, IV_BYTES) },
    await vaultKey(),
    bytes.subarray(IV_BYTES),
  );
  return new TextDecoder().decode(plaintext);
}

/** Encrypts a value as JSON. */
export async function encryptJson(value: unknown): Promise<string> {
  return await encrypt(JSON.stringify(value));
}

/** Decrypts a value that `encryptJson` encrypted. */
export async function decryptJson<T>(sealed: string): Promise<T> {
  return JSON.parse(await decrypt(sealed)) as T;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}
