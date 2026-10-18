# Setting up Google

a8 reaches Google Calendar, Gmail, Google Drive, Google Docs and Google Sheets through Google's own MCP servers (ADR 0007). Google Drive uses four of them, for Drive, Docs, Sheets and Slides, under one sign-in. Google Docs uses two, Drive and Docs, and Google Sheets uses Drive and Sheets. Google has no dynamic registration, so each deployment signs in through an OAuth client from its own Google Cloud project. All five connectors share that client. Until the deployment has its ID and secret, the Google cards on the Connectors page say "Not set up" and have no toggle.

Google's MCP servers are in the Google Workspace Developer Preview. Pre-GA terms bar users outside the deployer's Google Workspace organization, so this guide sets up an Internal consent screen, and only accounts in that organization can connect.

## 1. Enroll in the Developer Preview

Enroll the Google Cloud project in the [Google Workspace Developer Preview Program](https://developers.google.com/workspace/preview). Approval can take a couple of days. The MCP APIs below don't turn on until it's approved.

## 2. Turn on the APIs

In the project, turn on each app's API and its MCP API. For Google Calendar and Gmail:

```bash
gcloud services enable calendar-json.googleapis.com calendarmcp.googleapis.com gmail.googleapis.com gmailmcp.googleapis.com --project=<project-id>
```

For Google Drive:

```bash
gcloud services enable drive.googleapis.com drivemcp.googleapis.com docs.googleapis.com docsmcp.googleapis.com sheets.googleapis.com sheetsmcp.googleapis.com slides.googleapis.com slidesmcp.googleapis.com --project=<project-id>
```

For Google Docs alone:

```bash
gcloud services enable drive.googleapis.com drivemcp.googleapis.com docs.googleapis.com docsmcp.googleapis.com --project=<project-id>
```

For Google Sheets alone:

```bash
gcloud services enable drive.googleapis.com drivemcp.googleapis.com sheets.googleapis.com sheetsmcp.googleapis.com --project=<project-id>
```

## 3. Set up the consent screen

In Google Auth Platform:

1. Under Branding, set the app name to a8 and add a support email.
2. Under Audience, pick Internal.
3. Under Data Access, add the scopes of each connector you turn on. Google Calendar:
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`

   Gmail:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.compose`

   Google Drive:
   - `https://www.googleapis.com/auth/drive.readonly`
   - `https://www.googleapis.com/auth/drive.file`
   - `https://www.googleapis.com/auth/documents`
   - `https://www.googleapis.com/auth/spreadsheets`
   - `https://www.googleapis.com/auth/presentations`

   Google Docs:
   - `https://www.googleapis.com/auth/drive.readonly`
   - `https://www.googleapis.com/auth/drive.file`
   - `https://www.googleapis.com/auth/documents`

   Google Sheets:
   - `https://www.googleapis.com/auth/drive.readonly`
   - `https://www.googleapis.com/auth/drive.file`
   - `https://www.googleapis.com/auth/spreadsheets`

Each connector asks for exactly its own scopes. A user can untick any of them on the consent screen. a8 then loads only the tools whose scope was granted, and the card says "Some permissions missing" with a Reconnect button. The reads of Google Drive, Google Docs and Google Sheets all need only `drive.readonly`, so unticking an editing scope, like `documents`, keeps every read and drops that app's edits.

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

Add `--prod` for the production deployment. These are separate from `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, which sign users in to a8 itself. Reload the Connectors page and the Google cards get their toggles.

## What a8 does with it

- Every connect and reconnect sends `access_type=offline` and `prompt=consent`, so Google returns a refresh token each time. Without one, a connection would stop working after an hour.
- The connection stores the scopes Google granted, read from the token response.
- Disconnecting revokes the refresh token at `https://oauth2.googleapis.com/revoke`.
- Gmail's server has no send tool. a8 writes a draft, and the user sends it from Gmail. No Gmail tool returns the account's address, so the Gmail card takes it from the sender of the account's newest draft. Until the account has a draft, the card shows no account.
- No Drive tool returns the account's address either, so the Google Drive, Google Docs and Google Sheets cards take it from the owner of a file the account owns. An account that owns no files shows no account.
- Google Docs' server only reads and edits a doc by its ID. The Google Docs connector finds docs with Drive's `search_files` and `list_recent_files`, and creates or copies one with Drive's `create_file` and `copy_file`. Google Sheets' server is the same, and the Google Sheets connector uses the same four Drive tools.

## Screening tool results

Google's MCP documentation warns about indirect prompt injection, where an event's description, an email or a file's text carries instructions for the model, and asks clients to screen what goes to and from the server. a8 wraps every connector tool result in an `<untrusted-data>` tag before the model sees it, and its system prompt tells the model never to follow instructions inside that tag (`convex/lib/connectorTools.ts`, `convex/lib/instructions.ts`). Every tool that changes the calendar or a file, like deleting an event or editing a Doc, waits for the user to approve its action card. So does Gmail's draft tool.
