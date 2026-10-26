// One key per inbox, so one person can't hold several accounts through
// email aliases, or start over by deleting their account and signing up
// again (accountEmails and deletedUsage in schema.ts, ADR 0019). The
// sign-in page imports it too, so it imports nothing from Convex.

/**
 * Why sign-up refused an email whose key an account has. Google sign-up
 * shows it from an `?error=` code (oauthErrorMessage).
 */
export const EMAIL_TAKEN_MESSAGE =
  "An account already uses this email, or an address that reaches the same inbox. Sign in to it instead.";

/** Gmail ignores dots in the name, and googlemail.com is the same mail. */
const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/**
 * The address lowercased, without a +tag, and for Gmail without dots in
 * the name. Most mail providers deliver a+tag@ to a@, so addresses with
 * the same result reach the same inbox.
 */
export function normalizeEmail(email: string): string {
  const address = email.trim().toLowerCase();
  const at = address.lastIndexOf("@");
  let name = address.slice(0, at);
  let domain = address.slice(at + 1);
  const plus = name.indexOf("+");
  // A name that starts with + has no name before its tag.
  if (plus > 0) name = name.slice(0, plus);
  if (GMAIL_DOMAINS.has(domain)) {
    name = name.replaceAll(".", "");
    domain = "gmail.com";
  }
  return `${name}@${domain}`;
}

/**
 * The SHA-256 of the normalized address, in hex. a8 stores this, not the
 * address, so a deleted account's row doesn't keep its email.
 */
export async function emailKey(email: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizeEmail(email));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
