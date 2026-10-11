/**
 * Prints what a catalog entry needs from a vendor's MCP server: its OAuth
 * metadata, every origin the sign-in touches, scopes and tools. Given a
 * catalog connector's ID, it also checks that entry against the live server.
 * Metadata discovery is a8's own (convex/lib/connectorAuth.ts), without the
 * pinned origins. A dev helper, not a test. USAGE below lists the options,
 * and docs/connectors/README.md explains the output.
 */
import { createServer } from "node:http";
import { parseArgs } from "node:util";
import {
  auth,
  createMCPClient,
  type ListToolsResult,
  type OAuthAuthorizationServerInformation,
  type OAuthClientInformation,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthTokens,
} from "@ai-sdk/mcp";
import {
  authorizationServerMetadataUrls,
  authorizationServersIn,
  fetchMetadata,
  protectedResourceMetadataUrls,
  signInScope,
} from "../convex/lib/connectorAuth";
import {
  findAllowlistedTool,
  findConnector,
  signInServer,
  type Connector,
  type ConnectorServer,
} from "../convex/lib/connectors";
import { modelToolName } from "../convex/lib/connectorView";

/** How long each request to the vendor can take. */
const TIMEOUT_MS = 15_000;
/** The localhost port --sign-in's redirect URI points at. */
const CALLBACK_PORT = 8976;
/** How long --sign-in waits for the browser to come back. */
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

const USAGE = `Usage: bun scripts/probe-connector.ts <mcp-url | connector-id> [options]

  --token <token>  List tools with this access token. MCP_TOKEN works too.
  --sign-in        Sign in through the browser to get a token. Needs a
                   registration endpoint, and registers a new client each run.
  --scope <scope>  The scope --sign-in asks for. Defaults to the catalog
                   connector's scopes, if it has any.`;

type Json = Record<string, unknown>;
type Tool = ListToolsResult["tools"][number];

/** Each origin the probe reached, with what reached it. */
type Origins = Map<string, Set<string>>;

/** What the probe learned, for the catalog check. */
type Findings = {
  origins: Origins;
  /** The authorization servers whose metadata the probe found. */
  authorizationServers: string[];
  registrationEndpoint?: string;
  /** Each server's tools, by server key. Unset if listing failed. */
  tools?: Map<string, Tool[]>;
  /** Why there's no tool list, when there isn't one. */
  noToolsReason: string;
};

/** The use of an origin that a8's server never fetches, so it needn't be pinned. */
const BROWSER_ONLY = "authorization endpoint (browser)";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    token: { type: "string" },
    "sign-in": { type: "boolean" },
    scope: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help || positionals.length !== 1) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 2);
}

const target = positionals[0];
const connector = URL.canParse(target) ? undefined : findConnector(target);
if (!URL.canParse(target) && !connector) {
  console.error(`"${target}" is neither a URL nor a catalog connector ID.`);
  process.exit(2);
}
// A URL that isn't in the catalog yet is probed as one server with no
// allowlist.
const servers: ConnectorServer[] = connector?.servers ?? [
  { key: "", url: target },
];
// Sign-in reads the first server's OAuth metadata (signInServer).
const mcpUrl = connector ? signInServer(connector).url : target;
const findings: Findings = {
  origins: new Map(),
  authorizationServers: [],
  noToolsReason: "pass --token or --sign-in to list tools",
};
for (const server of servers) {
  noteOrigin(findings.origins, server.url, "MCP server");
}

heading(
  connector
    ? `${connector.name} (${servers.map((server) => server.url).join(", ")})`
    : mcpUrl,
);

heading("initialize without a token");
const anonymous = await initializeWithoutToken(mcpUrl);
console.log(anonymous.summary);

heading("Protected resource metadata");
const resource = await firstJson(
  findings.origins,
  protectedResourceMetadataUrls(mcpUrl, anonymous.challenge.resource_metadata),
  "protected resource metadata",
);
printJson(resource);

