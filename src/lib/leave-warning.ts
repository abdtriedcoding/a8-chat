/**
 * The browser's "Leave site?" prompt, only while a Send is in flight. The
 * Convex clients have their own prompt turned off (unsavedChangesWarning),
 * since it showed for any request, such as dictation's prewarm, and a
 * reload right after a page load asked to leave.
 */

/** How many Sends are in flight. */
let sending = 0;

function askBeforeLeaving(event: BeforeUnloadEvent) {
  event.preventDefault();
}

/**
 * Returns `send`'s result. Until it settles, closing or reloading the tab
 * asks first, as the prompt could be lost.
 */
export async function warnOnLeaveWhile<T>(send: Promise<T>): Promise<T> {
  if (sending++ === 0) window.addEventListener("beforeunload", askBeforeLeaving);
  try {
    return await send;
  } finally {
    if (--sending === 0) {
      window.removeEventListener("beforeunload", askBeforeLeaving);
    }
  }
}
