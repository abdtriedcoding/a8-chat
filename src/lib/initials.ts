/** Up to two initials from the name, or the email's first letter. */
export function initials({
  name = "",
  email = "",
}: {
  name?: string;
  email?: string;
}): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0])
    .join("");
  return (letters || Array.from(email)[0] || "?").toUpperCase();
}
