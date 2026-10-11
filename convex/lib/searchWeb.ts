// The only code that knows about Tavily (ADR 0001). Switching search APIs
// means changing this file. See https://docs.tavily.com/documentation/api-reference/endpoint/search
import { z } from "zod";
import { env } from "../_generated/server";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const MAX_RESULTS = 5;
/** The longest query Tavily takes. It refuses longer ones. */
export const MAX_QUERY_LENGTH = 400;
/**
 * Snippets go to the model and into the thread, so a page can't fill either
 * with a long injection.
 */
const MAX_SNIPPET_LENGTH = 500;

/**
 * One result in Tavily's response, as far as a8 reads it. Only the URL is
 * required. A field of the wrong type reads as missing.
 */
const tavilyResult = z.object({
  title: z.string().optional().catch(undefined),
  url: z.string().min(1),
  content: z.string().optional().catch(undefined),
  published_date: z.string().optional().catch(undefined),
});

/**
 * Tavily's response body. searchWeb checks each result on its own, so one
 * bad result doesn't lose the others.
 */
const tavilyResponse = z.object({
  results: z.array(z.unknown()).nullish(),
});

/** One web search result, as the model and the Sources row see it. */
export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
};

/** Whether web search is set up. It needs the optional TAVILY_API_KEY. */
export const canSearchWeb = Boolean(env.TAVILY_API_KEY);

/**
 * The top results for `query`. It asks for snippets only: no answer written
 * by Tavily, and no page text. It drops results without a URL and cuts
 * snippets to MAX_SNIPPET_LENGTH. Throws if search isn't set up, the call
 * fails or the response body isn't an object with a list of results.
 */
export async function searchWeb(
  query: string,
  abortSignal?: AbortSignal,
): Promise<WebSearchResult[]> {
  if (!env.TAVILY_API_KEY) throw new Error("Web search isn't set up.");
  const response = await fetch(TAVILY_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.TAVILY_API_KEY}`,
    },
    body: JSON.stringify({
      query,
      search_depth: "basic",
      max_results: MAX_RESULTS,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
    }),
    signal: abortSignal,
  });
  if (!response.ok) {
    throw new Error(`Web search failed with status ${response.status}.`);
  }
  const body = tavilyResponse.safeParse(await response.json());
  if (!body.success) {
    throw new Error("Web search returned a response a8 can't read.");
  }
  return (body.data.results ?? []).flatMap((item) => {
    const result = tavilyResult.safeParse(item);
    if (!result.success) return [];
    const { title, url, content, published_date } = result.data;
    return [
      {
        title: title || url,
        url,
        snippet: cut(content ?? "", MAX_SNIPPET_LENGTH),
        ...(published_date && { publishedDate: published_date }),
      },
    ];
  });
}

/** `text` cut to at most `length` characters, ending in "…" if it was cut. */
function cut(text: string, length: number): string {
  if (text.length <= length) return text;
  let end = length - 1;
  // Never leave half an emoji. Convex rejects strings that aren't valid
  // Unicode.
  if (isHighSurrogate(text.charCodeAt(end - 1))) end -= 1;
  return `${text.slice(0, end)}…`;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}
