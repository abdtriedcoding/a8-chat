import { cn } from "cn";
import { promptCharsLeft } from "../../../convex/lib/prompt";

/** How few characters a prompt has left before its count shows. */
const COUNT_FROM_CHARS_LEFT = 1_000;

/**
 * Says how many characters a prompt has left, or how many it's over, once
 * it's near the limit (promptCharsLeft). Nothing before that.
 */
export function PromptLengthCount({ text }: { text: string }) {
  const charsLeft = promptCharsLeft(text);
  if (charsLeft >= COUNT_FROM_CHARS_LEFT) return null;
  return (
    <span
      className={cn(
        "text-xs whitespace-nowrap tabular-nums",
        charsLeft < 0 ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {charsLeft < 0
        ? `${(-charsLeft).toLocaleString("en-US")} over`
        : `${charsLeft.toLocaleString("en-US")} left`}
    </span>
  );
}