heading("Authorization server metadata");
const serverMetadata: Json[] = [];
for (const server of authorizationServersIn(resource, mcpUrl)) {
  console.log(`${server}:`);
  const metadata = await firstJson(
    findings.origins,
    authorizationServerMetadataUrls(server),
    "authorization server metadata",
  );
  printJson(metadata);
  if (!metadata) continue;
  noteOrigin(findings.origins, server, "authorization server");
  findings.authorizationServers.push(server);
  serverMetadata.push(metadata);
}

heading("OAuth");
findings.registrationEndpoint = serverMetadata
  .map((metadata) => stringField(metadata, "registration_endpoint"))
  .find((endpoint) => endpoint !== undefined);
console.log(`registration endpoint: ${findings.registrationEndpoint ?? "none"}`);
for (const field of [
  "client_id_metadata_document_supported",
  "token_endpoint_auth_methods_supported",
  "code_challenge_methods_supported",
  "grant_types_supported",
]) {
  console.log(`${field}: ${formatValues(serverMetadata, field)}`);
}
console.log(
  `scopes: ${describeScopes(resource, serverMetadata, anonymous.challenge.scope)}`,
);
for (const metadata of serverMetadata) {
  for (const [field, use] of [
    ["authorization_endpoint", BROWSER_ONLY],
    ["token_endpoint", "token endpoint"],
    ["registration_endpoint", "registration endpoint"],
    ["revocation_endpoint", "revocation endpoint"],
  ]) {
    const endpoint = stringField(metadata, field);
    if (endpoint) noteOrigin(findings.origins, endpoint, use);
  }
}

heading("Origins");
for (const [origin, uses] of findings.origins) {
  console.log(`${origin}  ${[...uses].join(", ")}`);
}

let token = values.token ?? process.env.MCP_TOKEN;
if (!token && values["sign-in"]) {
  heading("Signing in");
  try {
    token = await signIn(
      mcpUrl,
      values.scope ?? (connector && signInScope(connector)),
    );
  } catch (error) {
    console.log(`Signing in failed: ${describeError(error)}`);
    findings.noToolsReason = "signing in failed";
  }
}

if (token || anonymous.ok) {
  const listed = new Map<string, Tool[]>();
  for (const server of servers) {
    heading(servers.length > 1 ? `Tools on ${server.key} (${server.url})` : "Tools");
    try {
      const tools = await listTools(server.url, token);
      listed.set(server.key, tools);
      printTools(tools, server);
    } catch (error) {
      findings.noToolsReason = `listing ${server.url}'s tools failed: ${describeError(error)}`;
      console.log(findings.noToolsReason);
    }
  }
  if (listed.size === servers.length) findings.tools = listed;
} else {
  heading("Tools");
  console.log(findings.noToolsReason);
}

if (connector) {
  heading(`Catalog check: ${connector.id}`);
  const failures = checkCatalogEntry(connector, findings);
  if (failures > 0) {
    console.log(`\n${failures} problem${failures === 1 ? "" : "s"} found.`);
    process.exit(1);
  }
}
process.exit(0);

/**
 * Sends `initialize` with no token. A server that needs sign-in answers 401
 * with a WWW-Authenticate challenge, which can name the resource metadata
 * URL and the scope.
 */
async function initializeWithoutToken(url: string): Promise<{
  ok: boolean;
  summary: string;
  challenge: Record<string, string>;
}> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "a8-probe", version: "0" },
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // A streamed reply can stay open, and only the status matters here.
    await response.body?.cancel();
    const header = response.headers.get("WWW-Authenticate") ?? undefined;
    const lines = [
      response.ok
        ? `works (${response.status}): the server needs no token.`
        : `refused (${response.status}).`,
    ];
    if (header) lines.push(`WWW-Authenticate: ${header}`);
    return {
      ok: response.ok,
      summary: lines.join("\n"),
      challenge: parseChallenge(header),
    };
  } catch (error) {
    return {
      ok: false,
      summary: `failed: ${describeError(error)}`,
      challenge: {},
    };
  }
}

/** The `key="value"` parameters of a WWW-Authenticate header. */
function parseChallenge(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    Array.from(header.matchAll(/(\w+)="([^"]*)"/g), (match) => [
      match[1],
      match[2],
    ]),
  );
}

