// The web search tool and the only code that knows about Tavily (ADR 0001).
// Switching search APIs means changing this file. See
// https://docs.convex.dev/agents/tools and
// https://docs.tavily.com/documentation/api-reference/endpoint/search
import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { env } from "../_generated/server";
import { recordWebSearch } from "../lib/usage";
import { checkWebSearch, countWebSearch } from "../rateLimits";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const MAX_RESULTS = 5;
/** The longest query Tavily takes. It refuses longer ones. */
const MAX_QUERY_LENGTH = 400;
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
async function searchWeb(
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

/** The tool's result once the daily search cap is hit. */
const WEB_SEARCH_OFF = "Web search is off for today.";

/** The tool's result when Tavily fails or sends an answer a8 can't read. */
const WEB_SEARCH_FAILED = "Web search failed. Answer without it.";

/**
 * What the web search tool returns: the results, or a message saying search
 * is off for today or failed. The Sources row under a reply reads the
 * results.
 */
export type WebSearchOutput = WebSearchResult[] | string;

/**
 * The model's web search tool. Each call checks the daily search caps
 * first, the user's and everyone's, and counts against them only once the
 * search goes through. Over a cap it returns WEB_SEARCH_OFF, and when the
 * search fails it returns WEB_SEARCH_FAILED, so the model can still answer
 * and tell the user. A failed search doesn't count, so retries during a
 * Tavily outage don't use up the day's searches. A search that goes
 * through costs the user one credit, and a failed one costs nothing.
 */
export const webSearch = createTool({
  description:
    `Search the web for current information. Returns up to ${MAX_RESULTS} results, ` +
    "each with a title, URL and snippet, and sometimes a published date.",
  inputSchema: z.object({
    query: z
      .string()
      .max(MAX_QUERY_LENGTH)
      .describe("What to search for, written like a search engine query."),
  }),
  execute: async (
    ctx,
    { query },
    { abortSignal },
  ): Promise<WebSearchOutput> => {
    if (!(await checkWebSearch(ctx, ctx.userId))) return WEB_SEARCH_OFF;
    let results: WebSearchResult[];
    try {
      results = await searchWeb(query, abortSignal);
    } catch (error) {
      // The user stopped the reply. That isn't a failed search.
      if (abortSignal?.aborted) throw error;
      console.error("Web search failed", error);
      return WEB_SEARCH_FAILED;
    }
    await countWebSearch(ctx, ctx.userId);
    await recordWebSearch(ctx, ctx.userId, ctx.threadId);
    return results;
  },
});
