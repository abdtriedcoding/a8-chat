# Actions wait on the Agent's native tool approval, not our own pending-actions table

Every action (a tool call that writes to or deletes from an app) needs approval through the `toolApproval` option on `streamText`. AI SDK 7 deprecates a tool's own `needsApproval` in its favour. The reply stops with the call in the `approval-requested` state, and Approve or Cancel records the user's decision through the Agent's `approveToolCall` or `denyToolCall` before the reply continues. The product spec planned a custom `pendingActions` table plus the Workflow component, because the Convex Agent docs we read on Sep 28 showed no approval step. Agent 0.7.3 and AI SDK 7 now ship one. Using it keeps the pending call, the decision and the result in the thread's own messages, so every open tab sees the same state and there's no second store to keep in sync.

## Consequences

- Native approval carries a yes or a no, never edited arguments. Stage 5's Edit needs another path, possibly a thin table on top of this one.
- A new prompt sent while a card is waiting cancels that action, so a stale card can never send something later. The Agent doesn't do this itself. It only treats the call as denied for the next model call, and the card stays approvable. So each send calls `denyToolCall` on the waiting call.
- Approving continues the same reply, so it isn't a send and the send limit doesn't count it. The reply's step cap still applies, but the Agent's cap resets on each `streamText` call, so a8 counts steps across the whole reply itself.
