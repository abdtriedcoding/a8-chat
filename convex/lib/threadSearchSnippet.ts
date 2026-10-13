const SNIPPET_LENGTH = 120;
// How much text to keep before the match, so the snippet shows its context.
const LEAD_LENGTH = 30;

/**
 * A short piece of `text` around its first word that starts with a word of
 * `query`, with "…" at each end it cuts. It starts at the beginning when no
 * word matches. Replies are markdown, so it drops headings, bold, code marks
 * and link URLs, and collapses whitespace.
 */
export function snippetAround(text: string, query: string): string {
  const flat = text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]*)\]\([^)\s]*\)/g, "$1")
    // A code fence's language goes too, so "```ts" doesn't leave "ts".
    .replace(/\*\*|```\w*|`+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // Convex search matches whole words, or the start of a word for the last
  // term, so look for each query word at the start of a word.
  const hits = query
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((word) => flat.search(new RegExp(`(?<![\\p{L}\\p{N}])${word}`, "iu")))
    .filter((index) => index >= 0);
  const hit = hits.length > 0 ? Math.min(...hits) : 0;

  // Cut at spaces where that keeps the match, so words stay whole.
  let start = Math.max(0, hit - LEAD_LENGTH);
  const midWord = start > 0 && flat[start - 1] !== " ";
  const firstSpace = midWord ? flat.indexOf(" ", start) : -1;
  if (firstSpace !== -1 && firstSpace < hit) start = firstSpace + 1;
  let end = Math.min(flat.length, start + SNIPPET_LENGTH);
  const lastSpace = flat.lastIndexOf(" ", end);
  if (end < flat.length && lastSpace > hit) end = lastSpace;
  // Never split an emoji into a lone surrogate. Convex rejects strings that
  // aren't valid Unicode.
  if (isLowSurrogate(flat.charCodeAt(start))) start += 1;
  if (isLowSurrogate(flat.charCodeAt(end))) end -= 1;

  const head = start > 0 ? "…" : "";
  const tail = end < flat.length ? "…" : "";
  return `${head}${flat.slice(start, end).trim()}${tail}`;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
