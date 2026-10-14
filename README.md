# a8

a8 is an open-source AI workspace where a person chats with a model that can act across their apps. A user writes prompts in threads and attaches images and PDFs, and the model can search the web while it replies. Connectors link a8 to apps like Notion and Linear through each vendor's own MCP server. a8 labels each catalog tool a read or an action. Reads run without asking, and every action waits for the user to approve it on an action card.

The app is Next.js in `src/` and a Convex backend in `convex/`. Sign-in uses Better Auth, replies come from Anthropic's models, and Resend sends the sign-up and password reset emails.

## Running a8

You need [Bun](https://bun.sh) and a [Convex](https://convex.dev) account.

1. Install the dependencies:

   ```bash
   bun install
   ```

2. Create a Convex dev deployment:

   ```bash
   bun run dev:convex
   ```

   The first run asks you to log in to Convex, creates a project and a dev deployment, and writes `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL` and `NEXT_PUBLIC_CONVEX_SITE_URL` to `.env.local`. Stop it once the deployment exists, and set the Convex variables before you start it again.

3. Set each required Convex variable from the table below on the deployment. For the Google variables, create an OAuth client of type "Web application" in the Google Cloud console, with the redirect URI `http://localhost:3000/api/auth/callback/google`.

   ```bash
   bunx convex env set SITE_URL http://localhost:3000
   bunx convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
   bunx convex env set CONNECTION_ENCRYPTION_KEY "$(openssl rand -base64 32)"
   bunx convex env set ANTHROPIC_API_KEY <key>
   bunx convex env set GOOGLE_CLIENT_ID <client id>
   bunx convex env set GOOGLE_CLIENT_SECRET <client secret>
   bunx convex env set RESEND_API_KEY <key>
   bunx convex env set EMAIL_FROM "a8 <noreply@your-domain.com>"
   ```

4. Add the Next.js variable to `.env.local`:

   ```bash
   NEXT_PUBLIC_SITE_URL=http://localhost:3000
   ```

5. Start the backend and the app, each in its own terminal:

   ```bash
   bun run dev:convex
   bun run dev
   ```

6. Open http://localhost:3000 and sign up. a8 sends a verification email before the first sign-in, so `EMAIL_FROM` needs a domain you verified in Resend. Google sign-in skips the email.

## Environment variables

### Convex deployment

Set these with `bunx convex env set NAME value`, or on the deployment's settings page in the Convex dashboard. `convex/convex.config.ts` declares them, and the backend reads them from there.

| Variable | Required | What it's for |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Yes | The Anthropic API key for replies and thread titles. |
| `TAVILY_API_KEY` | No | A [Tavily](https://tavily.com) API key. Set it to turn on web search. |
| `CONNECTION_ENCRYPTION_KEY` | Yes | A base64-encoded 32-byte key that encrypts connection tokens and OAuth client secrets. Generate one with `openssl rand -base64 32`. Don't change it once connections exist, because a8 can't rewrite stored secrets under a new key yet. See [the encryption key](docs/connectors/README.md#the-encryption-key). |
| `BETTER_AUTH_SECRET` | Yes | The secret Better Auth signs sessions with. Generate one with `openssl rand -base64 32`. |
| `SITE_URL` | Yes | The app's URL, like `http://localhost:3000`. Better Auth uses it as its base URL and trusted origin, and a connector sign-in returns the browser to `<SITE_URL>/connectors`. |
| `TRUSTED_ORIGINS` | No | Comma-separated origins besides `SITE_URL` that may call the auth API, such as a preview or staging domain. |
| `GOOGLE_CLIENT_ID` | Yes | The client ID of a Google OAuth client, for "Sign in with Google". |
| `GOOGLE_CLIENT_SECRET` | Yes | That client's secret. Give the client the redirect URI `<SITE_URL>/api/auth/callback/google`. |
| `RESEND_API_KEY` | Yes | The [Resend](https://resend.com) API key that sends verification and password reset emails. |
| `EMAIL_FROM` | Yes | The sender of those emails, like `a8 <noreply@your-domain.com>`. Resend needs the domain verified. |
| `RESEND_TEST_MODE` | No | Set to `true` and Resend only delivers to its `resend.dev` test addresses. Unset or any other value sends to real addresses. |

Convex sets `CONVEX_SITE_URL` itself. A connector's OAuth redirect URI is `<CONVEX_SITE_URL>/connectors/callback`.

### Next.js (`.env.local`)

| Variable | Set by | What it's for |
| --- | --- | --- |
| `CONVEX_DEPLOYMENT` | `convex dev` | The dev deployment the Convex CLI pushes to. |
| `NEXT_PUBLIC_CONVEX_URL` | `convex dev` | The deployment's URL, for the Convex client. |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | `convex dev` | The deployment's HTTP actions URL. The `/api/auth` route sends auth requests there. |
| `NEXT_PUBLIC_SITE_URL` | You | The app's URL, the same as `SITE_URL`. The Better Auth client calls it. |
| `PORT` | You, optional | The port `bun run dev` serves on. Defaults to 3000. If you change it, change both site URLs to match. |

### Dev scripts

| Variable | Read by | What it's for |
| --- | --- | --- |
| `MCP_TOKEN` | `bun run probe` | An access token for the vendor's MCP server, so the probe can list its tools. |
| `E2E_EMAIL`, `E2E_PASSWORD_HASH` | `scripts/worktree-setup.ts` | A test login that the setup script creates in each git worktree's dev deployment, so browser checks can sign in. Optional. |

`scripts/worktree-setup.ts` gives each linked git worktree its own dev deployment, port and `.env.local`. It copies `.env.local` from the main checkout, and it needs `ANTHROPIC_API_KEY`, `BETTER_AUTH_SECRET` and `CONNECTION_ENCRYPTION_KEY` set as the project's dev env defaults with `bunx convex env default set --type dev NAME value`.

## Scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | Runs `next dev` on `PORT`. |
| `bun run dev:convex` | Runs `convex dev`, which pushes `convex/` to the dev deployment on every change. |
| `bun run build` | Builds the Next.js app. |
| `bun run start` | Serves the built app. |
| `bun run lint` | Runs ESLint. |
| `bun run typecheck` | Typechecks `src/` and `convex/`. |
| `bun run probe <mcp-url or connector-id>` | Asks a vendor's MCP server what a catalog entry needs. See [the probe](docs/connectors/README.md#the-probe). |

## Docs

- [`GLOSSARY.md`](GLOSSARY.md): the words a8 uses for threads, replies, connectors and connections.
- [`convex/README.md`](convex/README.md): what each backend module holds, and the auth and error rules.
- [`docs/connectors/README.md`](docs/connectors/README.md): how connectors work, and the steps to add one.
- [`docs/adr/`](docs/adr/): the decisions behind the design.
