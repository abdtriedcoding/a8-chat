"use client";

import { cn } from "cn";
import { MicIcon, SquareIcon } from "lucide-react";
import { useRef } from "react";
import { InputGroupButton } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { DictationState } from "@/hooks/use-dictation";

/**
 * The composer's mic. It shows a spinner while dictation connects, and a
 * stop icon with a ring that grows with the mic's `level` (0 to 1) while it
 * listens. An error shows as idle, since its toast already said why, and
 * so does stopping. `onWarmUp` runs when the pointer or focus reaches the
 * button, before a tap.
 *
 * A mouse press calls `onToggle` without waiting for the click. A touch
 * waits for the tap, since Safari on iOS starts audio only inside a tap,
 * and a touch press isn't one.
 */
export function DictationButton({
  state,
  level,
  onToggle,
  onWarmUp,
  className,
}: {
  state: DictationState;
  level: number;
  onToggle: () => void;
  onWarmUp: () => void;
  className?: string;
}) {
  const connecting = state === "connecting";
  const listening = state === "listening";
  const label = connecting || listening ? "Stop dictation" : "Dictate";
  // Set by a mouse press that toggled, so its click doesn't toggle back.
  const pressedRef = useRef(false);

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <InputGroupButton
            type="button"
            variant="outline"
            size="icon-sm"
            aria-pressed={connecting || listening}
            className={cn("relative", className)}
            onPointerDown={(event) => {
              if (event.pointerType !== "mouse" || event.button !== 0) return;
              pressedRef.current = true;
              onToggle();
            }}
            onClick={(event) => {
              const pressed = pressedRef.current;
              pressedRef.current = false;
              // A click from the keyboard has no detail.
              if (pressed && event.detail > 0) return;
              onToggle();
            }}
            onPointerEnter={onWarmUp}
            onFocus={onWarmUp}
          >
            {listening && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-[inherit] transition-[box-shadow] duration-75 motion-reduce:transition-none"
                style={{
                  boxShadow: `0 0 0 ${2 + level * 5}px color-mix(in oklab, var(--primary) 45%, transparent)`,
                }}
              />
            )}
            {connecting ? (
              <Spinner />
            ) : listening ? (
              <SquareIcon className="size-3 fill-current" />
            ) : (
              <MicIcon />
            )}
            <span className="sr-only">{label}</span>
          </InputGroupButton>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <span className="sr-only" aria-live="polite">
        {connecting ? "Connecting dictation" : listening ? "Listening" : ""}
      </span>
    </>
  );
}
