import { GlobeIcon } from "lucide-react";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import type { ThreadMessage } from "@/lib/stopped-turns";
import type { WebSearchOutput } from "../../../convex/agents/webSearch";
import type { WebSearchResult } from "../../../convex/lib/searchWeb";

/** A reply's call to the web search tool (convex/agents/webSearch.ts). */
type WebSearchPart = {
  type: "tool-webSearch";
  state: string;
  // Partial while the model is still writing it.
  input?: { query?: string };
  output?: WebSearchOutput;
};

/** The reply's web searches, in the order the model ran them. */
export function webSearchParts(message: ThreadMessage): WebSearchPart[] {
  // The UI message doesn't know the tool's types, so this narrows by name.
  return message.parts.filter(
    (part) => part.type === "tool-webSearch",
  ) as unknown as WebSearchPart[];
}

/** Whether a search is still running, without a result or an error yet. */
export function isSearching(part: WebSearchPart): boolean {
  return part.state === "input-streaming" || part.state === "input-available";
}

/**
 * Every result the reply's searches found, once per URL. Results that
 * aren't http or https links are left out, since they come from the web.
 */
export function searchSources(parts: WebSearchPart[]): WebSearchResult[] {
  const sources = new Map<string, WebSearchResult>();
  for (const part of parts) {
    if (part.state !== "output-available" || !Array.isArray(part.output)) {
      continue;
    }
    for (const result of part.output) {
      if (siteName(result.url) && !sources.has(result.url)) {
        sources.set(result.url, result);
      }
    }
  }
  return [...sources.values()];
}

/** The row a reply shows while its search runs. */
export function SearchingMarker({ query }: { query?: string }) {
  return (
    <Marker>
      <MarkerIcon>
        <GlobeIcon />
      </MarkerIcon>
      <MarkerContent className="shimmer">
        {query ? (
          <>Searching the web for &quot;{query}&quot;</>
        ) : (
          "Searching the web…"
        )}
      </MarkerContent>
    </Marker>
  );
}

/** The links under a reply that searched the web: each result's site and title. */
export function SourcesRow({ sources }: { sources: WebSearchResult[] }) {
  return (
    <section aria-label="Sources" className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">Sources</span>
      <ul className="flex flex-wrap gap-1.5">
        {sources.map((source) => (
          <li key={source.url} className="max-w-full min-w-0">
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              title={source.title}
              className="flex max-w-72 items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs transition-colors hover:bg-muted"
            >
              <span className="shrink-0 font-medium">
                {siteName(source.url)}
              </span>
              <span className="truncate text-muted-foreground">
                {source.title}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "theverge.com" for "https://www.theverge.com/news/1". Null unless it's http(s). */
function siteName(url: string): string | null {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== "https:" && protocol !== "http:") return null;
    return hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
