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
import type * as chat_approval from "../chat/approval.js";
import type * as chat_messages from "../chat/messages.js";
import type * as chat_reply from "../chat/reply.js";
import type * as chat_send from "../chat/send.js";
import type * as chat_stop from "../chat/stop.js";
import type * as chat_turns from "../chat/turns.js";
import type * as connections from "../connections.js";
import type * as connectors from "../connectors.js";
import type * as crons from "../crons.js";
import type * as emails from "../emails.js";
import type * as http from "../http.js";
import type * as lib_attachments from "../lib/attachments.js";
import type * as lib_authEmails from "../lib/authEmails.js";
import type * as lib_connectionTokens from "../lib/connectionTokens.js";
import type * as lib_connectorAuth from "../lib/connectorAuth.js";
import type * as lib_connectorToolList from "../lib/connectorToolList.js";
import type * as lib_connectorTools from "../lib/connectorTools.js";
import type * as lib_connectorView from "../lib/connectorView.js";
import type * as lib_connectors from "../lib/connectors.js";
import type * as lib_encryption from "../lib/encryption.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_guards from "../lib/guards.js";
import type * as lib_instructions from "../lib/instructions.js";
import type * as lib_oauthDiscovery from "../lib/oauthDiscovery.js";
import type * as lib_prompt from "../lib/prompt.js";
import type * as lib_replyFailure from "../lib/replyFailure.js";
import type * as lib_replyTools from "../lib/replyTools.js";
import type * as lib_snippet from "../lib/snippet.js";
import type * as lib_timeZone from "../lib/timeZone.js";
import type * as lib_toolLoading from "../lib/toolLoading.js";
import type * as rateLimits from "../rateLimits.js";
import type * as signIns from "../signIns.js";
import type * as threads from "../threads.js";
import type * as titles from "../titles.js";
import type * as toolLists from "../toolLists.js";
import type * as tools_webSearch from "../tools/webSearch.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "agents/chat": typeof agents_chat;
  attachments: typeof attachments;
  auth: typeof auth;
  "chat/approval": typeof chat_approval;
  "chat/messages": typeof chat_messages;
  "chat/reply": typeof chat_reply;
  "chat/send": typeof chat_send;
  "chat/stop": typeof chat_stop;
  "chat/turns": typeof chat_turns;
  connections: typeof connections;
  connectors: typeof connectors;
  crons: typeof crons;
  emails: typeof emails;
  http: typeof http;
  "lib/attachments": typeof lib_attachments;
  "lib/authEmails": typeof lib_authEmails;
  "lib/connectionTokens": typeof lib_connectionTokens;
  "lib/connectorAuth": typeof lib_connectorAuth;
  "lib/connectorToolList": typeof lib_connectorToolList;
  "lib/connectorTools": typeof lib_connectorTools;
  "lib/connectorView": typeof lib_connectorView;
  "lib/connectors": typeof lib_connectors;
  "lib/encryption": typeof lib_encryption;
  "lib/errors": typeof lib_errors;
  "lib/guards": typeof lib_guards;
  "lib/instructions": typeof lib_instructions;
  "lib/oauthDiscovery": typeof lib_oauthDiscovery;
  "lib/prompt": typeof lib_prompt;
  "lib/replyFailure": typeof lib_replyFailure;
  "lib/replyTools": typeof lib_replyTools;
  "lib/snippet": typeof lib_snippet;
  "lib/timeZone": typeof lib_timeZone;
  "lib/toolLoading": typeof lib_toolLoading;
  rateLimits: typeof rateLimits;
  signIns: typeof signIns;
  threads: typeof threads;
  titles: typeof titles;
  toolLists: typeof toolLists;
  "tools/webSearch": typeof tools_webSearch;
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
  resend: import("@convex-dev/resend/_generated/component.js").ComponentApi<"resend">;
};
