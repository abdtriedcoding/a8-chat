"use client";

import { cn } from "cn";
import { MicIcon, SquareIcon } from "lucide-react";
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
 * listens. An error shows as idle, since its toast already said why.
 */
export function DictationButton({
  state,
  level,
  onClick,
  className,
}: {
  state: DictationState;
  level: number;
  onClick: () => void;
  className?: string;
}) {
  const connecting = state === "connecting";
  const listening = state === "listening";
  const label = connecting || listening ? "Stop dictation" : "Dictate";

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
            onClick={onClick}
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
