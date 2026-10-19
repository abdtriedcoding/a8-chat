# Scheduled runs wait for approval like any other reply, with no actions approved ahead of time

A scheduled run often happens while nobody is watching, and a scheduled prompt like "every Friday, summarize the sales channel and email it to me" (Product_Spec.md) ends in an action. We still keep the one rule from ADR 0002 and ADR 0008: an action runs only after the user approves that call. The run stops on its action card, and the card waits in the thread until the user decides. Approving actions ahead of time when the scheduled prompt is made would turn every run into an unwatched prompt injection path. The run reads email, Slack or web pages, and any of them can tell the model to send something somewhere else.

Creating, changing or deleting a scheduled prompt through the model is an action too, for the same reason: a fetched page shouldn't be able to set up runs that spend the user's sends.

## Considered options

- **Reads only in scheduled runs:** safe, but a run could never finish the spec's own example.
- **Approve actions when the scheduled prompt is made:** what automation tools do. It gives up the per-call guarantee for exactly the replies nobody watches.

## Consequences

- A scheduled prompt whose job is an action needs the user to open the thread each run. The email for a run says a card is waiting.
- A scheduled run joins the queue instead of cancelling a waiting card, unlike a prompt the user sends. Otherwise each run would cancel the last run's action before the user saw it.
- At most one run waits per scheduled prompt, and runs that come due meanwhile are skipped, so an absent user doesn't come back to a pile of runs.
- `@convex-dev/crons` can't see a run that waits days on a card, and it has no pause or one-off schedule. So scheduled prompts keep only their next run in `ctx.scheduler.runAt`, with the next time computed in their own time zone, instead of using the component the product spec named.
