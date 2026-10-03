/** The title to show for a thread, with a fallback for an empty one. */
export function threadTitle(thread: { title?: string }): string {
  return thread.title || "Untitled chat";
}
