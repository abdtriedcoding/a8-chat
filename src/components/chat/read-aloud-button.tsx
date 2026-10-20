"use client";

import { SquareIcon, Volume2Icon } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useInBrowser } from "@/hooks/use-in-browser";
import {
  canReadAloud,
  getReadingId,
  readAloud,
  stopReading,
  subscribeToReading,
} from "@/lib/read-aloud";

/**
 * Reads a reply aloud, or stops it. Shows nothing in a browser without
 * speech synthesis. Leaving the thread stops the reading.
 */
export function ReadAloudButton({ id, text }: { id: string; text: string }) {
  const inBrowser = useInBrowser();
  const readingId = useSyncExternalStore(
    subscribeToReading,
    getReadingId,
    () => null,
  );
  const reading = readingId === id;

  useEffect(
    () => () => {
      if (getReadingId() === id) stopReading();
    },
    [id],
  );

  if (!inBrowser || !canReadAloud()) return null;
  const label = reading ? "Stop reading" : "Read aloud";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          data-reading={reading || undefined}
          onClick={() => (reading ? stopReading() : readAloud(id, text))}
        >
          {reading ? <SquareIcon className="fill-current" /> : <Volume2Icon />}
          <span className="sr-only">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
