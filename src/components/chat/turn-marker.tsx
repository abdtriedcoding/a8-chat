"use client";

import { CircleAlertIcon, CircleStopIcon } from "lucide-react";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { RegenerateButton } from "./regenerate-button";

const MARKERS = {
  stopped: { icon: <CircleStopIcon />, label: "Stopped" },
  timedOut: {
    icon: <CircleAlertIcon />,
    label: "No reply received. Try again.",
  },
};

/**
 * Says how a turn ended without a full reply: the user stopped it, no reply
 * came in time, or the reply failed. A failed reply shows in an error bubble,
 * with `reason` when there is one. With `regenerate`, a Regenerate button
 * follows, which only the last turn should set.
 */
export function TurnMarker({
  regenerate = false,
  ...end
}: ({ kind: keyof typeof MARKERS } | { kind: "failed"; reason?: string }) & {
  regenerate?: boolean;
}) {
  const button = regenerate && <RegenerateButton labelled />;
  if (end.kind === "failed") {
    return (
      <Bubble variant="destructive">
        <BubbleContent className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span>
            Couldn&apos;t get a reply.
            {end.reason && ` ${end.reason}`}
          </span>
          {button}
        </BubbleContent>
      </Bubble>
    );
  }
  const { icon, label } = MARKERS[end.kind];
  return (
    <Marker>
      <MarkerIcon>{icon}</MarkerIcon>
      <MarkerContent>{label}</MarkerContent>
      {button}
    </Marker>
  );
}
