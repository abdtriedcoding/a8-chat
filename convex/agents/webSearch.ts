// See the docs at https://docs.convex.dev/agents/tools
import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import {
  MAX_QUERY_LENGTH,
  searchWeb,
  type WebSearchResult,
} from "../lib/searchWeb";
import { checkWebSearch, countWebSearch } from "../rateLimits";

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
 * Tavily outage don't use up the day's searches.
 */
export const webSearch = createTool({
  description:
    "Search the web for current information. Returns up to 5 results, " +
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
    return results;
  },
});
