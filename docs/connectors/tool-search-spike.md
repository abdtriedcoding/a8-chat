# Tool search spike

This spike ran on 2026-10-10 for #85, before the tool search build in #73. It tests the four risks ADR 0006 names.

## Results

| Risk | Result | Recommendation |
| --- | --- | --- |
| History references a tool no longer offered | Rejected, and every later reply in the thread fails | Filter each search result's references to the tools the reply offers, in the Agent's `contextHandler` |
| A deferred action and its action card | Works. Approve runs it in the continuation, Cancel denies it | Keep every action in `toolApproval`, as planned |
| Step count and turn message cap | A search adds no step and no message. The last step's `toolChoice: "none"` is rejected in any thread that has searched | Use `activeTools: []` on the last step |
| AI SDK `toolSearch()` across continuations | Found tools are lost when a continuation starts. Each search costs a step | For Stage 9, load the tools earlier searches found before each call |

Haiku 4.5, a8's current model, supports native tool search. The `@ai-sdk/anthropic` doc comment lists only Opus 4.5 and Sonnet 4.5, but Haiku 4.5 searched and called the right tool in every run where the system prompt listed the user's connections. In the one run without that list, it said it had no access to Todoist and didn't search. Haiku needs the one line per connection that ADR 0006 puts in the system prompt. The spec's "Opus or Sonnet 4.5 and later" should include Haiku 4.5.

## How the spike ran

A throwaway Bun script called Anthropic with the packages a8 uses: `ai` 7.0.122, `@ai-sdk/anthropic` 4.0.68 and `@convex-dev/agent` 0.7.3. Every saved message went through the Agent's serializer, its `vMessage` validator and back, as it does through the database.

The script offered 10 fake connector tools for Linear, Todoist and Notion, each labelled read or action (ADR 0008), plus a loaded `webSearch`. Deferred tools had `providerOptions: { anthropic: { deferLoading: true } }` and a description starting "[Linear]". The search tool was `anthropic.tools.toolSearchBm25_20251119()`. Each call matched `streamReply`: actions in `toolApproval`, `stopWhen: stepCountIs(...)`, and `toolChoice: "none"` on the last step. A continuation added the `tool-approval-response` message that `approveToolCall` and `denyToolCall` save, and called `streamText` again.

Haiku 4.5 ran every scenario. Sonnet 4.5 also ran the first search test and the three-app test in risk 3. Nothing ran in the Convex deployment or the browser, so this covers the API, not the UI.

## Risk 1: history references a tool no longer offered

A search saves its result in the thread as a list of tool references. When a later reply doesn't define a referenced tool, Anthropic rejects the request:

```
invalid_request_error: Tool reference 'todoist_find_tasks' not found in available tools
```

Dropping one tool (an allowlist change) and dropping a whole connector (a disconnect) both fail. The history doesn't change, so every later reply in the thread fails the same way.

These cases pass:

- A plain tool call in history to a tool no longer offered, which is what happens today after a Notion disconnect. Anthropic checks only search references.
- History with search results when the reply offers no search tool. The AI SDK leaves the search parts out of the request and logs "provider executed tool call for tool tool_search is not supported".
- A search result with an empty reference list.

Three fixes passed the disconnect case:

1. Filter each search result's references down to the tools the reply offers.
2. Drop the search call and its result.
3. Keep a deferred stub for each referenced tool, with an open schema and an `execute` that says the connector is disconnected.

Use the first. It needs no stored state. It changes the history only when a tool is gone, and a tool that's gone has already changed the tool list and the cached prefix. The Agent's `contextHandler` option on `streamText` sees the context messages before every call, continuations included, so the filter goes there. It changes what's sent, not what's stored.

To find search results, match the `tool-result` whose `toolCallId` belongs to a `tool-call` with `providerExecuted: true`. The result part has no `providerExecuted` flag of its own.

Keep the filter to tools that are gone. A reference is what keeps a found tool loaded in later calls (risk 2), so removing references to tools still offered would make the model search again.