/**
 * Fetches each URL in turn and returns the first JSON object, printing a
 * line per attempt (fetchMetadata). Notes the origin of the one that
 * answered, and of any redirect it followed.
 */
async function firstJson(
  origins: Origins,
  urls: string[],
  use: string,
): Promise<Json | undefined> {
  const found = await fetchMetadata(
    (url, init) =>
      fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) }),
    urls,
    {
      onAttempt: (attempt) => {
        if ("error" in attempt) {
          console.log(`  ---  ${attempt.url}: ${describeError(attempt.error)}`);
          return;
        }
        const { url, response, outcome } = attempt;
        const redirect = response.redirected ? ` (redirected to ${response.url})` : "";
        console.log(`  ${response.status}  ${url}${redirect}`);
        if (outcome === "notJson") console.log("       not a JSON object");
      },
    },
  );
  if (!found) return undefined;
  const { url, response } = found;
  noteOrigin(origins, url, use);
  if (response.redirected) noteOrigin(origins, response.url, `${use} (redirect)`);
  return found.metadata;
}

/** Every scope the server advertises, and where each list came from. */
function describeScopes(
  resource: Json | undefined,
  serverMetadata: Json[],
  challengeScope: string | undefined,
): string {
  const parts: string[] = [];
  if (challengeScope) parts.push(`challenge "${challengeScope}"`);
  const fromResource = resource?.scopes_supported;
  if (Array.isArray(fromResource)) {
    parts.push(`resource [${fromResource.join(", ")}]`);
  }
  for (const metadata of serverMetadata) {
    const fromServer = metadata.scopes_supported;
    if (Array.isArray(fromServer)) {
      parts.push(`authorization server [${fromServer.join(", ")}]`);
    }
  }
  return parts.length > 0 ? parts.join("; ") : "none advertised";
}

/**
 * Signs in through the browser with a client registered just for this run,
 * and returns the access token. The redirect URI is a localhost one, so
 * this doesn't prove the vendor accepts a8's own redirect URI. Like a8, it
 * puts the connector's authorize parameters on the authorize URL.
 */
async function signIn(url: string, scope: string | undefined): Promise<string> {
  const provider = new ProbeOAuthProvider(
    `http://localhost:${CALLBACK_PORT}/callback`,
    connector?.authorizeParams ?? {},
  );
  const callback = waitForCallback(CALLBACK_PORT);
  // A taken port rejects before anything awaits the callback. The await
  // below still sees the rejection.
  callback.catch(() => undefined);
  await auth(provider, { serverUrl: url, scope });
  if (!provider.authorizationUrl) {
    throw new Error("auth() returned without starting a sign-in.");
  }
  console.log(`Open this URL and approve:\n${provider.authorizationUrl.href}`);
  const params = await callback;
  const error = params.get("error");
  if (error) {
    const description = params.get("error_description");
    throw new Error(
      `The vendor refused the sign-in: ${error}${description ? ` (${description})` : ""}`,
    );
  }
  const code = params.get("code");
  if (!code) throw new Error("The vendor came back without a code.");
  await auth(provider, {
    serverUrl: url,
    authorizationCode: code,
    callbackState: params.get("state") ?? undefined,
    callbackIssuer: params.get("iss") ?? undefined,
    scope,
  });
  if (!provider.savedTokens) throw new Error("auth() returned without tokens.");
  console.log(
    `Signed in. Granted scope: ${provider.savedTokens.scope ?? "not stated"}`,
  );
  return provider.savedTokens.access_token;
}

/** Serves the redirect URI once and resolves with its query parameters. */
function waitForCallback(port: number): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", `http://localhost:${port}`);
      if (url.pathname !== "/callback") {
        response.writeHead(404).end();
        return;
      }
      response
        .writeHead(200, { "Content-Type": "text/plain" })
        .end("Sign-in received. You can close this tab.");
      clearTimeout(timeout);
      server.close();
      resolve(url.searchParams);
    });
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("Nobody finished the sign-in in time."));
    }, SIGN_IN_TIMEOUT_MS);
    server.on("error", reject);
    server.listen(port);
  });
}

