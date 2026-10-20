import { cn } from "cn";
import type { Ref } from "react";
import { splitMentions } from "../../../convex/lib/connectorView";

/**
 * A copy of the message box's text, laid out under the box, that tints each
 * connector mention. The text itself is transparent: the box above it shows
 * the text, and this shows only the tints. A mention of a connector in
 * `blockedIds` is tinted amber, since the prompt can't be sent with it.
 *
 * Give it the box's padding and text size in `className`, so its lines
 * wrap where the box's do, and hide the box's scrollbar, which would narrow
 * the box's lines. Set its scrollTop to the box's when the box scrolls.
 */
export function MentionHighlights({
  text,
  blockedIds,
  ref,
  className,
}: {
  text: string;
  blockedIds: string[];
  ref?: Ref<HTMLDivElement>;
  className?: string;
}) {
  return (
    <div
      ref={ref}
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden break-words whitespace-pre-wrap text-transparent",
        className,
      )}
    >
      {splitMentions(text).map((segment, index) =>
        segment.connector ? (
          <mark
            key={index}
            className={cn(
              "rounded-sm text-transparent ring-2",
              blockedIds.includes(segment.connector.id)
                ? "bg-amber-400/25 ring-amber-400/25"
                : "bg-primary/15 ring-primary/15",
            )}
          >
            {segment.text}
          </mark>
        ) : (
          segment.text
        ),
      )}
      {/* A trailing newline needs a character after it to take a line. */}
      {"​"}
    </div>
  );
}
