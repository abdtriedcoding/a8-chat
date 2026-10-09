---
name: pr
description: "Commit the current work, push it, and open a GitHub PR whose description walks the reviewer through the feature flow step by step (FE to BE and back) with pseudocode. Returns the PR URL. Use when the user runs /pr or asks to open a PR for the current work."
disable-model-invocation: true
---

Open a PR for the work on the current branch and reply with its URL. Running /pr is the user's go-ahead to commit and push, so don't ask.

Apply /unslop to the commit message and the PR description.

## 1. Branch and commit

1. Run `git status` and `git branch --show-current`.
2. If the branch is `main`, create a branch first. Name it `<type>/<short-slug>`, for example `feat/disconnect-notion` or `fix/stream-retry`.
3. If there are uncommitted changes, stage them and commit. Use the repo's conventional style, `<type>(<scope>): <summary>`, for example `feat(connectors): disconnect Notion from the toggle`. End the message with the attribution line from the system reminder.
4. If there's nothing to commit and no commits ahead of `main`, stop and tell the user there's nothing to open a PR for.

## 2. Check the build

Run `bun run typecheck` and `bun run lint`. If either fails, fix the errors, commit the fix, and note it in the reply. If you can't fix a failure, stop and report it. Don't open a PR that fails typecheck.

## 3. Find the issue

Look for the originating issue in this order: an issue number the user passed, `#123` references in the branch's commit messages, the branch name. Read it with `gh issue view <n> --comments`. If it has a parent issue, note that too. If there's no issue, skip the `Closes` line.

## 4. Learn the flow from the code

Read the full diff with `git diff main...HEAD`, then read the touched files in full where the diff alone doesn't show what calls what. Trace the feature in execution order, starting from what the user does in the UI:

- the component and handler that react to the user's action, and any local state they set
- the Convex function or route the frontend calls, and the exact arguments it sends
- each backend step: auth checks, validation, internal queries and mutations, actions, external API calls, scheduled functions, database reads and writes with their indexes
- what the backend returns or throws, and in which cases
- how the frontend handles each outcome: toasts, state resets, reactive query updates, navigation

Document only what the code does. If you're unsure whether something happens, read more code until you are. Don't describe planned behavior, behavior from the issue that wasn't built, or anything you assumed. Put things the issue asked for that this PR doesn't do under "Not in this PR".

If the change has no frontend part (a backend-only fix, a refactor, docs), start the flow at whatever triggers it, such as a cron, a webhook, or another function, and drop the steps that don't apply. Don't invent a UI step.

## 5. Write the description

Follow this structure. PR #66 (`gh pr view 66`) is a good example of the level of detail.

```markdown
Closes #<issue>. Part of #<parent>.

<One short paragraph: what the user can now do, and the main behavior or tradeoff a reviewer should know.>

## How the flow works

### 1. User action (FE)
<What the user does, on which page, in which component (with file path). Local state the handler sets and why.>

### 2. API call (FE → BE)
<Which endpoint or Convex function the frontend calls (`api.x.y`), and the exact data it sends. What the server takes from the session instead.>

### 3. Backend processing (BE)
<Numbered steps in execution order. Name each function and its file. Cover auth, validation, database reads and writes, external calls, integrations, retries, timeouts, and race handling. Nest sub-steps where one function calls several others.>

### 4. Response (BE → FE)
<What the backend returns for each case, and when it throws.>

### 5. Result (FE)
<What the user sees for each outcome: success, partial failure, error. How state resets and how reactive queries update the UI.>

## Pseudocode

<High-level pseudocode in a fenced block, grouped by file with a `// FE: file` or `// BE: file` comment. Use the real function names and show the logical steps, branches, and error handling. Leave out types, imports, and implementation details.>

## Not in this PR

<Things a reviewer might expect that aren't built, and known gaps. Omit the section if there are none.>

## Testing

<What was actually run: typecheck, lint, browser checks. What wasn't exercised. The repo has no automated test suite, so say so if no tests were added.>
```

Add more numbered steps when the flow has them, for example a second round trip, an OAuth redirect, or a scheduled job. Keep the FE/BE label on each step heading.

If this session took screenshots with /browser-verify, attach them with `--attach` on `gh pr create` and reference them in the Testing section. Don't ask the user to drag them in.

End the description with the attribution line from the system reminder.

## 6. Push and open the PR

1. `git push -u origin <branch>`.
2. Write the description to a file in the scratchpad directory and run `gh pr create --base main --title "<commit-style title>" --body-file <file>`.
3. If a PR already exists for the branch, update its body with `gh pr edit --body-file <file>` instead.

Reply with the PR URL and one line on anything that needs the user's attention, such as a fixed lint error or a gap listed under "Not in this PR".