/** Keeps one sign-in's client, state, verifier and tokens in memory. */
class ProbeOAuthProvider implements OAuthClientProvider {
  authorizationUrl?: URL;
  savedTokens?: OAuthTokens;
  private client?: OAuthClientInformation;
  private savedState?: string;
  private savedCodeVerifier?: string;
  private savedAuthorizationServer?: OAuthAuthorizationServerInformation;

  constructor(
    readonly redirectUrl: string,
    private readonly authorizeParams: Record<string, string>,
  ) {}

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirectUrl],
      client_name: "a8 probe",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      // The same method a8 registers with.
      token_endpoint_auth_method: "client_secret_basic",
    };
  }

  clientInformation() {
    return this.client;
  }

  saveClientInformation(information: OAuthClientInformation) {
    this.client = information;
  }

  isClientInformationDynamicallyRegistered() {
    return true;
  }

  state() {
    return crypto.randomUUID();
  }

  saveState(state: string) {
    this.savedState = state;
  }

  storedState() {
    return this.savedState;
  }

  saveCodeVerifier(codeVerifier: string) {
    this.savedCodeVerifier = codeVerifier;
  }

  codeVerifier() {
    if (!this.savedCodeVerifier) throw new Error("No sign-in in progress.");
    return this.savedCodeVerifier;
  }

  saveAuthorizationServerInformation(
    information: OAuthAuthorizationServerInformation,
  ) {
    this.savedAuthorizationServer = information;
  }

  authorizationServerInformation() {
    return this.savedAuthorizationServer;
  }

  redirectToAuthorization(authorizationUrl: URL) {
    for (const [name, value] of Object.entries(this.authorizeParams)) {
      authorizationUrl.searchParams.set(name, value);
    }
    this.authorizationUrl = authorizationUrl;
  }

  tokens() {
    return this.savedTokens;
  }

  saveTokens(tokens: OAuthTokens) {
    this.savedTokens = tokens;
  }
}

