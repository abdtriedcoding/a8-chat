"use client";

import { CheckIcon, CopyIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MessageFooter } from "@/components/ui/message";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { errorMessage } from "@/lib/errors";

// How long Copy reads "Copied" after a click.
const COPIED_FOR_MS = 2000;

/**
 * The row under a reply: Copy when it has text, and Regenerate on the last
 * one. Where a pointer can hover, it shows while the reply is hovered or the
 * row has focus; on touch screens it always shows.
 */
export function ReplyActions({
  text,
  onRegenerate,
}: {
  /** The reply's markdown, if it has any to copy. */
  text?: string;
  onRegenerate?: () => Promise<void>;
}) {
  return (
    <MessageFooter className="-mt-1.5 gap-1 opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
      {text && <CopyReplyButton text={text} />}
      {onRegenerate && <RegenerateButton onRegenerate={onRegenerate} />}
    </MessageFooter>
  );
}

/**
 * Replaces the reply with a new one. An icon with a tooltip in the actions
 * row, or a labelled button (`labelled`) where it's the way out of a failed
 * reply. A rejection shows as a toast.
 */
export function RegenerateButton({
  onRegenerate,
  labelled = false,
}: {
  onRegenerate: () => Promise<void>;
  labelled?: boolean;
}) {
  const [regenerating, setRegenerating] = useState(false);

  async function regenerate() {
    setRegenerating(true);
    try {
      await onRegenerate();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setRegenerating(false);
    }
  }

  const icon = regenerating ? <Spinner /> : <RefreshCwIcon />;
  if (labelled) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={regenerating}
        onClick={() => void regenerate()}
      >
        {icon}
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
          disabled={regenerating}
          onClick={() => void regenerate()}
        >
          {icon}
          <span className="sr-only">Regenerate</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>Regenerate</TooltipContent>
    </Tooltip>
  );
}

/**
 * Copies the reply's markdown source, not the rendered text. Its tooltip
 * stays open on "Copied" for a moment, touch screens included.
 */
function CopyReplyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  // The tooltip's own hover and focus state, which a click closes.
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timeout.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      toast.error("Couldn't copy the reply.");
      return;
    }
    setCopied(true);
    clearTimeout(timeout.current);
    timeout.current = setTimeout(() => setCopied(false), COPIED_FOR_MS);
  }

  const label = copied ? "Copied" : "Copy reply";
  return (
    <Tooltip open={copied || tooltipOpen} onOpenChange={setTooltipOpen}>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" onClick={() => void copy()}>
          {copied ? <CheckIcon /> : <CopyIcon />}
          <span className="sr-only" aria-live="polite">
            {label}
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
