const SNIPPET_LENGTH = 120;
// How much text to keep before the match, so the snippet shows its context.
const LEAD_LENGTH = 30;

/**
 * About 120 characters of `text` around the first word of `query` it
 * contains, with "…" where text was cut. Starts at the beginning when no
 * word is found. Replies are markdown, so headings, bold, code marks and
 * link URLs are dropped, and whitespace is collapsed.
 */
export function snippetAround(text: string, query: string): string {
  const flat = text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]*)\]\([^)\s]*\)/g, "$1")
    .replace(/\*\*|`+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const lower = flat.toLowerCase();
  const hits = query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => lower.indexOf(word))
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
  // Never split an emoji into a lone surrogate (Convex rejects strings that
  // aren't valid Unicode).
  if (isLowSurrogate(flat.charCodeAt(start))) start += 1;
  if (isLowSurrogate(flat.charCodeAt(end))) end -= 1;

  const head = start > 0 ? "…" : "";
  const tail = end < flat.length ? "…" : "";
  return `${head}${flat.slice(start, end).trim()}${tail}`;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
