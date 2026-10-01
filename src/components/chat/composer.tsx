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
 * The message box. Enter sends and Shift+Enter adds a line. The text clears
 * as soon as it's sent, and comes back if the send fails. While a reply is
 * on its way, Stop takes Send's place if `onStop` is given.
 */
export function Composer({
  onSend,
  onStop,
  busy = false,
  autoFocus = false,
  className,
}: {
  /** Sends the prompt. A rejection shows as a toast. */
  onSend: (prompt: string) => Promise<void>;
  /** Stops the reply on its way. A rejection shows as a toast. */
  onStop?: () => Promise<void>;
  /** A reply is on its way, so sending waits. Typing still works. */
  busy?: boolean;
  autoFocus?: boolean;
  className?: string;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const waiting = sending || busy;
  const canSend = text.trim() !== "" && !waiting;
  // Not while the Send itself is in flight: there's no reply to stop yet.
  const canStop = onStop !== undefined && busy && !sending;

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

  async function stop() {
    if (!onStop) return;
    setStopping(true);
    try {
      await onStop();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setStopping(false);
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
          {/* One button in one place, so focus stays when Stop turns back into Send. */}
          {canStop ? (
            <InputGroupButton
              type="button"
              variant="default"
              size="icon-sm"
              className="ml-auto rounded-full"
              disabled={stopping}
              onClick={() => void stop()}
            >
              {stopping ? <Spinner /> : <SquareIcon className="fill-current" />}
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
              {waiting ? <Spinner /> : <ArrowUpIcon />}
              <span className="sr-only">Send</span>
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
