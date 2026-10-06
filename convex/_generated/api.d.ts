/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agents_chat from "../agents/chat.js";
import type * as attachments from "../attachments.js";
import type * as auth from "../auth.js";
import type * as chat from "../chat.js";
import type * as http from "../http.js";
import type * as lib_attachments from "../lib/attachments.js";
import type * as lib_instructions from "../lib/instructions.js";
import type * as lib_prompt from "../lib/prompt.js";
import type * as lib_snippet from "../lib/snippet.js";
import type * as lib_timeZone from "../lib/timeZone.js";
import type * as rateLimits from "../rateLimits.js";
import type * as threads from "../threads.js";
import type * as titles from "../titles.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "agents/chat": typeof agents_chat;
  attachments: typeof attachments;
  auth: typeof auth;
  chat: typeof chat;
  http: typeof http;
  "lib/attachments": typeof lib_attachments;
  "lib/instructions": typeof lib_instructions;
  "lib/prompt": typeof lib_prompt;
  "lib/snippet": typeof lib_snippet;
  "lib/timeZone": typeof lib_timeZone;
  rateLimits: typeof rateLimits;
  threads: typeof threads;
  titles: typeof titles;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
