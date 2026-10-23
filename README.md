# a8

a8 is an open-source AI workspace where a person chats with a model that can act across their apps. A user writes prompts in threads and attaches images and PDFs, and the model can search the web while it replies. Connectors link a8 to apps like Notion and Linear through each vendor's own MCP server. a8 labels each catalog tool a read or an action. Reads run without asking, and every action waits for the user to approve it on an action card.

The app is Next.js in `src/` and a Convex backend in `convex/`. Sign-in uses Better Auth, replies come from the models on Vercel AI Gateway, and Resend sends the sign-up, password reset and scheduled run emails.

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
   bunx convex env set AI_GATEWAY_API_KEY <key>
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
| `AI_GATEWAY_API_KEY` | Yes | A [Vercel AI Gateway](https://vercel.com/ai-gateway) API key. Every model goes through the gateway, Claude included, for replies and thread titles. To pay Anthropic directly, add your Anthropic key to the gateway as BYOK. |
| `TAVILY_API_KEY` | No | A [Tavily](https://tavily.com) API key. Set it to turn on web search. |
| `DEEPGRAM_API_KEY` | No | A [Deepgram](https://deepgram.com) API key with the Member role or higher. Set it to turn on dictation. |
| `CONNECTION_ENCRYPTION_KEY` | Yes | A base64-encoded 32-byte key that encrypts connection tokens and OAuth client secrets. Generate one with `openssl rand -base64 32`. Don't change it once connections exist, because a8 can't rewrite stored secrets under a new key yet. See [the encryption key](docs/connectors/README.md#the-encryption-key). |
| `BETTER_AUTH_SECRET` | Yes | The secret Better Auth signs sessions with. Generate one with `openssl rand -base64 32`. |
| `JWKS` | No | Better Auth's signing key, for faster token checks. See [Static JWKS](#static-jwks). |
| `SITE_URL` | Yes | The app's URL, like `http://localhost:3000`. Better Auth uses it as its base URL and trusted origin, and a connector sign-in returns the browser to `<SITE_URL>/connectors`. |
| `TRUSTED_ORIGINS` | No | Comma-separated origins besides `SITE_URL` that may call the auth API, such as a preview or staging domain. |
| `GOOGLE_CLIENT_ID` | Yes | The client ID of a Google OAuth client, for "Sign in with Google". |
| `GOOGLE_CLIENT_SECRET` | Yes | That client's secret. Give the client the redirect URI `<SITE_URL>/api/auth/callback/google`. |
| `RESEND_API_KEY` | Yes | The [Resend](https://resend.com) API key that sends verification, password reset and scheduled run emails. |
| `EMAIL_FROM` | Yes | The sender of those emails, like `a8 <noreply@your-domain.com>`. Resend needs the domain verified. |
| `RESEND_TEST_MODE` | No | Set to `true` and Resend only delivers to its `resend.dev` test addresses. Unset or any other value sends to real addresses. |
| `BILLING_ENABLED` | No | Set to `true` on the hosted a8 to turn on the Free and Pro plans, sold through [Polar](https://polar.sh). Unset, a8 runs self-hosted, with no plans and no Billing page. When it's `true`, the deploy fails unless every `POLAR_*` variable below is set. |
| `POLAR_ORGANIZATION_TOKEN` | With billing | A Polar organization access token. See [Billing](#billing) for its scopes. |
| `POLAR_WEBHOOK_SECRET` | With billing | The secret of the Polar webhook that points at `<CONVEX_SITE_URL>/polar/events`. |
| `POLAR_SERVER` | With billing | `sandbox` or `production`, the Polar server the token belongs to. |
| `POLAR_PRO_MONTHLY_PRODUCT_ID` | With billing | The ID of the Polar product for Pro at $12 a month. |
| `POLAR_PRO_YEARLY_PRODUCT_ID` | With billing | The ID of the Polar product for Pro at $120 a year. |
| `DAILY_SPEND_CEILING_USD` | No | With billing, the most a8 spends on models across all users in a UTC day, in dollars, like `50`. Once the day's spend reaches it, a8 refuses every send until 00:00 UTC. Unset, it's $20. You can raise it as revenue grows without a deploy. |

Convex sets `CONVEX_SITE_URL` itself. A connector's OAuth redirect URI is `<CONVEX_SITE_URL>/connectors/callback`.

### Static JWKS

Without `JWKS`, Convex fetches Better Auth's public keys over HTTP each time it checks a token that arrives over HTTP, such as a server-side query from Next.js. With `JWKS` set, `convex/auth.config.ts` gives Convex the keys inline, and Better Auth signs tokens with the key from the variable instead of reading its `jwks` table. Set it once per deployment, after the functions are pushed:

```bash
bunx convex run auth:getLatestJwks | bunx convex env set JWKS
```

Add `--prod` to both commands for the production deployment. The value holds the private key, encrypted with `BETTER_AUTH_SECRET`, so treat it as a secret. If you rotate Better Auth's keys, run the command again. Until you do, Better Auth keeps signing with the key in `JWKS`. To go back to fetching the keys, run `bunx convex env remove JWKS`.

### Billing

Only the hosted a8 sets these up. In the Polar organization (use [sandbox.polar.sh](https://sandbox.polar.sh) for testing):

1. Create two recurring products: Pro at $12 a month and Pro at $120 a year. Free isn't a Polar product, since a user without a subscription is on Free.
2. Create an organization access token with the scopes `products:read`, `products:write`, `subscriptions:read`, `subscriptions:write`, `customers:read`, `customers:write`, `checkouts:read`, `checkouts:write`, `customer_portal:read`, `customer_portal:write` and `customer_sessions:write`.
3. Add a webhook to `<CONVEX_SITE_URL>/polar/events` with the events `product.created`, `product.updated`, `subscription.created` and `subscription.updated`, in the Raw format.
4. Set the `POLAR_*` variables, then `BILLING_ENABLED=true`, and deploy.

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

`scripts/worktree-setup.ts` gives each linked git worktree its own dev deployment, port and `.env.local`. It copies `.env.local` from the main checkout, and it needs `AI_GATEWAY_API_KEY`, `BETTER_AUTH_SECRET` and `CONNECTION_ENCRYPTION_KEY` set as the project's dev env defaults with `bunx convex env default set --type dev NAME value`. It sets `JWKS` on the new deployment itself.

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
