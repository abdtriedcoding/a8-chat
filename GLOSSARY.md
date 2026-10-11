# a8

An open-source AI workspace where a person chats with a model that can act across their apps. This glossary covers the chat and the apps it works in.

## Language

### Chat

**Thread**:
One ongoing exchange between a user and the assistant, with its own title and history. UI copy calls it a "chat"; everywhere else it's a thread.
_Avoid_: conversation, chat (outside UI copy)

**Prompt**:
A message the user writes to the assistant, with any attachments sent alongside it.
_Avoid_: query, user message

**Reply**:
The assistant's full answer to one prompt, including every step it took on the way, such as web searches. A reply can be stopped, and the last one can be regenerated.
_Avoid_: response, completion, answer

**Turn**:
One prompt together with its reply.
_Avoid_: exchange, round

**Attachment**:
A file (an image or a PDF) sent with a prompt.
_Avoid_: upload, file

**Send**:
Any user action that asks the model for a new reply: a new prompt, an edited prompt, or a regenerated reply. The send rate limits count sends. Web searches and connector tool calls have limits of their own.
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
One user's signed-in link to a connector. A user has at most one connection per connector.
_Avoid_: account, link, install

**OAuth client registration**:
The OAuth client a8 registered with a connector's authorization server. A deployment has one per connector, and every user's connection signs in through it. Not to be confused with an MCP client.
_Avoid_: connector client, OAuth app, client (on its own)

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
A tool call that only fetches from an app, like searching email. Runs without asking.
_Avoid_: query, lookup

**Action**:
A tool call that writes to or deletes from an app, like sending an email. Every tool that isn't a read is an action. Runs only after the user approves it. Not to be confused with a send, which asks the model for a reply.
_Avoid_: write, operation, mutation

**Action card**:
The preview of an action waiting in a reply, showing the app, the target and the content, where the user approves or cancels it. A new prompt sent while a card is waiting cancels that action.
_Avoid_: approval request, pending action (in UI copy), confirmation
