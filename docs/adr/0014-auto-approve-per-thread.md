# A thread can auto-approve its actions, with a cap per reply and never in scheduled runs

ADRs 0002, 0008 and 0013 hold one rule: an action runs only after the user approves that call. Users who chain several actions in one chat find a card for every call tiring, so a thread can now turn on auto-approve. Its actions then run without a card, and catalog actions, custom connector tools and scheduled prompt tools all count. This gives up the per-call guard against prompt injection in that thread, and only the user can make that trade, one thread at a time. A fetched email or page can still tell the model to send something, and with auto-approve on nothing stops that call. So the setting is off for every new thread, and the first time a user turns it on, a dialog explains that risk. That account doesn't see the dialog again.

## Considered options

- **An account-wide setting:** one switch, but it would also cover threads the user opened for a different, riskier task and forgot about.
- **Auto-approve only catalog actions:** custom connector tools and scheduled prompt tools would still ask, and "nothing asks" would stop being true. Users couldn't predict which calls get a card.
- **Approve cards already waiting when the setting turns on:** turning on a setting would quietly decide a card the user hasn't read.
- **No cap:** a looping or injected model could run dozens of actions before the user looks.

## Consequences

- Scheduled prompt threads never offer the setting, so ADR 0013 stands: a run nobody watches always stops on its card.
- After five actions run without a card in one reply, every later action in that reply shows a card. Approving one of those cards doesn't reset the count.
- The server reads the setting when a reply or continuing reply starts. A change mid-reply counts from the next one, and cards already waiting still need a decision.
- Each action that runs without a card leaves a record in the reply, so the user can see what ran.
- While the setting is on, the model's instructions say its actions run at once. They tell it to take only the actions the user asked for, and never one because fetched content said to.
- The model has no tool to change the setting.
