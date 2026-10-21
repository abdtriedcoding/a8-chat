"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { ChevronDownIcon, FileTextIcon, ImageIcon, StarIcon } from "lucide-react";
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
import { useSetDefaultModel } from "@/hooks/use-set-default-model";
import { errorMessage } from "@/lib/errors";
import { api } from "../../../convex/_generated/api";
import {
  LAB_NAMES,
  modelOrDefault,
  modelsByLab,
  type Model,
} from "../../../convex/lib/models";

/**
 * The composer's model chip. It shows the model the next reply uses and
 * opens the model list, grouped by lab. Each row has the model's badges for
 * images and PDFs and, on the hosted a8, about how many credits a reply
 * costs. The last item makes the current model the user's default model.
 * A failed `onChange` shows as a toast.
 */
export function ModelPicker({
  modelId,
  onChange,
  disabled = false,
}: {
  modelId: string;
  onChange: (modelId: string) => Promise<unknown> | void;
  disabled?: boolean;
}) {
  const { isAuthenticated } = useConvexAuth();
  const defaultModelId = useQuery(
    api.models.defaultModel,
    isAuthenticated ? {} : "skip",
  );
  const billingEnabled = useQuery(api.billing.enabled) === true;
  const setDefaultModel = useSetDefaultModel();
  const model = modelOrDefault(modelId);

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
              {models.map((entry) => (
                <DropdownMenuRadioItem key={entry.id} value={entry.id}>
                  <ModelRow
                    model={entry}
                    isDefault={entry.id === defaultModelId}
                    showCredits={billingEnabled}
                  />
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuGroup>
          ))}
        </DropdownMenuRadioGroup>
        {defaultModelId !== undefined && defaultModelId !== model.id && (
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
}: {
  model: Model;
  isDefault: boolean;
  showCredits: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="flex items-center gap-1.5">
        <span className="truncate">{model.name}</span>
        {isDefault && (
          <span className="text-xs text-muted-foreground">Default</span>
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
    </div>
  );
}
