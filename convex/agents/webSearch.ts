// See the docs at https://docs.convex.dev/agents/tools
import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { searchWeb, type WebSearchResult } from "../lib/searchWeb";
import { limitWebSearch } from "../rateLimits";

/** The tool's result once the daily search cap is hit. */
const WEB_SEARCH_OFF = "Web search is off for today.";

/**
 * What the web search tool returns: the results, or a message saying search
 * is off for today. The Sources row under a reply reads the results.
 */
export type WebSearchOutput = WebSearchResult[] | string;

/**
 * The model's web search tool. Each call counts against the daily search
 * caps first, the user's and everyone's. Over a cap, the tool returns WEB_SEARCH_OFF instead of
 * failing, so the model can still answer and tell the user.
 */
export const webSearch = createTool({
  description:
    "Search the web for current information. Returns up to 5 results, " +
    "each with a title, URL and snippet, and sometimes a published date.",
  inputSchema: z.object({
    query: z
      .string()
      .describe("What to search for, written like a search engine query."),
  }),
  execute: async (
    ctx,
    { query },
    { abortSignal },
  ): Promise<WebSearchOutput> => {
    if (!(await limitWebSearch(ctx, ctx.userId))) return WEB_SEARCH_OFF;
    return await searchWeb(query, abortSignal);
  },
});
