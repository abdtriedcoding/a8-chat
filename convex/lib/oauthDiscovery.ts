// OAuth metadata discovery (RFC 9728, RFC 8414, OpenID Connect): where a
// vendor's metadata may be, and how to fetch it. Used by revocation and by
// scripts/probe-connector.ts.

/** A JSON object from OAuth metadata. */
export type Metadata = Record<string, unknown>;

/** One request metadata discovery made, and how it went. */
export type MetadataAttempt = { url: string } & (
  | { response: Response; outcome: "found" | "notOk" | "notJson" }
  | { error: unknown }
);

/**
 * Where an MCP server's protected resource metadata may be (RFC 9728), in
 * the order an MCP client tries them: the URL from the server's
 * WWW-Authenticate challenge, the path-specific well-known URL, then the
 * root one.
 */
export function protectedResourceMetadataUrls(
  mcpServerUrl: string,
  fromChallenge?: string,
): string[] {
  const { origin, pathname } = new URL(mcpServerUrl);
  const path = pathname.replace(/\/$/, "");
  const wellKnown = `${origin}/.well-known/oauth-protected-resource`;
  return unique([fromChallenge, path && `${wellKnown}${path}`, wellKnown]);
}

/**
 * The authorization servers protected resource metadata names. Without
 * any, MCP clients fall back to the MCP server's origin.
 */
export function authorizationServersIn(
  resourceMetadata: Metadata | undefined,
  mcpServerUrl: string,
): string[] {
  const named = resourceMetadata?.authorization_servers;
  if (Array.isArray(named)) {
    const servers = named.filter((server) => typeof server === "string");
    if (servers.length > 0) return servers;
  }
  return [new URL(mcpServerUrl).origin];
}

/**
 * Where an authorization server's metadata may be, in the order an MCP
 * client tries them: RFC 8414, then OpenID Connect discovery.
 */
export function authorizationServerMetadataUrls(
  authorizationServerUrl: string,
): string[] {
  const { origin, pathname } = new URL(authorizationServerUrl);
  const path = pathname.replace(/\/$/, "");
  return unique([
    `${origin}/.well-known/oauth-authorization-server${path}`,
    `${origin}/.well-known/openid-configuration${path}`,
    path && `${origin}${path}/.well-known/openid-configuration`,
  ]);
}

/**
 * Fetches each URL in turn and returns the first JSON object, with the URL
 * and response it came from. A URL that fails, answers an error status or
 * isn't a JSON object is skipped. `onAttempt` hears how each request went.
 */
export async function fetchMetadata(
  fetchFn: (url: string, init: RequestInit) => Promise<Response>,
  urls: string[],
  {
    signal,
    onAttempt,
  }: {
    signal?: AbortSignal;
    onAttempt?: (attempt: MetadataAttempt) => void;
  } = {},
): Promise<
  { metadata: Metadata; url: string; response: Response } | undefined
> {
  for (const url of urls) {
    let response: Response;
    try {
      response = await fetchFn(url, {
        headers: { Accept: "application/json" },
        signal,
      });
    } catch (error) {
      onAttempt?.({ url, error });
      continue;
    }
    if (!response.ok) {
      onAttempt?.({ url, response, outcome: "notOk" });
      continue;
    }
    const metadata: unknown = await response.json().catch(() => undefined);
    if (
      typeof metadata !== "object" ||
      metadata === null ||
      Array.isArray(metadata)
    ) {
      onAttempt?.({ url, response, outcome: "notJson" });
      continue;
    }
    onAttempt?.({ url, response, outcome: "found" });
    return { metadata: metadata as Metadata, url, response };
  }
  return undefined;
}

function unique(urls: (string | undefined)[]): string[] {
  return [...new Set(urls.filter((url): url is string => Boolean(url)))];
}
