// The name and image go into every Convex token. A long name made the
// session and token routes fail, which locked the account out once its token
// expired.
export const MAX_NAME_LENGTH = 80;

// Google's photo URLs, the only image a8 sets, are about 100 characters.
export const MAX_IMAGE_LENGTH = 512;

/** The name, trimmed. Throws if it's blank or too long. */
export function checkUserName(name: string) {
  const text = name.trim();
  if (!text) throw new Error("Enter your name.");
  if (Array.from(text).length > MAX_NAME_LENGTH) {
    throw new Error(`Names can be at most ${MAX_NAME_LENGTH} characters.`);
  }
  return text;
}

/** Throws if the image URL is too long. Null or absent is fine. */
export function checkUserImage(image: unknown) {
  if (typeof image === "string" && image.length > MAX_IMAGE_LENGTH) {
    throw new Error(
      `Image URLs can be at most ${MAX_IMAGE_LENGTH} characters.`,
    );
  }
}
