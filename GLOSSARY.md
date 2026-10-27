# a8

An open-source AI workspace where a person chats with a model that can act across their apps. This glossary covers the chat and the apps it works in.

## Language

### Chat

**Thread**:
One ongoing exchange between a user and the assistant, with its own title and history. UI copy calls it a "chat"; everywhere else it's a thread.
_Avoid_: conversation, chat (outside UI copy)

**Archived thread**:
A thread the user moved out of the sidebar without deleting it. It keeps its messages and still shows in search, and a send moves it back to the sidebar. Deleting a thread, archived or not, removes it for good. Archiving a pinned thread unpins it.
_Avoid_: hidden thread, soft-deleted thread

**Pinned thread**:
A thread the user keeps at the top of the sidebar, above their other threads. The most recently pinned comes first.
_Avoid_: starred thread, favorite

**Temporary thread**:
A thread kept out of the user's history. It never shows in the sidebar, search or archive, and can't be shared, pinned, archived or renamed. It's deleted when the user opens another thread, starts a new chat or signs out, even mid-reply, or after a day with no new message. A reload keeps it. The user picks it before the first send, and a thread can't switch between temporary and regular. Actions it takes in apps stay done. UI copy says "temporary chat".
_Avoid_: incognito thread, ephemeral thread, private chat

**Shared snapshot**:
A read-only copy of a thread's finished turns that anyone with its link can open, signed in or not. It shows prompts, attachments, replies and web searches, but only the names of connector and scheduled prompt tool calls and action cards. A thread has at most one: sharing again updates it to the thread's latest finished turns. Unsharing or deleting the thread removes it, and archiving doesn't. UI copy says "shared link".
_Avoid_: shared thread, public chat, share link (outside UI copy)

**Prompt**:
A message the user writes to the assistant, with any attachments sent alongside it.
_Avoid_: query, user message

**Reply**:
The assistant's full answer to one prompt, including every step it took on the way, such as web searches. A reply can be stopped, and the last one can be regenerated.
_Avoid_: response, completion, answer

**Stopped reply**:
A reply the user stopped before it finished. It keeps whatever text it had so far, and the model sees that text on the next prompt.
_Avoid_: cancelled reply, aborted reply

**Continuing reply**:
A reply that picks up again once the user has approved or cancelled every action card in it. It's the same reply, so it isn't a send.
_Avoid_: continuation, resumed reply

**Queued prompt**:
A prompt the user sent while a reply was still running, or a scheduled run that couldn't start right away, waiting in line to start its own turn. Queued prompts start oldest first, each once the thread is free. The model doesn't see one until it starts.
_Avoid_: pending message, queued message, draft

**Queue**:
A thread's queued prompts, oldest first. It holds while an action card waits, and goes on by itself once every card is decided.
_Avoid_: backlog, outbox

**Paused queue**:
A queue that waits for the user to resume it, after a Stop or a failed reply. A send while the queue is paused skips ahead of it.
_Avoid_: stopped queue, held queue

**Scheduled prompt**:
A prompt the user sets to send itself later, once at a set time or again and again on a repeating schedule. It gets a thread of its own when it's made, and every run goes there. Deleting that thread deletes the scheduled prompt; archiving it doesn't, and the next run moves it back to the sidebar. Times follow the wall clock in the scheduled prompt's time zone. It can't be made from a temporary thread, and it holds text only, no attachments. UI copy says "scheduled task".
_Avoid_: task (on its own), reminder, job, cron, automation

**Paused scheduled prompt**:
A scheduled prompt that won't run until the user resumes it. The user can pause one, and it pauses itself after three failed runs in a row.
_Avoid_: disabled task, stopped schedule

**Scheduled run**:
One time a scheduled prompt sends itself. It counts as a send. It never cancels a card. It joins the queue as a queued prompt while a reply is running or an action card is waiting. It also joins when the queue has prompts or is paused. A queued run still counts as a run when it starts. Its reply waits for the user's decision on any action card like any other reply. The model sees earlier runs in the thread. A run moves an archived thread back to the sidebar. "Run now" starts one by hand, and is never skipped.
_Avoid_: execution, occurrence, trigger

