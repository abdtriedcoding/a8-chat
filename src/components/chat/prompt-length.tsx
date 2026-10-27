import { cn } from "cn";
import { promptCharsLeft } from "../../../convex/lib/prompt";

/** How few characters a prompt has left before its count shows. */
const COUNT_FROM_CHARS_LEFT = 1_000;

/**
 * Says how many characters a prompt has left, or how many it's over, once
 * it's near the limit (promptCharsLeft). Nothing before that. The count has
 * `id`, for the box and its Send button to name in aria-describedby.
 *
 * A status region tells a screen reader once that the prompt went over.
 * It stays on the page, since screen readers only announce a change to a
 * region that was already there. Its text stays the same while the prompt
 * is over, so typing doesn't announce it again.
 */
export function PromptLengthCount({ text, id }: { text: string; id: string }) {
  const charsLeft = promptCharsLeft(text);
  return (
    <>
      <span role="status" className="sr-only">
        {charsLeft < 0 ? "The prompt is over the length limit." : ""}
      </span>
      {charsLeft < COUNT_FROM_CHARS_LEFT && (
        <span
          id={id}
          className={cn(
            "text-xs whitespace-nowrap tabular-nums",
            charsLeft < 0 ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {charsLeft < 0 ? (
            <>
              {(-charsLeft).toLocaleString("en-US")}
              <span className="sr-only"> characters</span> over
              <span className="sr-only"> the limit</span>
            </>
          ) : (
            <>
              {charsLeft.toLocaleString("en-US")}
              <span className="sr-only"> characters</span> left
            </>
          )}
        </span>
      )}
    </>
  );
}
