// Connections: one user's signed-in link to a catalog connector.
//
// Connecting takes three steps. `connect` starts an MCP sign-in and returns
// the URL for the popup. The app's server sends the user back to
// `signInCallback`, which checks the state and keeps the code. Then the
// /apps/callback page, signed in as the user, calls `finishConnect`, which
// checks the sign-in is theirs, exchanges the code, and stores the tokens
// and the tool list. Finishing through the user's own session means a
// sign-in link sent to someone else can't connect their app to the
// sender's account.
import { ConvexError, v, type Infer } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  action,
  env,
  httpAction,
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
} from "./_generated/server";
import { authComponent, requireUser } from "./auth";
import { connectors, getConnector } from "./connectors/registry";
import { isLocalPath } from "./lib/localPath";
import {
  finishSignIn,
  listTools,
  revokeTokens,
  SignInUnsupportedError,
  startSignIn,
  type OAuthSession,
  type Tool,
} from "./lib/mcp";
import { canUseVault, decryptJson, encryptJson } from "./lib/vault";
import schema from "./schema";

const SIGN_IN_TTL_MS = 10 * 60 * 1000;
const DEFAULT_RETURN_PATH = "/apps";

/** Where the server sends the user back after they sign in. */
const callbackUrl = () => `${env.CONVEX_SITE_URL}/connections/callback`;

const vStatus = v.union(
  v.literal("notConnected"),
  v.literal("connected"),
  v.literal("needsReconnect"),
);

const vCatalogEntry = v.object({
  handle: v.string(),
  name: v.string(),
  description: v.string(),
  access: v.array(v.string()),
  status: vStatus,
  connectionId: v.optional(v.id("connections")),
});

/**
 * The catalog with the user's status for each connector. `available` is
 * false when the vault isn't set up, and then nothing can connect.
 */
export const list = query({
  args: {},
  returns: v.object({
    available: v.boolean(),
    connectors: v.array(vCatalogEntry),
  }),
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    const entries = await Promise.all(
      connectors.map(async (connector) => {
        const connection = user
          ? await ctx.db
              .query("connections")
              .withIndex("by_userId_and_connector", (q) =>
                q.eq("userId", user._id).eq("connector", connector.handle),
              )
              .unique()
          : null;
        return {
          handle: connector.handle,
          name: connector.name,
          description: connector.description,
          access: connector.access,
          status: connection?.status ?? ("notConnected" as const),
          ...(connection && { connectionId: connection._id }),
        };
      }),
    );
    return { available: canUseVault, connectors: entries };
  },
});

/** Why connect or disconnect didn't go ahead. Returned, not thrown. */
const vConnectionRefused = v.object({
  code: v.union(
    v.literal("NOT_SET_UP"),
    v.literal("NOT_FOUND"),
    v.literal("SIGN_IN_FAILED"),
  ),
  message: v.string(),
});

export type ConnectionRefused = Infer<typeof vConnectionRefused>;

/**
 * Starts connecting a catalog connector, and returns the sign-in URL to
 * open. `returnPath` is the a8 page to come back to after a full-page
 * sign-in.
 */
export const connect = action({
  args: { connector: v.string(), returnPath: v.string() },
  returns: v.union(
    v.object({ authorizationUrl: v.string() }),
    vConnectionRefused,
  ),
  handler: async (
    ctx,
    { connector: handle, returnPath },
  ): Promise<{ authorizationUrl: string } | ConnectionRefused> => {
    const user = await requireUser(ctx);
    if (!canUseVault) return notSetUp;
    const connector = getConnector(handle);
    if (!connector) {
      throw new ConvexError({
        code: "INVALID_ARGUMENT",
        message: `Unknown connector: ${handle}`,
      });
    }
    if (!isLocalPath(returnPath)) {
      throw new ConvexError({
        code: "INVALID_ARGUMENT",
        message: "The return path must be an a8 page.",
      });
    }

    const state = randomState();
    try {
      const { authorizationUrl, session } = await startSignIn({
        serverUrl: connector.serverUrl,
        redirectUrl: callbackUrl(),
        state,
        scope: connector.scopes?.join(" "),
      });
      const { sealedClient, discovery } = await sealSession(session);
      if (!sealedClient || !session.codeVerifier) {
        throw new Error("The sign-in has no client or PKCE verifier.");
      }
      await ctx.runMutation(internal.connections.createSignIn, {
        state,
        userId: user._id,
        connector: connector.handle,
        returnPath,
        sealedCodeVerifier: await encryptJson(session.codeVerifier),
        sealedClient,
        discovery,
      });
      return { authorizationUrl };
    } catch (error) {
      if (error instanceof SignInUnsupportedError) {
        return { code: "SIGN_IN_FAILED", message: error.message };
      }
      console.error(`Starting the ${handle} sign-in failed:`, error);
      return {
        code: "SIGN_IN_FAILED",
        message: `Couldn't start signing in to ${connector.name}. Please try again.`,
      };
    }
  },
});

