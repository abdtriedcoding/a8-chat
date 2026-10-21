"use client";

import { RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useErrorToast } from "@/hooks/use-error-toast";
import { useThreadActionsContext } from "./thread-actions-context";

/**
 * Replaces the last reply with a new one. By default it's an icon with a
 * tooltip, for the row under a reply. With `labelled` it's a button that
 * reads "Regenerate", for a turn marker. It always redoes the last turn,
 * whichever message shows it, and shows nothing while that turn can't be
 * redone.
 */
export function RegenerateButton({ labelled = false }: { labelled?: boolean }) {
  const { regenerate: regenerateReply } = useThreadActionsContext();
  const [regenerating, setRegenerating] = useState(false);
  const showError = useErrorToast();

  // The button stays enabled while the call runs. A disabled button would
  // lose keyboard focus, and the row under a reply fades out when focus
  // leaves it. A second click before the call ends does nothing.
  async function regenerate() {
    if (regenerating || !regenerateReply) return;
    setRegenerating(true);
    try {
      await regenerateReply();
    } catch (error) {
      showError(error);
    } finally {
      setRegenerating(false);
    }
  }

  if (!regenerateReply) return null;
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
