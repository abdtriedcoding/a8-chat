"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// How long Copy reads "Copied" after a click.
const COPIED_FOR_MS = 2000;

export function CopyReplyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);

  async function copy() {
    if (copied) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_FOR_MS);
    } catch {
      toast.error("Couldn't copy the reply.");
    }
  }

  const label = copied ? "Copied" : "Copy reply";
  return (
    <Tooltip open={copied || tooltipOpen} onOpenChange={setTooltipOpen}>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" onClick={() => void copy()}>
          {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
          <span className="sr-only" aria-live="polite">
            {label}
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
