"use client";

import { ArrowUpIcon } from "lucide-react";
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
 * The message box. Enter sends and Shift+Enter adds a line. The text clears
 * as soon as it's sent, and comes back if the send fails.
 */
export function Composer({
  onSend,
  busy = false,
  autoFocus = false,
  className,
}: {
  /** Sends the prompt. A rejection shows as a toast. */
  onSend: (prompt: string) => Promise<void>;
  /** A reply is on its way, so sending waits. Typing still works. */
  busy?: boolean;
  autoFocus?: boolean;
  className?: string;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const waiting = sending || busy;
  const canSend = text.trim() !== "" && !waiting;

  async function send() {
    if (!canSend) return;
    const prompt = text;
    setText("");
    setSending(true);
    try {
      await onSend(prompt);
    } catch (error) {
      // Put the prompt back, unless something new was typed meanwhile.
      setText((current) => (current === "" ? prompt : current));
      toast.error(errorMessage(error));
    } finally {
      setSending(false);
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
          <InputGroupButton
            type="submit"
            variant="default"
            size="icon-sm"
            className="ml-auto rounded-full"
            disabled={!canSend}
          >
            {waiting ? <Spinner /> : <ArrowUpIcon />}
            <span className="sr-only">Send</span>
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