**Skipped run**:
A scheduled run that never happens because the scheduled prompt's last run hasn't finished. That run is still in the queue, still replying, or has an action card waiting. The scheduled prompt records it as its last run. A scheduled prompt has at most one run waiting.
_Avoid_: missed run, dropped run

**Turn**:
One prompt together with its reply.
_Avoid_: exchange, round

**Attachment**:
A file (an image or a PDF) sent with a prompt.
_Avoid_: upload, file

**Dictation**:
Speaking a prompt into the composer instead of typing it. The words land in the draft as the user speaks, and the user edits and sends the prompt as if they'd typed it. Dictation never sends anything by itself, and a8 keeps no audio. Not to be confused with a voice mode, where the assistant talks back.
_Avoid_: voice input, speech-to-text (in UI copy), transcription, voice mode

**Send**:
Any user action that asks the model for a new reply: a new prompt, an edited prompt, or a regenerated reply. The send rate limits count sends, and count a queued prompt when it's queued. Web searches and connector tool calls have limits of their own.
_Avoid_: request, message (as a unit of usage)

### Apps

**App**:
A third-party product a person already uses, like Gmail or Notion.
_Avoid_: integration, service, tool (for the product)

**Catalog**:
The connectors a8 ships with, the same for every user. Each entry names the tools a8 offers from its app and labels each one a read or an action.
_Avoid_: registry, connector list

**Connector**:
One app a8 can work in, with a name, a handle, a logo and the tools a8 offers from it. A connector is either in the catalog or a custom connector. UI copy says "connector".
_Avoid_: plugin, integration, connected app, MCP server (for the connector)

**Custom connector**:
A connector a user adds themselves from an MCP server's URL, seen only by that user. It has a handle and a connection like any other connector, but a8 can't label its tools, so every call to one of them asks for approval unless the thread has auto-approve on.
_Avoid_: custom MCP, custom server, my connector

**App installation**:
Where a user installed the deployment's own vendor app, like a8's GitHub App on their GitHub account or organization. A GitHub connection only reaches the repositories its installations reach, so connecting signs in and installing is a second step on GitHub. "App" here is the vendor's word for what the deployer registered, not an app in the sense above.
_Avoid_: install (for the connection)

**Connection**:
One user's link to a connector. The user signed in to the app, or turned the connector on if its app needs no sign-in, like Excalidraw. A user has at most one connection per connector.
_Avoid_: account, link, install

**OAuth client registration**:
The OAuth client a8 registered with a connector's authorization server. A deployment has one per connector, and every user's connection signs in through it. Not to be confused with an MCP client.
_Avoid_: connector client, OAuth app, client (on its own)

**Pre-registered client**:
An OAuth client the deployer registered with a vendor by hand, for a vendor with no dynamic registration, like Google's OAuth client or GitHub's GitHub App. Its ID and secret come from the deployment's env vars, and a8 stores no OAuth client registration for it. Without them, the connector is not set up.
_Avoid_: static client, manual client

**MCP client**:
a8's open session with one of a connector's MCP servers, used to list or call its tools. A reply opens one for each server it calls and closes them when it ends. Not to be confused with an OAuth client registration.
_Avoid_: server client, connection (for the session), client (on its own)

**Tool list**:
The tools a8 keeps for one connection: the ones it offers from the connector, as its MCP servers last listed them. A reply builds its tools from it without asking the app.
_Avoid_: tool cache, manifest

**Handle**:
The word typed after @ to pick a connector, like `notion`.
_Avoid_: slug, tag

**Mention**:
A connector's handle typed after @ in a prompt. It tells the model to use that connector, though the model can use any connection without one.
_Avoid_: tag, active app

**Read**:
A tool call that only fetches from an app, like searching email, and that the catalog labels a read. Runs without asking. Calls to a custom connector's tools always ask, even when they only fetch.
_Avoid_: query, lookup

**Action**:
A tool call that writes to or deletes from an app, like sending an email, or that creates, changes or deletes one of the user's scheduled prompts. Every tool that isn't a read is an action. Runs only after the user approves it, unless the thread has auto-approve on. Not to be confused with a send, which asks the model for a reply.
_Avoid_: write, operation, mutation