## Risk 2: a deferred action and its action card

Asked to add a Todoist task, Haiku searched and called `todoist_add_tasks` in the same step. `toolApproval` stopped the reply with a `tool-approval-request` part, which a8 shows as an action card, and the tool didn't run.

- After Approve, the continuation ran the tool before calling the model, and the model confirmed the task.
- After Cancel, the continuation saved an `execution-denied` result with the cancel reason, and nothing ran.
- Asked for two actions in a row, the model called the second one directly in the continuation, with no new search, and it got its own action card. The first search's references in history kept the Todoist tools loaded.

The build needs nothing extra here. Every action goes in `toolApproval`, deferred or not, as ADR 0006 says. The spike saw the approval request in the API, not the action card in the browser. `connector-tool-call.tsx` finds a tool by its name, deferred or not, so the card should show, and the build's browser checks confirm it.

## Risk 3: step count and the turn message cap

Native search runs on Anthropic's side, inside one model call. The search, its result and the tool call that follows are one AI SDK step, saved as one assistant message. A prompt across three apps made three searches and three tool calls in a single step on both models. `MAX_REPLY_STEPS` and `MAX_TURN_MESSAGES` need no change.

The last step fails. `streamReply` sets `toolChoice: "none"` on the step cap's last step, and on any step after 8 minutes. For `"none"`, `@ai-sdk/anthropic` sends no tools at all. It still sends every search result in the thread's history, so the last step fails in any thread that has ever searched. Anthropic rejects it with the same "Tool reference not found" error.

Returning `activeTools: []` from `prepareStep` worked with deferred and loaded tools. The SDK then leaves out the search parts too, and the model answered in text. Anthropic accepted plain tool calls in history with no tools defined. The comment in `streamReply` says `"none"` keeps the tools defined, which is wrong for `@ai-sdk/anthropic` 4.0.68.

Two smaller things:

- In one of about 20 deferred replies, Haiku called a tool name it had never seen (`linear_get_issues`) without searching first. The AI SDK returned `NoSuchToolError` as a tool error, and the model searched on the next step. It cost one step. The deferred-mode system prompt should tell the model to search before calling a connector tool.
- `@ai-sdk/anthropic` maps Anthropic's `pause_turn` to the finish reason `stop`, so a paused model call would end the reply. It didn't happen in the spike. The reply log should record a raw finish reason of `pause_turn`.

## Risk 4: AI SDK `toolSearch()` across continuations

The same scenarios ran with the AI SDK's own `toolSearch()` and core `deferLoading: true`, as Stage 9 would use on other models.

- Each search is its own step, a client tool call and its result, saved as two messages. The step cap has to allow for it.
- The tool list changes after each search. Step 1 offered `webSearch` and `tool_search`, and step 2 added the found tools. Tools come first in Anthropic's cache prefix, so each step after a search changes the prefix. The spike didn't measure cache hits.
- An approved action runs in the continuation even though the new call hasn't found it, because the SDK runs approved calls from the full tool set.
- Found tools don't carry over. The SDK keeps them in a set inside one `streamText` call. In the two-action test, the continuation offered only `webSearch` and `tool_search`. The model called `todoist_complete_tasks` anyway, got `NoSuchToolError`, searched again and then called it, which cost two extra steps. A new prompt starts over too.

One fix worked. Before each call, read the names in the thread's earlier `toolSearch` results and pass those tools with `deferLoading: false`. The two-action test then needed no second search. Stage 9 should do this, and budget one step and two messages for each search.

## Notes for the build

- Search parts are saved in the thread like other tool parts: a `tool-call` with `providerExecuted: true` and a `tool-result` named after the search tool's key in the tool set. The reply doesn't show them, because `connector-tool-call.tsx` renders only tools that `findConnectorTool` knows.
- Keep the search tool's key fixed. The provider recognises stored search parts by the key they were saved under, and leaves them out of the request when the reply offers no tool with that key.
- The reply log can read each search's query and found tools from the step's content in `onStepFinish`.
