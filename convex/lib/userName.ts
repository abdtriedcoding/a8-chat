// The name goes into every Convex token. A long one made the session and
// token routes fail, which locked the account out once its token expired.
export const MAX_NAME_LENGTH = 80;

/** The name, trimmed. Throws if it's blank or too long. */
export function checkUserName(name: string) {
  const text = name.trim();
  if (!text) throw new Error("Enter your name.");
  if (Array.from(text).length > MAX_NAME_LENGTH) {
    throw new Error(`Names can be at most ${MAX_NAME_LENGTH} characters.`);
  }
  return text;
}
