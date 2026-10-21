// See the docs at https://docs.convex.dev/agents/getting-started
import { anthropic } from "@ai-sdk/anthropic";
import { Agent, type UsageHandler } from "@convex-dev/agent";
import type { ToolSet } from "ai";
import { components } from "../_generated/api";
import { languageModelFor } from "../lib/gateway";
import { defaultModel } from "../lib/models";
import { recordModelUsage } from "../lib/usage";
import { canSearchWeb, webSearch } from "../tools/webSearch";

/**
 * The most model calls one reply makes, reached only with connector tools.
 * Each tool round trip adds one.
 */
export const MAX_REPLY_STEPS = 20;

/** The most model calls a reply without connector tools makes. */
export const MAX_STEPS_WITHOUT_CONNECTORS = 5;

/** The tools a8 offers on every reply. A tool is offered only when it's set up. */
export const nativeTools: ToolSet = canSearchWeb ? { webSearch } : {};

/**
 * The tool a reply that defers connector tools offers for finding them
 * (ADR 0006). It's Anthropic's native BM25 search, which matches
 * plain-language queries. The gateway passes it through to Claude.
 */
export const toolSearch = anthropic.tools.toolSearchBm25_20251119();

/**
 * Logs each reply step's tokens and records its cost. Titles record theirs
 * in generateTitle.
 */
const recordReplyUsage: UsageHandler = (ctx, usage) =>
  recordModelUsage(ctx, "replyStep", usage);

// The model, instructions, tools and step limit are set for each reply
// (streamReply). The model is the thread's, the instructions carry the
// user's date, and the tools depend on the user's connections. The Agent
// needs a model of its own, but every reply passes one.
export const chatAgent = new Agent(components.agent, {
  name: "a8",
  languageModel: languageModelFor(defaultModel()),
  usageHandler: recordReplyUsage,
});
