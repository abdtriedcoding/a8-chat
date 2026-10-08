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
Any user action that asks the model for a new reply: a new prompt, an edited prompt, or a regenerated reply. Sends are what rate limits count.
_Avoid_: request, message (as a unit of usage)

### Apps

**App**:
A third-party product a person already uses, like Gmail or Notion. UI copy says "app".
_Avoid_: integration, service, tool (for the product)

**Connector**:
Something a8 knows how to connect to, listed in the catalog with a handle, a logo and its tools. Built into a8 or served by the app's vendor.
_Avoid_: plugin, integration, MCP server (for the catalog entry)

**Connection**:
One user's signed-in link to a connector, or to a custom MCP URL they pasted. A custom URL is a connection with no connector behind it; the user names it when adding it.
_Avoid_: account, link, install

**Handle**:
The word typed after @ to pick an app, like `gmail`. For a custom URL, the name the user gave it.
_Avoid_: slug, tag

**Active apps**:
The apps a thread is working with: every app mentioned so far in that thread, until the user removes it.
_Avoid_: scope, context

**Read**:
A tool call that only fetches from an app, like searching email. Runs without asking.
_Avoid_: query, lookup

**Action**:
A tool call that writes to or deletes from an app, like sending an email. Runs only after the user approves it. Not to be confused with a send, which asks the model for a reply.
_Avoid_: write, operation, mutation

**Action card**:
The preview of an action waiting in a reply, showing the app, the target and the content, where the user approves or cancels it. A new prompt sent while a card is waiting cancels that action.
_Avoid_: approval request, pending action (in UI copy), confirmation
