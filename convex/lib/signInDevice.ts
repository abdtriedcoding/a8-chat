/**
 * The device cookie: a signed cookie a browser gets once it signs in to an
 * email with the right password. With it, that browser's wrong passwords
 * count against signInFailuresByDevice in place of signInFailuresByEmail
 * (rateLimits.ts), so guesses from other IPs can't lock the owner out. See
 * OWASP's "Slow Down Online Guessing Attacks with Device Cookies".
 *
 * Each email gets its own cookie, so a browser keeps one for every account
 * it signs in to. The cookie's value holds a hash of the email and a random
 * device ID. Better Auth signs only the value, so the hash keeps a cookie
 * from one account working under another account's cookie name.
 */

/** How long a browser stays trusted after its last password sign-in. */
const DEVICE_COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

/** The part of a Better Auth middleware ctx these functions use. */
type CookieCtx = {
  getSignedCookie: (
    key: string,
    secret: string,
  ) => Promise<string | false | null>;
  setSignedCookie: (
    key: string,
    value: string,
    secret: string,
    options?: { maxAge?: number },
  ) => Promise<string>;
  context: {
    secret: string;
    createAuthCookie: (
      cookieName: string,
      overrideAttributes?: { maxAge?: number },
    ) => { name: string; attributes: { maxAge?: number } };
  };
};

/**
 * The device ID from the browser's device cookie for `email`, or null if it
 * has none, or the cookie's signature or email hash doesn't match.
 */
export async function readSignInDevice(
  authCtx: CookieCtx,
  email: string,
): Promise<string | null> {
  const emailHash = await hashEmail(email);
  const { name } = deviceCookie(authCtx, emailHash);
  const value = await authCtx.getSignedCookie(name, authCtx.context.secret);
  if (!value) return null;
  const [hash, deviceId] = value.split(":");
  return hash === emailHash && deviceId ? deviceId : null;
}

/**
 * Sets the browser's device cookie for `email`, after a sign-in with the
 * right password. `deviceId` is the one the browser already had
 * (readSignInDevice), which keeps it and restarts its max age. Without
 * one, the browser gets a new ID.
 */
export async function setSignInDevice(
  authCtx: CookieCtx,
  email: string,
  deviceId: string | null,
): Promise<void> {
  const emailHash = await hashEmail(email);
  const { name, attributes } = deviceCookie(authCtx, emailHash);
  await authCtx.setSignedCookie(
    name,
    `${emailHash}:${deviceId ?? crypto.randomUUID()}`,
    authCtx.context.secret,
    attributes,
  );
}

function deviceCookie(authCtx: CookieCtx, emailHash: string) {
  // 16 hex characters keep the name short. readSignInDevice checks the full
  // hash in the value.
  return authCtx.context.createAuthCookie(
    `sign_in_device_${emailHash.slice(0, 16)}`,
    { maxAge: DEVICE_COOKIE_MAX_AGE_SECONDS },
  );
}

/** The SHA-256 of the lowercased email, in hex. */
async function hashEmail(email: string) {
  const bytes = new TextEncoder().encode(email.trim().toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
