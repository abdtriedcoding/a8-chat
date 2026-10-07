// The only code that knows about Tavily (ADR 0001). Switching search APIs
// means changing this file. See https://docs.tavily.com/documentation/api-reference/endpoint/search
import { env } from "../_generated/server";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const MAX_RESULTS = 5;

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
 * by Tavily, and no page text. Throws if search isn't set up or the call
 * fails.
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
  const { results } = (await response.json()) as {
    results: Array<{
      title: string;
      url: string;
      content: string;
      published_date?: string;
    }>;
  };
  return results.map((result) => ({
    title: result.title,
    url: result.url,
    snippet: result.content,
    ...(result.published_date && { publishedDate: result.published_date }),
  }));
}
