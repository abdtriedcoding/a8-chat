"use client";

import { cn } from "cn";
import { useRef } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/errors";
import { threadTitle } from "@/lib/thread-title";
import { MAX_RENAME_LENGTH } from "../../convex/lib/prompt";

/**
 * Edits a thread's title in place. Enter or leaving the field saves, and Esc
 * cancels. An empty title keeps the old one. `onClose` gets true after Enter
 * or Esc. Focus then goes nowhere, so the caller should move it.
 */
export function ThreadTitleInput({
  title,
  onSave,
  onClose,
  className,
}: {
  title?: string;
  onSave: (title: string) => Promise<unknown>;
  onClose: (byKey: boolean) => void;
  className?: string;
}) {
  const closingByKey = useRef(false);
  return (
    <Input
      autoFocus
      defaultValue={title}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={(event) => {
        onClose(closingByKey.current);
        const next = event.currentTarget.value.trim();
        // onSave shows the new title right away, so this doesn't wait for it.
        if (next && next !== title) {
          onSave(next).catch((error: unknown) =>
            toast.error(errorMessage(error)),
          );
        }
      }}
      onKeyDown={(event) => {
        // Skip Enter while an IME is composing: it confirms a word there.
        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
          // The caller can focus a button as the field closes, and Enter
          // would then press it.
          event.preventDefault();
          closingByKey.current = true;
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          closingByKey.current = true;
          event.currentTarget.value = title ?? "";
          event.currentTarget.blur();
        }
      }}
      maxLength={MAX_RENAME_LENGTH}
      placeholder={threadTitle({})}
      aria-label="Chat title"
      enterKeyHint="done"
      autoComplete="off"
      className={cn("h-8 px-2", className)}
    />
  );
}
