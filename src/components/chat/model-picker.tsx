"use client";

import { useConvexAuth, useQuery } from "convex/react";
import {
  ChevronDownIcon,
  FileTextIcon,
  ImageIcon,
  LockIcon,
  SparklesIcon,
  StarIcon,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroupButton } from "@/components/ui/input-group";
import { useIsModelLocked } from "@/hooks/use-is-model-locked";
import { useSetDefaultModel } from "@/hooks/use-set-default-model";
import { errorMessage } from "@/lib/errors";
import { BILLING_PATH } from "@/lib/plans";
import { api } from "../../../convex/_generated/api";
import type { AttachmentKind } from "../../../convex/lib/attachments";
import {
  LAB_NAMES,
  modelOrDefault,
  modelsByLab,
  type Model,
} from "../../../convex/lib/models";

/** What a disabled row says about a kind of file in the draft. */
const UNREADABLE_REASONS: Record<AttachmentKind, string> = {
  image: "Can't read images",
  pdf: "Can't read PDFs",
};

/**
 * The composer's model chip. It shows the model the next reply uses and
 * opens the model list, grouped by lab. Each row has the model's badges for
 * images and PDFs and, on the hosted a8, about how many credits a reply
 * costs. The last item makes the current model the user's default model.
 * A failed `onChange` shows as a toast.
 *
 * On Free, the Pro models are locked, and an item at the end links to the
 * Billing page. Models that can't read a kind of file in the draft
 * (`attachmentKinds`) are disabled, with the reason.
 */
export function ModelPicker({
  modelId,
  onChange,
  attachmentKinds = [],
  disabled = false,
}: {
  modelId: string;
  onChange: (modelId: string) => Promise<unknown> | void;
  attachmentKinds?: AttachmentKind[];
  disabled?: boolean;
}) {
  const { isAuthenticated } = useConvexAuth();
  const defaultModelId = useQuery(
    api.models.defaultModel,
    isAuthenticated ? {} : "skip",
  );
  const billingEnabled = useQuery(api.billing.enabled) === true;
  const isLocked = useIsModelLocked();
  const setDefaultModel = useSetDefaultModel();
  const model = modelOrDefault(modelId);
  const hasLocked = modelsByLab().some(({ models }) => models.some(isLocked));

  async function change(next: string) {
    try {
      await onChange(next);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function makeDefault() {
    try {
      await setDefaultModel({ modelId: model.id });
      toast.success(`New chats start on ${model.name}.`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <InputGroupButton
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-label={`Model: ${model.name}`}
          className="min-w-0"
        >
          <span className="truncate">{model.name}</span>
          <ChevronDownIcon data-icon="inline-end" />
        </InputGroupButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        className="w-72 max-w-[calc(100vw-2rem)]"
      >
        <DropdownMenuRadioGroup
          value={model.id}
          onValueChange={(next) => void change(next)}
        >
          {modelsByLab().map(({ lab, models }, index) => (
            <DropdownMenuGroup key={lab}>
              {index > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel>{LAB_NAMES[lab]}</DropdownMenuLabel>
              {models.map((entry) => {
                const locked = isLocked(entry);
                const unreadable = attachmentKinds.find(
                  (kind) => !entry.reads.includes(kind),
                );
                return (
                  <DropdownMenuRadioItem
                    key={entry.id}
                    value={entry.id}
                    disabled={locked || unreadable !== undefined}
                  >
                    <ModelRow
                      model={entry}
                      isDefault={entry.id === defaultModelId}
                      showCredits={billingEnabled}
                      locked={locked}
                      unreadableReason={
                        unreadable && UNREADABLE_REASONS[unreadable]
                      }
                    />
                  </DropdownMenuRadioItem>
                );
              })}
            </DropdownMenuGroup>
          ))}
        </DropdownMenuRadioGroup>
        {hasLocked && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={BILLING_PATH}>
                <SparklesIcon />
                Upgrade to Pro for every model
              </Link>
            </DropdownMenuItem>
          </>
        )}
        {defaultModelId !== undefined &&
          defaultModelId !== model.id &&
          !isLocked(model) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void makeDefault()}>
                <StarIcon />
                Start new chats on {model.name}
              </DropdownMenuItem>
            </>
          )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ModelRow({
  model,
  isDefault,
  showCredits,
  locked,
  unreadableReason,
}: {
  model: Model;
  isDefault: boolean;
  showCredits: boolean;
  /** Whether the user's plan doesn't include the model. */
  locked: boolean;
  /** Why the model can't read the draft's files, if it can't. */
  unreadableReason: string | undefined;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="flex items-center gap-1.5">
        <span className="truncate">{model.name}</span>
        {isDefault && (
          <span className="text-xs text-muted-foreground">Default</span>
        )}
        {locked && (
          <Badge
            variant="secondary"
            className="ml-auto h-4 px-1.5 text-[0.625rem]"
          >
            <LockIcon data-icon="inline-start" />
            Pro
          </Badge>
        )}
      </span>
      <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        <span>{LAB_NAMES[model.lab]}</span>
        {model.reads.includes("image") && (
          <Badge variant="outline" className="h-4 px-1.5 text-[0.625rem]">
            <ImageIcon data-icon="inline-start" />
            Images
          </Badge>
        )}
        {model.reads.includes("pdf") && (
          <Badge variant="outline" className="h-4 px-1.5 text-[0.625rem]">
            <FileTextIcon data-icon="inline-start" />
            PDFs
          </Badge>
        )}
        {showCredits && (
          <span className="ml-auto tabular-nums">
            ~{model.creditsPerReply}{" "}
            {model.creditsPerReply === 1 ? "credit" : "credits"} per reply
          </span>
        )}
      </span>
      {unreadableReason && (
        <span className="text-xs text-muted-foreground">
          {unreadableReason}
        </span>
      )}
    </div>
  );
}