/** Every tool on the server, across pages. */
async function listTools(url: string, token: string | undefined): Promise<Tool[]> {
  const client = await createMCPClient({
    transport: {
      type: "http",
      url,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    },
  });
  try {
    const tools: Tool[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools({
        params: cursor === undefined ? undefined : { cursor },
      });
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    return tools;
  } finally {
    await client.close();
  }
}

/**
 * One block per tool: its name, its annotations, and the size of its
 * description and input schema. Marks the tools the server allowlists,
 * with each one's kind, read or action.
 */
function printTools(tools: Tool[], server: ConnectorServer) {
  let totalBytes = 0;
  for (const tool of tools) {
    const schemaBytes = byteLength(JSON.stringify(tool.inputSchema));
    totalBytes += byteLength(JSON.stringify(tool));
    const kind = server.tools?.get(tool.name)?.kind;
    console.log(`${tool.name}${kind ? `  (allowlisted, ${kind})` : ""}`);
    console.log(`  annotations: ${formatAnnotations(tool.annotations)}`);
    console.log(
      `  description ${tool.description?.length ?? 0} chars, input schema ${formatBytes(schemaBytes)}`,
    );
  }
  console.log(`\n${tools.length} tools, ${formatBytes(totalBytes)} of definitions.`);
}

function formatAnnotations(annotations: Tool["annotations"]): string {
  if (!annotations) return "none";
  const entries = Object.entries(annotations).filter(
    ([, value]) => value !== undefined,
  );
  if (entries.length === 0) return "none";
  return entries
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(" ");
}

/**
 * Prints one line per check of the catalog entry against the live server,
 * and returns how many failed. The origin checks follow a8's own:
 * validateAuthorizationServerURL for the authorization server, and
 * pinnedFetch for every origin a8's server contacts.
 */
function checkCatalogEntry(connector: Connector, findings: Findings): number {
  let failures = 0;
  const report = (ok: boolean, line: string) => {
    if (!ok) failures++;
    console.log(`${ok ? "ok  " : "FAIL"}  ${line}`);
  };

  report(
    findings.registrationEndpoint !== undefined,
    `dynamic registration: the server has ${findings.registrationEndpoint ? "a" : "no"} registration endpoint`,
  );

  const pinned = new Set(
    connector.pinnedOrigins.map((url) => new URL(url).origin),
  );
  for (const server of connector.servers) {
    const mcpOrigin = new URL(server.url).origin;
    const which =
      connector.servers.length > 1 ? `${server.key}'s MCP URL` : "the MCP URL";
    report(
      pinned.has(mcpOrigin),
      `${which}'s origin, ${mcpOrigin}, ${pinned.has(mcpOrigin) ? "is" : "isn't"} pinned`,
    );
  }
  report(
    findings.authorizationServers.length > 0,
    `found metadata for ${findings.authorizationServers.length} authorization server(s)`,
  );
  for (const server of findings.authorizationServers) {
    const origin = new URL(server).origin;
    report(
      pinned.has(origin),
      `authorization server ${origin} ${pinned.has(origin) ? "is" : "isn't"} pinned`,
    );
  }
  for (const [origin, uses] of findings.origins) {
    if ([...uses].every((use) => use === BROWSER_ONLY)) continue;
    report(
      pinned.has(origin),
      `${origin} ${pinned.has(origin) ? "is" : "isn't"} pinned`,
    );
  }

  // Model names must differ across all of the connector's servers.
  const modelNames = new Map<string, string[]>();
  let allowlisted = 0;
  for (const server of connector.servers) {
    for (const name of server.tools?.keys() ?? []) {
      allowlisted++;
      const modelName = modelToolName(connector, server, name);
      modelNames.set(modelName, [...(modelNames.get(modelName) ?? []), name]);
    }
  }
  for (const [name, tools] of modelNames) {
    if (tools.length > 1) {
      report(false, `allowlisted tools ${tools.join(", ")} share the model name ${name}`);
    }
  }
  report(
    modelNames.size === allowlisted,
    `every allowlisted tool has its own model name`,
  );

  if (!findings.tools) {
    report(false, `allowlist not checked: ${findings.noToolsReason}`);
    return failures;
  }
  for (const server of connector.servers) {
    const live = new Set(
      findings.tools.get(server.key)?.map((tool) => tool.name),
    );
    const names = [...(server.tools?.keys() ?? [])];
    const missing = names.filter((name) => !live.has(name));
    const where =
      connector.servers.length > 1 ? `${server.key}'s server` : "the server";
    for (const name of missing) {
      report(false, `allowlisted tool ${name} isn't on ${where}`);
    }
    report(
      missing.length === 0,
      `${names.length - missing.length} of ${names.length} allowlisted tools are on ${where}`,
    );
  }
  const labelSource = connector.accountLabel;
  if (labelSource?.from === "tool") {
    const found = findAllowlistedTool(connector, labelSource.tool);
    report(
      found?.tool.kind === "read",
      `account label tool ${labelSource.tool} ${found?.tool.kind === "read" ? "is" : "isn't"} an allowlisted read`,
    );
    const live =
      found !== undefined &&
      (findings.tools.get(found.server.key) ?? []).some(
        (tool) => tool.name === labelSource.tool,
      );
    report(
      live,
      `account label tool ${labelSource.tool} ${live ? "is" : "isn't"} on the server`,
    );
  }
  return failures;
}

function noteOrigin(origins: Origins, url: string, use: string) {
  const origin = new URL(url).origin;
  const uses = origins.get(origin) ?? new Set();
  uses.add(use);
  origins.set(origin, uses);
}

function stringField(object: Json, field: string): string | undefined {
  const value = object[field];
  return typeof value === "string" ? value : undefined;
}

/** A metadata field across every authorization server, or "not stated". */
function formatValues(serverMetadata: Json[], field: string): string {
  const stated = serverMetadata
    .map((metadata) => metadata[field])
    .filter((value) => value !== undefined)
    .map((value) =>
      Array.isArray(value)
        ? value.join(", ")
        : typeof value === "object" && value !== null
          ? JSON.stringify(value)
          : String(value),
    );
  return stated.length > 0 ? stated.join("; ") : "not stated";
}

function printJson(value: unknown) {
  console.log(value === undefined ? "  none found" : JSON.stringify(value, null, 2));
}

function heading(text: string) {
  console.log(`\n== ${text}`);
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