const vSignInResult = v.union(
  v.literal("connected"),
  v.literal("cancelled"),
  v.literal("failed"),
  v.literal("expired"),
);

/** How a sign-in ended, as the /apps/callback page reports it. */
export type SignInResult = Infer<typeof vSignInResult>;

/**
 * Where the authorization server sends the user back (convex/http.ts).
 * Keeps the code on the sign-in, then sends the user to /apps/callback,
 * which finishes it with finishConnect. A refused or failed sign-in ends
 * here.
 */
export const signInCallback = httpAction(async (ctx, request) => {
  const params = new URL(request.url).searchParams;
  const state = params.get("state");
  const code = params.get("code");
  if (!state) return toCallbackPage({ result: "expired" });

  if (code) {
    const signIn = await ctx.runMutation(internal.connections.addSignInCode, {
      state,
      sealedCode: await encryptJson(code),
    });
    return signIn
      ? toCallbackPage({ state, connector: signIn.connector })
      : toCallbackPage({ result: "expired" });
  }

  const signIn = await ctx.runMutation(internal.connections.takeSignIn, {
    state,
  });
  if (!signIn) return toCallbackPage({ result: "expired" });
  return toCallbackPage({
    result: params.get("error") === "access_denied" ? "cancelled" : "failed",
    connector: signIn.connector,
    returnPath: signIn.returnPath,
  });
});

