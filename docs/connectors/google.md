# Setting up Google

a8 reaches Google Calendar and Gmail through Google's own MCP servers (ADR 0007). Google has no dynamic registration, so each deployment signs in through an OAuth client from its own Google Cloud project. Both connectors share that client. Until the deployment has its ID and secret, the Google Calendar and Gmail cards on the Connectors page say "Not set up" and have no toggle.

Google's MCP servers are in the Google Workspace Developer Preview. Pre-GA terms bar users outside the deployer's Google Workspace organization, so this guide sets up an Internal consent screen, and only accounts in that organization can connect.

## 1. Enroll in the Developer Preview

Enroll the Google Cloud project in the [Google Workspace Developer Preview Program](https://developers.google.com/workspace/preview). Approval can take a couple of days. The MCP APIs below don't turn on until it's approved.

## 2. Turn on the APIs

In the project, turn on the Google Calendar and Gmail APIs and their MCP APIs:

```bash
gcloud services enable calendar-json.googleapis.com calendarmcp.googleapis.com gmail.googleapis.com gmailmcp.googleapis.com --project=<project-id>
```

## 3. Set up the consent screen

In Google Auth Platform:

1. Under Branding, set the app name to a8 and add a support email.
2. Under Audience, pick Internal.
3. Under Data Access, add these scopes:
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.compose`

Google Calendar asks for the two calendar scopes and Gmail for the two Gmail ones. A user can untick any of them on the consent screen. a8 then loads only the tools whose scope was granted, and the card says "Some permissions missing" with a Reconnect button.

## 4. Create the OAuth client

Under Clients, create an OAuth client:

1. Pick Web application as the type.
2. Tick "Use this client for an AI-powered agent". Google's MCP servers refuse tokens from a client without it, and the setting can't be turned on later, so a client made without it has to be replaced.
3. Add the deployment's redirect URI under Authorized redirect URIs. It's the deployment's site URL followed by `/connectors/callback`, like `https://<deployment>.convex.site/connectors/callback`. In a checkout, the site URL is `NEXT_PUBLIC_CONVEX_SITE_URL` in `.env.local`. Each Convex deployment, like dev, prod or a worktree's, has its own URL, and each one a8 runs on needs its URI listed.

Copy the client ID and secret.

## 5. Give the deployment the client

```bash
npx convex env set GOOGLE_MCP_CLIENT_ID <client id>
npx convex env set GOOGLE_MCP_CLIENT_SECRET <client secret>
```

Add `--prod` for the production deployment. These are separate from `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, which sign users in to a8 itself. Reload the Connectors page and the Google Calendar and Gmail cards get their toggles.

## What a8 does with it

- Every connect and reconnect sends `access_type=offline` and `prompt=consent`, so Google returns a refresh token each time. Without one, a connection would stop working after an hour.
- The connection stores the scopes Google granted, read from the token response.
- Disconnecting revokes the refresh token at `https://oauth2.googleapis.com/revoke`.
- Gmail's server has no send tool. a8 writes a draft, and the user sends it from Gmail. No Gmail tool returns the account's address, so the Gmail card takes it from the sender of the account's newest draft. Until the account has a draft, the card shows no account.

## Screening tool results

Google's MCP documentation warns about indirect prompt injection, where an event's description or an email carries instructions for the model, and asks clients to screen what goes to and from the server. a8 wraps every connector tool result in an `<untrusted-data>` tag before the model sees it, and its system prompt tells the model never to follow instructions inside that tag (`convex/lib/connectorTools.ts`, `convex/lib/instructions.ts`). Every tool that changes the calendar, like creating or deleting an event, waits for the user to approve its action card. So does Gmail's draft tool.
