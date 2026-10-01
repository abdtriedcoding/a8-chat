"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MessageFooter } from "@/components/ui/message";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// How long Copy reads "Copied" after a click.
const COPIED_FOR_MS = 2000;

/**
 * The row under a reply. Where a pointer can hover, it shows while the
 * reply is hovered or the row has focus; on touch screens it always shows.
 */
export function ReplyActions({ text }: { text: string }) {
  return (
    <MessageFooter className="-mt-1.5 gap-1 opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
      <CopyReplyButton text={text} />
    </MessageFooter>
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
