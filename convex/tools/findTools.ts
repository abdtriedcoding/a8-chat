// a8's own tool search, for models other than Claude (ADR 0016). Claude
// uses Anthropic's (toolSearch in convex/agents/chat.ts). This one matches
// the words of a query against the deferred tools' names and descriptions.
// Each deferred tool's description starts with its connector's name
// (arrangeReplyTools), so "Linear issues" finds Linear's issue tools.

import { createTool } from "@convex-dev/agent";
import type { ToolSet } from "ai";
import { z } from "zod";

/** The most tools one search finds. */
const MAX_FOUND = 5;

/** A match in a tool's name counts this many times one in its description. */
const NAME_WEIGHT = 3;

/** Words too common to tell tools apart. */
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "the",
  "this",
  "to",
  "with",
]);

/** What findTools returns: the names of the tools it found and loaded. */
type FindToolsOutput = { tools: string[]; note?: string };

/**
 * The search tool over `deferredTools`. A search loads the tools it finds
 * for the rest of the reply, and `onFound` gets every tool found so far in
 * it, to record them for the thread.
 */
export function createFindTools(
  deferredTools: ToolSet,
  onFound: (names: string[]) => Promise<void>,
) {
  return createTool({
    description:
      "Find connector tools that aren't loaded yet. Search with the app and " +
      'the task, like "Linear issues assigned to me". Returns the names of ' +
      "the tools that match, and loads them, so you can call them next.",
    inputSchema: z.object({
      query: z.string().describe("The app and the task, in a few words."),
    }),
    execute: async (_ctx, { query }): Promise<FindToolsOutput> => {
      const found = searchTools(query, deferredTools);
      if (found.length === 0) {
        return {
          tools: [],
          note:
            "No tools matched. Search again with other words, like the " +
            "app's name and the task.",
        };
      }
      await onFound(found);
      return { tools: found };
    },
  });
}

/**
 * The names of the tools that best match the query, at most MAX_FOUND,
 * best first. A query word matches a tool word that's the same, or, for
 * words of 4 letters or more, one that starts with the other, so "issues"
 * matches "issue". Each query word counts once per tool, NAME_WEIGHT if
 * the tool's name has it, 1 if only its description does. A tool scoring
 * under half the best score isn't found, so one stray word in another
 * connector's description doesn't load its tool. Ties keep the tools'
 * order.
 */
function searchTools(query: string, tools: ToolSet): string[] {
  const terms = [...new Set(words(query))].filter(
    (term) => !STOP_WORDS.has(term),
  );
  const scored = Object.entries(tools)
    .map(([name, tool], index) => {
      const nameWords = words(name);
      const descriptionWords = words(
        typeof tool.description === "string" ? tool.description : "",
      );
      const score = terms.reduce((sum, term) => {
        if (nameWords.some((word) => wordsMatch(word, term))) {
          return sum + NAME_WEIGHT;
        }
        return descriptionWords.some((word) => wordsMatch(word, term))
          ? sum + 1
          : sum;
      }, 0);
      return { name, score, index };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const bestScore = scored[0]?.score ?? 0;
  return scored
    .filter(({ score }) => score * 2 >= bestScore)
    .slice(0, MAX_FOUND)
    .map(({ name }) => name);
}

/** The text's words in lower case, split at anything not a letter or digit. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);
}

/** Whether a tool's word matches a query's word, as searchTools says. */
function wordsMatch(word: string, term: string): boolean {
  if (word === term) return true;
  if (word.length < 4 || term.length < 4) return false;
  return word.startsWith(term) || term.startsWith(word);
}
