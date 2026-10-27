/** The most queued prompts a thread's queue holds. */
export const MAX_QUEUED_PROMPTS = 5;

/**
 * How long a queued prompt waits for an edit (startQueuedPromptEdit in
 * convex/chat/queue.ts) before it starts anyway. It's long enough that a
 * background tab, whose timers Chrome slows to once a minute, still keeps
 * the edit open.
 */
export const QUEUED_EDIT_MS = 2 * 60_000;

/**
 * How often the queue stack calls startQueuedPromptEdit again while the
 * editor is open.
 */
export const QUEUED_EDIT_RENEW_MS = 30_000;

/**
 * How long a reply has to start before the client gives up on it (the
 * "timedOut" reply status) and the server lets Resume start the queue
 * anyway. Until then, a runner may still be on its way.
 */
export const REPLY_START_TIMEOUT_MS = 60_000;
