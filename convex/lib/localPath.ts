/**
 * Whether `path` is a path on this site, like /apps. Rejects full URLs,
 * protocol-relative ones like //example.com, and backslashes, whitespace
 * and control characters, which browsers drop or rewrite while parsing a
 * URL and so could turn a path into another site's address.
 */
export function isLocalPath(path: string): boolean {
  return (
    path.length <= MAX_LENGTH &&
    path.startsWith("/") &&
    !path.startsWith("//") &&
    !/[\\\s\x00-\x1f\x7f]/.test(path)
  );
}

// A thread's path is /c/ and an ID, so this is plenty.
const MAX_LENGTH = 200;
