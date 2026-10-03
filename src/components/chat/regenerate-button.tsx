"use client";

import { RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { errorMessage } from "@/lib/errors";

/**
 * Replaces the last reply with a new one. By default it's an icon with a
 * tooltip, for the row under a reply. With `labelled` it's a button that
 * reads "Regenerate", for a failed reply's bubble or next to a marker.
 */
export function RegenerateButton({
  onRegenerate,
  labelled = false,
}: {
  onRegenerate: () => Promise<void>;
  labelled?: boolean;
}) {
  const [regenerating, setRegenerating] = useState(false);

  // The button stays enabled while the call runs. A disabled button would
  // lose keyboard focus, and the row under a reply fades out when focus
  // leaves it. A second click before the call ends does nothing.
  async function regenerate() {
    if (regenerating) return;
    setRegenerating(true);
    try {
      await onRegenerate();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setRegenerating(false);
    }
  }

  if (labelled) {
    return (
      <Button variant="outline" size="sm" onClick={() => void regenerate()}>
        {regenerating ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <RefreshCwIcon data-icon="inline-start" />
        )}
        Regenerate
      </Button>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void regenerate()}
        >
          {regenerating ? <Spinner /> : <RefreshCwIcon />}
          <span className="sr-only">Regenerate</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>Regenerate</TooltipContent>
    </Tooltip>
  );
}
