---
name: pr
description: "Commit the current work, push it, and open a GitHub PR whose description walks the reviewer through the feature flow step by step (FE to BE and back) with pseudocode. Then babysit the PR: fix CodeRabbit comments that matter, wait for approval, merge, delete the worktree's Convex dev deployment. Use when the user runs /pr or asks to open a PR for the current work."
disable-model-invocation: true
---

Open a PR for the work on the current branch, babysit it through CodeRabbit review, merge it, and clean up. Running /pr is the user's go-ahead to commit, push, fix review comments, and merge, so don't ask.

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

Don't reply yet. Babysit the PR first.

## 7. Babysit until CodeRabbit approves, then merge

CodeRabbit reports as a check named `CodeRabbit`. It's done when that check stops being `pending`. Wait for it with this loop in the background (`run_in_background`). It uses `gh`'s own `--jq`, because Git Bash on this machine has no `jq`, and a loop that pipes to `jq` fails on every pass and never exits. It also exits after 20 minutes, so a stuck check can't keep you waiting forever:

```bash
for i in $(seq 1 40); do
  s=$(gh pr checks <n> --json name,bucket --jq '.[] | "\(.name)=\(.bucket)"' 2>&1)
  echo "$s" | grep -q '^CodeRabbit=' && ! echo "$s" | grep -q '^CodeRabbit=pending' && { echo "$s"; exit 0; }
  sleep 30
done; echo "TIMEOUT"; echo "$s"
```

When it exits, read the review with `gh pr view <n> --comments` and `gh api repos/abdtriedcoding/a8-chat/pulls/<n>/comments`. On `TIMEOUT`, check those by hand before waiting again. If the user says CodeRabbit already answered, stop the wait and read the comments.

1. Read each CodeRabbit comment. Fix the ones that point at a real bug, a missed requirement, or a standards violation. Skip nitpicks, style taste, and suggestions that contradict the issue or `GLOSSARY.md`. Reply on the thread with one line saying why you skipped.
2. After fixes, rerun `bun run typecheck` and `bun run lint`, commit, push, and poll again. CodeRabbit re-reviews each push.
3. Repeat until CodeRabbit approves (or reports no actionable comments) and every other check passes.
4. If CodeRabbit says the free OSS reviews ran out, don't wait. Merge once the other checks pass.
5. Merge with `gh pr merge <n> --merge`. Never pass `--delete-branch`; keep the local and remote branch.
6. Stop and ask only if a comment needs a product decision, or checks keep failing after two fix attempts.

## 8. Clean up

1. In a linked worktree, run `bun scripts/worktree-teardown.ts`. It deletes this worktree's Convex dev deployment, and it refuses anything that isn't a non-default dev deployment. Do this only after the merge, since the deployment holds the browser-verify data. In the main checkout it does nothing. If you skip it, the deployment still expires 5 days after creation.
2. Update `main`. In the main checkout run `git switch main && git pull --ff-only`. In a linked worktree `main` is checked out elsewhere, so run `git -C <main checkout> pull --ff-only` instead.

Reply with the PR URL, the merge result, and one line on anything that needs the user's attention, such as a fixed lint error, a skipped CodeRabbit comment, or a gap listed under "Not in this PR".
