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
A prompt the user sent while a reply was still running, waiting in line to start its own turn. Queued prompts start oldest first, each once the thread is free. The model doesn't see one until it starts.
_Avoid_: pending message, queued message, draft

**Queue**:
A thread's queued prompts, oldest first. It holds while an action card waits, and goes on by itself once every card is decided.
_Avoid_: backlog, outbox

**Paused queue**:
A queue that waits for the user to resume it, after a Stop or a failed reply. A send while the queue is paused skips ahead of it.
_Avoid_: stopped queue, held queue

**Turn**:
One prompt together with its reply.
_Avoid_: exchange, round

**Attachment**:
A file (an image or a PDF) sent with a prompt.
_Avoid_: upload, file

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
A connector a user adds themselves from an MCP server's URL, seen only by that user. It has a handle and a connection like any other connector, but a8 can't label its tools, so every call to one of them asks for approval.
_Avoid_: custom MCP, custom server, my connector

**Connection**:
One user's link to a connector. The user signed in to the app, or turned the connector on if its app needs no sign-in, like Excalidraw. A user has at most one connection per connector.
_Avoid_: account, link, install

**OAuth client registration**:
The OAuth client a8 registered with a connector's authorization server. A deployment has one per connector, and every user's connection signs in through it. Not to be confused with an MCP client.
_Avoid_: connector client, OAuth app, client (on its own)

**Pre-registered client**:
An OAuth client the deployer registered with a vendor by hand, for a vendor with no dynamic registration, like Google. Its ID and secret come from the deployment's env vars, and a8 stores no OAuth client registration for it. Without them, the connector is not set up.
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
A tool call that writes to or deletes from an app, like sending an email. Every tool that isn't a read is an action. Runs only after the user approves it. Not to be confused with a send, which asks the model for a reply.
_Avoid_: write, operation, mutation

**Action card**:
The preview of an action waiting in a reply, showing the app, the target and the content, where the user approves or cancels it. A new prompt sent while a card is waiting cancels that action, unless the queue is holding for the card. Then the prompt joins the queue.
_Avoid_: approval request, pending action (in UI copy), confirmation

**Decision**:
The user's choice to approve or cancel the action on an action card.
_Avoid_: approval (for a cancel), approval response

**Deferred tool**:
A connector tool the model finds through tool search instead of seeing it up front. Once the user's connector tools pass the tool budget in a thread, that thread defers them from then on, except those of up to three connectors the prompt mentions.

**Tool budget**:
The token size the user's connector tools can reach before a thread defers them.
_Avoid_: tool cap, tool limit