**Action card**:
The preview of an action waiting in a reply, where the user approves or cancels it. It shows the app (or a8, for a scheduled prompt). For a tool with a summary, it says what happens in plain words, names the item, and keeps the raw arguments behind "Show details". For any other tool, it shows the target and the content. A new prompt sent while a card is waiting cancels that action, unless the queue is holding for the card. Then the prompt joins the queue. A scheduled run never cancels a card: it joins the queue.
_Avoid_: approval request, pending action (in UI copy), confirmation

**Decision**:
The user's choice to approve or cancel the action on an action card.
_Avoid_: approval (for a cancel), approval response

**Auto-approve**:
A thread setting under which actions run without an action card, each leaving a record in the reply that it ran by itself. After five such actions in one reply, the rest of that reply's actions show cards. It's off for every new thread, only the user can change it, and a change counts from the next reply or continuing reply. Cards already waiting still need a decision, and scheduled prompt threads never have it. UI copy says "Auto-approve actions".
_Avoid_: YOLO mode, bypass mode, trust mode, auto mode

**Deferred tool**:
A connector tool the model finds through tool search instead of seeing it up front. Once the user's connector tools pass the tool budget in a thread, that thread defers them from then on, except those of up to three connectors the prompt mentions.

**Tool budget**:
The token size the user's connector tools can reach before a thread defers them.
_Avoid_: tool cap, tool limit

### Models and plans

**Model**:
The AI that writes a thread's replies, like GPT-5.5 or Claude Opus. The user picks one from every chat model on Vercel AI Gateway that can call tools. Each thread remembers the model it last used, and the user can switch at any send: the next reply uses the new one. Each reply records the model that wrote it. If the thread's model is no longer allowed, because the user's plan changed or a8 removed the model, the next send uses the default model instead. When a lab fails mid-reply, the reply fails, and a8 never moves it to another model on its own.
_Avoid_: provider, LLM (in UI copy), engine

**Lab**:
The company that made a model, like OpenAI, Google or Anthropic. The picker has a tab for each lab and shows its logo beside each model's name.
_Avoid_: provider, vendor, maker

**Connector check**:
A test of whether a model can use connectors. The model finds a deferred tool with a8's tool search, runs a read, asks for an action, and answers after the user cancels the action card. The picker marks each model that passed one. A model without the mark may still work.
_Avoid_: verified model, certified model

**Default model**:
The model a new thread starts on. The user sets it. If the user's plan doesn't include it, new threads and model switches use the first Free model instead.
_Avoid_: preferred model, global model

**Credit**:
A unit of hosted usage worth one US cent of model cost. A reply on a premium model uses more credits than the same reply on a cheap one, a web search costs one credit, and so does each dictation, warm-ups included. Thread titles cost nothing. a8 checks the balance at each send: a reply that starts always finishes, even if it takes the balance below zero, and then sends wait until the plan renews. A reply's cost lands seconds after it, so a reply holds what its first model call could cost at the model's prices until it ends, and each model call holds what its tokens cost until the cost lands. A send that the holds leave no credits for waits. A scheduled run with no credits counts as a failed run. Credits reset every month, and leftovers expire.
_Avoid_: token (for credits), point, coin

**Daily spend ceiling**:
The most the hosted a8 spends on models across all users in a UTC day, set in dollars by the operator. Once the day's spend reaches it, a8 refuses every send until 00:00 UTC, whatever the user's credits. Thread titles count toward it. One user's spend can take at most a share of it, 10% on Free and 25% on Pro, and past that a8 refuses that user's sends until 00:00 UTC. Credit holds count toward the ceiling and the share, so a burst of sends can't pass them before the costs land. A send that only the holds would push past waits a few minutes.
_Avoid_: daily cap, daily limit (those are self-hosted send caps)

**Plan**:
What a hosted user pays for: Free or Pro. Each plan grants a number of credits a month. Free can use the cheap models, those whose typical reply costs 5 credits or less, and Pro can use every model. a8 doesn't list a model whose typical reply costs over 100 credits. An upgrade grants the new plan's full credits at once and starts a new month from that day. A downgrade waits until the month ends. A revoke or refund puts the user on Free at once, and the credits they used so far count against Free's grant until Free's month ends. One inbox gets one account (ADR 0019). Hosted users can't bring their own model keys, and self-hosted a8 has no plans or credits.
_Avoid_: tier, subscription (outside billing code), package
