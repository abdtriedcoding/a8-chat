---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

Use /tdd where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Once done, use /code-review to review the work. The changes are uncommitted, so review the working tree against the base branch (`git diff main`, not `main...HEAD`). Run `git add -N` on new files first so they show up in the diff. Fix what the review finds.

After the review fixes, use /browser-verify to run the feature end to end in the real app and confirm the final code works. Take screenshots as proof, including one at phone width when the change touches the UI. If something fails, fix it and verify again. Skip this step only when the change has nothing to see or run in the browser, and say so.

Don't commit, stage, or push. Leave every change in the working tree so the user can review it. When they're ready, they run /pr.
