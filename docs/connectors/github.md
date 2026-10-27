# Setting up GitHub

a8 reaches GitHub through GitHub's own MCP server, `https://api.githubcopilot.com/mcp/` (ADR 0003). GitHub has no dynamic registration, so each deployment signs in through a GitHub App it registers itself. Until the deployment has the app's client ID, secret and slug, the GitHub card on the Connectors page says "Not set up" and has no toggle.

A GitHub App's user token only reaches the accounts and organizations where the user installed the app, and only the repositories they picked there. Connecting signs the user in. Installing is a second step on GitHub, and the card offers it after connecting.

## 1. Create the GitHub App

Open [New GitHub App](https://github.com/settings/apps/new) under your account, or under an organization's settings to have the organization own it.

1. GitHub App name: any name no other app has, like `a8-yourname`. The slug in the app's URL, `github.com/apps/<slug>`, comes from it.
2. Homepage URL: the deployment's `SITE_URL`.
3. Callback URL: the deployment's site URL followed by `/connectors/callback`, like `https://<deployment>.convex.site/connectors/callback`. In a checkout, the site URL is `NEXT_PUBLIC_CONVEX_SITE_URL` in `.env.local`. Each Convex deployment, like dev, prod or a worktree's, has its own URL. Add each one a8 runs on with "Add Callback URL", up to 10.
4. Keep "Expire user authorization tokens" ticked. GitHub then gives a refresh token, and a8 refreshes the 8-hour access token itself.
5. Leave "Request user authorization (OAuth) during installation" unticked. a8 signs in on its own, and an install that signs in too comes back to the callback without the sign-in a8 started.
6. Setup URL: the deployment's `SITE_URL` followed by `/connectors`, like `https://a8.example.com/connectors`. Tick "Redirect on update". After an install, or a change to the picked repositories, GitHub sends the user back there, and a8 checks the install again.
7. Webhook: untick Active. a8 uses no webhooks.
8. Permissions, under Repository permissions:
   - Contents: Read-only
   - Issues: Read and write
   - Pull requests: Read-only
   - Metadata: Read-only (GitHub sets this one)
9. Where can this GitHub App be installed: Any account, so users can install it on their own accounts and organizations.

Create the app.

## 2. Generate a client secret

On the app's General page, copy the Client ID. It starts with `Iv`, and it isn't the App ID. Under Client secrets, generate a new secret and copy it.

## 3. Give the deployment the app

```bash
npx convex env set GITHUB_APP_CLIENT_ID <client id>
npx convex env set GITHUB_APP_CLIENT_SECRET <client secret>
npx convex env set GITHUB_APP_SLUG <slug>
```

Add `--prod` for the production deployment. Reload the Connectors page and the GitHub card gets its toggle.

## What a8 does with it

- Connecting sends the user to GitHub's consent screen, and the connection stores the user token, encrypted. GitHub skips the consent screen for a GitHub account that authorized the app before, so a browser signed in to someone else's GitHub connects theirs in one click. a8 reads the account's login and avatar from `https://api.github.com/user` before the sign-in finishes. The toast names the login and offers "Not you?", which disconnects, and the card shows both.
- After connecting, with each tool list refresh, and each time the Connectors page opens, a8 asks `https://api.github.com/user/installations` which installations of the app the user can reach. With none, the card says "App not installed" and offers an Install button. When no installation reaches a repository, it says "No repositories" and links to GitHub to pick some. GitHub sends no redirect when the user uninstalls the app, so a tool call that GitHub answers with a 403 or 404 also makes a8 check again, at most once every 10 minutes.
- A token refresh sends the client ID and secret in the form, as GitHub documents.
- GitHub has no RFC 7009 revocation endpoint. Disconnecting and deleting the a8 account call `DELETE https://api.github.com/applications/{client_id}/grant` with the client ID and secret as HTTP Basic. That ends every token of the grant and takes a8 off the user's authorized GitHub Apps. The call needs a live access token, so a8 refreshes an expired one first. A reconnect to another GitHub account deletes the old account's grant the same way. A reconnect to the same account shares its grant with the new connection, so a8 deletes only the old token, with `DELETE /applications/{client_id}/token`.
- Reading files, issues and pull requests runs without asking. Opening or changing an issue and commenting wait for the user to approve their action cards.