function toCallbackPage(params: {
  state?: string;
  result?: Exclude<SignInResult, "connected">;
  connector?: string;
  returnPath?: string;
}): Response {
  const url = new URL("/apps/callback", env.SITE_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return new Response(null, {
    status: 302,
    headers: { Location: url.href, "Cache-Control": "no-store" },
  });
}

/**
 * Finishes a sign-in the server sent back with a code. Only the user who
 * started it can finish it. Exchanges the code for tokens, caches the
 * server's tools, and saves the connection.
 */
export const finishConnect = action({
  args: { state: v.string() },
  returns: v.object({
    result: vSignInResult,
    connector: v.optional(v.string()),
    returnPath: v.string(),
  }),
  handler: async (
    ctx,
    { state },
  ): Promise<{
    result: SignInResult;
    connector?: string;
    returnPath: string;
  }> => {
    const user = await requireUser(ctx);
    const signIn = await ctx.runMutation(internal.connections.takeSignIn, {
      state,
    });
    if (!signIn?.sealedCode || signIn.userId !== user._id) {
      return { result: "expired", returnPath: DEFAULT_RETURN_PATH };
    }
    const finish = (result: SignInResult) => ({
      result,
      connector: signIn.connector,
      returnPath: signIn.returnPath,
    });
    const connector = getConnector(signIn.connector);
    if (!connector) return finish("failed");

    let session: OAuthSession;
    try {
      session = await finishSignIn({
        serverUrl: connector.serverUrl,
        redirectUrl: callbackUrl(),
        authorizationCode: await decryptJson<string>(signIn.sealedCode),
        session: {
          ...(await openSession(signIn)),
          codeVerifier: await decryptJson<string>(signIn.sealedCodeVerifier),
        },
      });
    } catch (error) {
      console.error(`Finishing the ${connector.handle} sign-in failed:`, error);
      return finish("failed");
    }

    const tokens = session.tokens!;
    try {
      const tools = await listTools(connector.serverUrl, tokens.access_token);
      await ctx.runMutation(internal.connections.saveConnection, {
        userId: user._id,
        connector: connector.handle,
        ...(await sealSession(session)),
        scopes: tokens.scope,
        expiresAt:
          tokens.expires_in === undefined
            ? undefined
            : Date.now() + tokens.expires_in * 1000,
        tools: toolRows(tools, connector.checked),
      });
      return finish("connected");
    } catch (error) {
      console.error(`Connecting ${connector.handle} failed:`, error);
      // No connection holds the new tokens, so don't leave them working.
      await revokeTokens(session).catch(() => {});
      return finish("failed");
    }
  },
});

/**
 * Disconnects one of the user's connections. Revokes its token where the
 * server allows it, then deletes it and its tools. Another user's
 * connection is not found.
 */
export const disconnect = action({
  args: { connectionId: v.id("connections") },
  returns: v.union(v.null(), vConnectionRefused),
  handler: async (ctx, { connectionId }): Promise<null | ConnectionRefused> => {
    const user = await requireUser(ctx);
    const connection = await ctx.runQuery(internal.connections.getOwn, {
      connectionId,
      userId: user._id,
    });
    if (!connection) return notFound;
    // Deleting goes ahead even if revoking fails, so a8 loses access either
    // way. The server keeps the token alive until it expires.
    try {
      await revokeTokens(await openSession(connection));
    } catch (error) {
      console.error(`Revoking ${connection.connector} failed:`, error);
    }
    await ctx.runMutation(internal.connections.deleteConnection, {
      connectionId,
      userId: user._id,
    });
    return null;
  },
});

export const createSignIn = internalMutation({
  args: {
    state: v.string(),
    userId: v.string(),
    connector: v.string(),
    returnPath: v.string(),
    sealedCodeVerifier: v.string(),
    sealedClient: v.string(),
    discovery: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const signInId = await ctx.db.insert("signIns", {
      ...args,
      expiresAt: Date.now() + SIGN_IN_TTL_MS,
    });
    await ctx.scheduler.runAfter(
      SIGN_IN_TTL_MS,
      internal.connections.deleteSignIn,
      { signInId },
    );
    return null;
  },
});

/**
 * Keeps the code the server sent back on the sign-in with this state.
 * Returns the sign-in's connector, or null if there's no such sign-in, it
 * expired, or it already has a code.
 */
export const addSignInCode = internalMutation({
  args: { state: v.string(), sealedCode: v.string() },
  returns: v.union(v.object({ connector: v.string() }), v.null()),
  handler: async (ctx, { state, sealedCode }) => {
    const signIn = await findSignIn(ctx, state);
    if (!signIn || signIn.sealedCode || signIn.expiresAt <= Date.now()) {
      return null;
    }
    await ctx.db.patch("signIns", signIn._id, { sealedCode });
    return { connector: signIn.connector };
  },
});

/**
 * Deletes the sign-in with this state and returns it, or null if there's
 * none or it expired. Taking it means a state works once.
 */
export const takeSignIn = internalMutation({
  args: { state: v.string() },
  returns: v.union(schema.doc("signIns"), v.null()),
  handler: async (ctx, { state }) => {
    const signIn = await findSignIn(ctx, state);
    if (!signIn) return null;
    await ctx.db.delete("signIns", signIn._id);
    return signIn.expiresAt > Date.now() ? signIn : null;
  },
});

export const deleteSignIn = internalMutation({
  args: { signInId: v.id("signIns") },
  returns: v.null(),
  handler: async (ctx, { signInId }) => {
    if (await ctx.db.get("signIns", signInId)) {
      await ctx.db.delete("signIns", signInId);
    }
    return null;
  },
});

async function findSignIn(ctx: MutationCtx, state: string) {
  return await ctx.db
    .query("signIns")
    .withIndex("by_state", (q) => q.eq("state", state))
    .unique();
}

const vToolRow = v.object({
  name: v.string(),
  description: v.optional(v.string()),
  inputSchema: v.string(),
  kind: v.union(v.literal("read"), v.literal("action")),
});

/**
 * Creates the user's connection to a catalog connector, or replaces its
 * tokens and tools if they already have one. A user has at most one
 * connection per catalog connector.
 */
export const saveConnection = internalMutation({
  args: {
    userId: v.string(),
    connector: v.string(),
    sealedTokens: v.optional(v.string()),
    scopes: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    sealedClient: v.optional(v.string()),
    discovery: v.optional(v.string()),
    tools: v.array(vToolRow),
  },
  returns: v.id("connections"),
  handler: async (ctx, { tools, ...args }) => {
    const connector = getConnector(args.connector);
    if (!connector) throw new Error(`Unknown connector: ${args.connector}`);
    const fields = {
      ...args,
      handle: connector.handle,
      serverUrl: connector.serverUrl,
      status: "connected" as const,
    };
    const existing = await ctx.db
      .query("connections")
      .withIndex("by_userId_and_connector", (q) =>
        q.eq("userId", args.userId).eq("connector", args.connector),
      )
      .unique();
    let connectionId: Id<"connections">;
    if (existing) {
      connectionId = existing._id;
      await ctx.db.replace("connections", connectionId, fields);
      await deleteTools(ctx, connectionId);
    } else {
      connectionId = await ctx.db.insert("connections", fields);
    }
    for (const tool of tools) {
      await ctx.db.insert("tools", { ...tool, connectionId, enabled: true });
    }
    return connectionId;
  },
});

/** The connection if `userId` owns it, else null. */
export const getOwn = internalQuery({
  args: { connectionId: v.id("connections"), userId: v.string() },
  returns: v.union(schema.doc("connections"), v.null()),
  handler: async (ctx, { connectionId, userId }) => {
    const connection = await ctx.db.get("connections", connectionId);
    return connection?.userId === userId ? connection : null;
  },
});

export const deleteConnection = internalMutation({
  args: { connectionId: v.id("connections"), userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { connectionId, userId }) => {
    const connection = await ctx.db.get("connections", connectionId);
    if (connection?.userId !== userId) return null;
    await deleteTools(ctx, connectionId);
    await ctx.db.delete("connections", connectionId);
    return null;
  },
});

async function deleteTools(ctx: MutationCtx, connectionId: Id<"connections">) {
  const tools = ctx.db
    .query("tools")
    .withIndex("by_connectionId", (q) => q.eq("connectionId", connectionId));
  for await (const tool of tools) {
    await ctx.db.delete("tools", tool._id);
  }
}

/**
 * The tool rows to cache. A tool is a read only if the connector's server
 * is checked and the tool says it's read-only. Every other tool is an
 * action, which waits for the user's approval.
 */
function toolRows(tools: Tool[], checked: boolean): Infer<typeof vToolRow>[] {
  return tools.map((tool) => ({
    name: tool.name,
    ...(tool.description && { description: tool.description }),
    inputSchema: JSON.stringify(tool.inputSchema),
    kind:
      checked && tool.annotations?.readOnlyHint === true ? "read" : "action",
  }));
}

/**
 * A sign-in session as the connections and signIns tables store it: the
 * tokens and the client sealed by the vault, and the discovery state as
 * plain JSON, since it holds only the server's public metadata.
 */
type SealedSession = {
  sealedTokens?: string;
  sealedClient?: string;
  discovery?: string;
};

async function sealSession(session: OAuthSession): Promise<SealedSession> {
  return {
    ...(session.tokens && { sealedTokens: await encryptJson(session.tokens) }),
    ...(session.client && { sealedClient: await encryptJson(session.client) }),
    ...(session.discovery && { discovery: JSON.stringify(session.discovery) }),
  };
}

/** Decrypts a sealed session. Actions only. */
async function openSession(sealed: SealedSession): Promise<OAuthSession> {
  return {
    ...(sealed.sealedTokens && {
      tokens: await decryptJson(sealed.sealedTokens),
    }),
    ...(sealed.sealedClient && {
      client: await decryptJson(sealed.sealedClient),
    }),
    ...(sealed.discovery && { discovery: JSON.parse(sealed.discovery) }),
  };
}

/** Returns 32 random bytes as base64url, for an OAuth state. */
function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

const notSetUp: ConnectionRefused = {
  code: "NOT_SET_UP",
  message: "Apps aren't set up on this server.",
};

const notFound: ConnectionRefused = {
  code: "NOT_FOUND",
  message: "That app isn't connected.",
};
