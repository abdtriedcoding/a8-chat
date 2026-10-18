/** The most queued prompts a thread's queue holds. */
export const MAX_QUEUED_PROMPTS = 5;

/**
 * How long a reply has to start before the client gives up on it (the
 * "timedOut" reply status) and the server lets Resume start the queue
 * anyway. Until then, a runner may still be on its way.
 */
export const REPLY_START_TIMEOUT_MS = 60_000;
