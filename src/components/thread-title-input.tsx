"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/errors";
import { threadTitle } from "@/lib/thread-title";
import { cn } from "@/lib/utils";
import { checkTitle } from "../../convex/lib/prompt";

/**
 * Edits a thread's title in place. Enter or leaving the field saves, and Esc
 * cancels. A title checkTitle refuses gets a toast: after Enter the field
 * stays open to fix it, after leaving the field it closes.
 */
export function ThreadTitleInput({
  title,
  onSave,
  onClose,
  className,
}: {
  title?: string;
  onSave: (title: string) => Promise<unknown>;
  /**
   * Called when a save starts or the edit is cancelled. `byKey` is true
   * after Enter or Esc. The field still has focus then and takes it away
   * when it closes, so the caller should focus something else.
   */
  onClose: (byKey: boolean) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(title ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  // Set when the field closes, so the blur that follows doesn't save again.
  const closed = useRef(false);

  // Opens with the title selected, ready to type over.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function close(byKey: boolean) {
    closed.current = true;
    onClose(byKey);
  }

  function save(byKey: boolean) {
    if (closed.current) return;
    let next: string;
    try {
      // The server runs the same check. Running it here first refuses a bad
      // title without a failed call, which the Convex client would log as a
      // console error.
      next = checkTitle(draft);
    } catch (error) {
      toast.error(errorMessage(error));
      if (!byKey) close(false);
      return;
    }
    close(byKey);
    // onSave shows the new title right away, so this doesn't wait for it.
    if (next !== title) {
      onSave(next).catch((error: unknown) => toast.error(errorMessage(error)));
    }
  }

  return (
    <Input
      ref={inputRef}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => save(false)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close(true);
        } else if (
          // Skip while an IME is composing: its Enter confirms a word.
          event.key === "Enter" &&
          !event.nativeEvent.isComposing
        ) {
          event.preventDefault();
          save(true);
        }
      }}
      placeholder={threadTitle({})}
      aria-label="Chat title"
      enterKeyHint="done"
      autoComplete="off"
      className={cn("h-8 px-2", className)}
    />
  );
}
