# a8

An open-source AI workspace where a person chats with a model that can act across their apps. This glossary covers the chat itself.

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
