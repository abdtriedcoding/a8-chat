"use client";

import { ArrowRightLeftIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useDismissModelSwitch } from "@/hooks/use-dismiss-model-switch";
import { errorMessage } from "@/lib/errors";
import { BILLING_PATH } from "@/lib/plans";
import { findModel, modelOrDefault } from "../../../convex/lib/models";
import type { ModelSwitch } from "../../../convex/schema";

/**
 * Says a Send moved the thread off a model it couldn't use, and why, above
 * the composer. `modelSwitch` is the old model and the reason, and `modelId`
 * the model the thread uses now. It shows until the user dismisses it,
 * picks a model or sends again.
 */
export function ModelSwitchNotice({
  threadId,
  modelSwitch,
  modelId,
}: {
  threadId: string;
  modelSwitch: ModelSwitch;
  modelId: string;
}) {
  const dismiss = useDismissModelSwitch();
  const current = modelOrDefault(modelId).name;
  // A model that left the list has no name anymore, only its id.
  const previous = findModel(modelSwitch.modelId)?.name ?? modelSwitch.modelId;
  const leftPlan = modelSwitch.reason === "plan";

  return (
    // The Alert pads for its action with a has-data variant, so only the
    // same variant overrides it.
    <Alert
      role="status"
      className={leftPlan ? "has-data-[slot=alert-action]:pr-36" : undefined}
    >
      <ArrowRightLeftIcon />
      <AlertTitle>This chat moved to {current}</AlertTitle>
      <AlertDescription>
        {leftPlan
          ? `${previous} is a Pro model, and you're on Free.`
          : `${previous} isn't offered anymore.`}
      </AlertDescription>
      <AlertAction className="flex items-center gap-1">
        {leftPlan && (
          <Button asChild variant="outline" size="sm">
            <Link href={BILLING_PATH}>Upgrade</Link>
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => {
            dismiss({ threadId }).catch((error: unknown) =>
              toast.error(errorMessage(error)),
            );
          }}
        >
          <XIcon />
          <span className="sr-only">Dismiss</span>
        </Button>
      </AlertAction>
    </Alert>
  );
}
