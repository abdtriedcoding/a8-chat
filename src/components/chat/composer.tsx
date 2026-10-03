"use client";

import { ArrowUpIcon, SquareIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/errors";

/**
 * The message box. Enter sends and Shift+Enter adds a line. While `onStop`
 * is set, a Stop button shows in place of Send.
 */
export function Composer({
  onSend,
  onStop,
  disabled = false,
  autoFocus = false,
  className,
}: {
  onSend: (prompt: string) => Promise<void>;
  onStop?: () => Promise<void>;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
}) {
  const [text, setText] = useState("");
  const canSend = text.trim() !== "" && !disabled;

  async function send() {
    if (!canSend) return;
    const prompt = text;
    setText("");
    try {
      await onSend(prompt);
    } catch (error) {
      // Put the prompt back, unless something new was typed meanwhile.
      setText((current) => (current === "" ? prompt : current));
      toast.error(errorMessage(error));
    }
  }

  async function stop() {
    try {
      await onStop?.();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <form
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <InputGroup>
        <InputGroupTextarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // Skip while an IME is composing: its Enter confirms a word.
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void send();
            }
          }}
          rows={1}
          autoFocus={autoFocus}
          placeholder="Ask a8 anything…"
          aria-label="Message"
          className="max-h-52 min-h-11 px-3 pt-3"
        />
        <InputGroupAddon align="block-end">
          {/* Stop and Send share this spot, so keyboard focus stays put when one replaces the other. */}
          {onStop ? (
            <InputGroupButton
              type="button"
              variant="default"
              size="icon-sm"
              className="ml-auto rounded-full"
              onClick={() => void stop()}
            >
              <SquareIcon className="fill-current" />
              <span className="sr-only">Stop</span>
            </InputGroupButton>
          ) : (
            <InputGroupButton
              type="submit"
              variant="default"
              size="icon-sm"
              className="ml-auto rounded-full"
              disabled={!canSend}
            >
              {disabled ? <Spinner /> : <ArrowUpIcon />}
              <span className="sr-only">Send</span>
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
