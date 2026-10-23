"use client";

import { cn } from "cn";
import {
  BrainIcon,
  ChevronDownIcon,
  EyeIcon,
  FileTextIcon,
  ListFilterIcon,
  LockIcon,
  PlugIcon,
  StarIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroupButton } from "@/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIsModelLocked } from "@/hooks/use-is-model-locked";
import { useQueryWithLocalCopy } from "@/hooks/use-query-with-local-copy";
import { useSetDefaultModel } from "@/hooks/use-set-default-model";
import { errorMessage } from "@/lib/errors";
import { BILLING_PATH } from "@/lib/plans";
import { api } from "../../../convex/_generated/api";
import type { AttachmentKind } from "../../../convex/lib/attachments";
import {
  featuredModels,
  LABS,
  labName,
  MODELS,
  modelOrDefault,
  type Lab,
  type Model,
} from "../../../convex/lib/models";
import { LabLogo } from "./lab-logo";

/** What a disabled row says about a kind of file in the draft. */
const UNREADABLE_REASONS: Record<AttachmentKind, string> = {
  image: "Can't read images",
  pdf: "Can't read PDFs",
};

/** The rail's first tab, a8's pick of models (FEATURED_MODEL_IDS). */
const FEATURED = "featured";

type Tab = typeof FEATURED | Lab;

/** What the filter menu can narrow the list to. */
type Filter = "connectors" | "image" | "pdf" | "reasoning" | "fast" | "plan";

/** Each capability's icon and name, for the filters and the row icons. */
const CAPABILITIES: {
  filter: Exclude<Filter, "plan">;
  label: string;
  icon: LucideIcon;
  has: (model: Model) => boolean;
}[] = [
  {
    filter: "connectors",
    label: "Works with connectors",
    icon: PlugIcon,
    has: (model) => model.worksWithConnectors,
  },
  {
    filter: "image",
    label: "Reads images",
    icon: EyeIcon,
    has: (model) => model.reads.includes("image"),
  },
  {
    filter: "pdf",
    label: "Reads PDFs",
    icon: FileTextIcon,
    has: (model) => model.reads.includes("pdf"),
  },
  {
    filter: "reasoning",
    label: "Reasoning",
    icon: BrainIcon,
    has: (model) => model.reasoning,
  },
  {
    filter: "fast",
    label: "Fast",
    icon: ZapIcon,
    has: (model) => model.fast,
  },
];

/**
 * The composer's model chip. It shows the model the next reply uses and
 * opens every model on the list (ADR 0017). A rail on the left picks a
 * tab: a8's featured models, or one lab's. Typing searches every lab at
 * once, and the filter menu narrows by what a model can do. Each row has
 * the model's description, icons for what it reads and does and, on the
 * hosted a8, about how many credits a reply costs. A plug icon marks a
 * model that passed a connector check (ADR 0018). The footer makes the
 * current model the user's default model. A failed `onChange` shows as a
 * toast.
 *
 * On Free, the Pro models are locked, and a banner at the top links to
 * the Billing page. Models that can't read a kind of file in the draft
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
  const { data: defaultModelId, stale: defaultModelStale } =
    useQueryWithLocalCopy(api.models.defaultModel, {});
  const billingEnabled =
    useQueryWithLocalCopy(api.billing.enabled, {}).data === true;
  const isLocked = useIsModelLocked();
  const setDefaultModel = useSetDefaultModel();
  const model = modelOrDefault(modelId);
  const hasLocked = MODELS.some(isLocked);

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>(FEATURED);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [highlighted, setHighlighted] = useState(model.id);

  function openChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    // Each open starts on the current model's tab, with it highlighted.
    setSearch("");
    setTab(featuredModels().includes(model) ? FEATURED : model.lab);
    setHighlighted(model.id);
  }

  function pickTab(next: Tab) {
    setTab(next);
    setSearch("");
  }

  function toggleFilter(filter: Filter, on: boolean) {
    setFilters((current) =>
      on ? [...current, filter] : current.filter((entry) => entry !== filter),
    );
  }

  function passesFilters(entry: Model) {
    return filters.every((filter) =>
      filter === "plan"
        ? !isLocked(entry)
        : CAPABILITIES.find((capability) => capability.filter === filter)!.has(
            entry,
          ),
    );
  }

  async function pick(next: string) {
    setOpen(false);
    if (next === model.id) return;
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

  const groups = (
    search.trim()
      ? LABS.map((lab) => ({
          key: lab.id,
          heading: lab.name,
          models: MODELS.filter(
            (entry) => entry.lab === lab.id && matches(entry, search),
          ),
        }))
      : [
          tab === FEATURED
            ? { key: FEATURED, heading: "Featured", models: featuredModels() }
            : {
                key: tab,
                heading: labName(tab),
                models: MODELS.filter((entry) => entry.lab === tab),
              },
        ]
  )
    .map((group) => ({ ...group, models: group.models.filter(passesFilters) }))
    .filter((group) => group.models.length > 0);

  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger asChild>
        <InputGroupButton
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-label={`Model: ${model.name}`}
          className="min-w-0"
        >
          <LabLogo lab={model.lab} className="size-3.5" />
          <span className="truncate">{model.name}</span>
          <ChevronDownIcon data-icon="inline-end" />
        </InputGroupButton>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        collisionPadding={8}
        className="max-h-(--radix-popover-content-available-height) w-[34rem] max-w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0"
      >
        {hasLocked && (
          <div className="flex items-center gap-3 border-b bg-muted/50 px-3 py-2">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium">Unlock every model</span>
              <span className="text-xs text-muted-foreground">
                Pro opens all {MODELS.length} models.
              </span>
            </div>
            <Button size="sm" asChild>
              <Link href={BILLING_PATH} onClick={() => setOpen(false)}>
                Upgrade
              </Link>
            </Button>
          </div>
        )}
        <Command
          shouldFilter={false}
          value={highlighted}
          onValueChange={setHighlighted}
          className="min-h-0 flex-1 rounded-none! p-0"
        >
          <div className="flex items-center gap-1 border-b p-1 pr-2 *:data-[slot=command-input-wrapper]:flex-1 *:data-[slot=command-input-wrapper]:pb-1">
            <CommandInput
              value={search}
              onValueChange={setSearch}
              placeholder={`Search ${MODELS.length} models…`}
              aria-label="Search models"
            />
            <FilterMenu
              filters={filters}
              showPlan={hasLocked}
              onToggle={toggleFilter}
            />
          </div>
          <div className="flex h-[26rem] min-h-0 shrink">
            <LabRail
              tab={search.trim() ? null : tab}
              onPick={pickTab}
            />
            <CommandList className="max-h-none flex-1">
              <CommandEmpty>
                No models match
                {filters.length > 0 ? " these filters" : ""}.
              </CommandEmpty>
              {groups.map((group) => (
                <CommandGroup key={group.key} heading={group.heading}>
                  {group.models.map((entry) => {
                    const locked = isLocked(entry);
                    const unreadable = attachmentKinds.find(
                      (kind) => !entry.reads.includes(kind),
                    );
                    return (
                      <CommandItem
                        key={entry.id}
                        value={entry.id}
                        disabled={locked || unreadable !== undefined}
                        data-checked={entry.id === model.id}
                        onSelect={() => void pick(entry.id)}
                        className="items-start gap-2.5 py-2"
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
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ))}
            </CommandList>
          </div>
        </Command>
        {defaultModelId !== undefined &&
          defaultModelId !== model.id &&
          !isLocked(model) && (
            <div className="border-t p-1">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start font-normal"
                // The default from the device's copy may be out of date.
                disabled={defaultModelStale}
                onClick={() => void makeDefault()}
              >
                <StarIcon />
                Start new chats on {model.name}
              </Button>
            </div>
          )}
      </PopoverContent>
    </Popover>
  );
}

/** Whether every word of the search is in the model's name, id or lab. */
function matches(model: Model, search: string): boolean {
  const haystack =
    `${model.name} ${model.id} ${labName(model.lab)}`.toLowerCase();
  return search
    .toLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}

/**
 * The tabs down the picker's left side: Featured, then a logo for each
 * lab. `tab` is null while a search covers every lab.
 */
function LabRail({
  tab,
  onPick,
}: {
  tab: Tab | null;
  onPick: (tab: Tab) => void;
}) {
  const tabs = [
    { id: FEATURED, name: "Featured", count: featuredModels().length },
    ...LABS.map((lab) => ({
      id: lab.id,
      name: lab.name,
      count: MODELS.filter((model) => model.lab === lab.id).length,
    })),
  ];
  return (
    <div
      role="tablist"
      aria-label="Labs"
      aria-orientation="vertical"
      className="no-scrollbar flex w-11 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r py-1.5"
    >
      {tabs.map((entry) => (
        <Tooltip key={entry.id}>
          <TooltipTrigger asChild>
            <button
              type="button"
              role="tab"
              // Keeps the open tab in view when the picker opens on it.
              ref={
                entry.id === tab
                  ? (node) => node?.scrollIntoView({ block: "nearest" })
                  : undefined
              }
              aria-selected={entry.id === tab}
              aria-label={`${entry.name}, ${entry.count} models`}
              onClick={() => onPick(entry.id)}
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
                entry.id === tab && "bg-muted text-foreground",
              )}
            >
              {entry.id === FEATURED ? (
                <StarIcon className="size-4" />
              ) : (
                <LabLogo lab={entry.id} />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {entry.name} · {entry.count}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

/** The filter button beside the search, with a dot while a filter is on. */
function FilterMenu({
  filters,
  showPlan,
  onToggle,
}: {
  filters: Filter[];
  /** Whether to offer "On my plan", which only narrows the list on Free. */
  showPlan: boolean;
  onToggle: (filter: Filter, on: boolean) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Filter models"
          className="relative"
        >
          <ListFilterIcon />
          {filters.length > 0 && (
            <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Show models that</DropdownMenuLabel>
        {CAPABILITIES.map(({ filter, label, icon: Icon }) => (
          <DropdownMenuCheckboxItem
            key={filter}
            checked={filters.includes(filter)}
            onCheckedChange={(on) => onToggle(filter, on)}
            onSelect={(event) => event.preventDefault()}
          >
            <Icon />
            {label}
          </DropdownMenuCheckboxItem>
        ))}
        {showPlan && (
          <DropdownMenuCheckboxItem
            checked={filters.includes("plan")}
            onCheckedChange={(on) => onToggle("plan", on)}
            onSelect={(event) => event.preventDefault()}
          >
            <LockIcon />
            Are on my plan
          </DropdownMenuCheckboxItem>
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
    <>
      <LabLogo lab={model.lab} className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium">{model.name}</span>
          {model.isNew && (
            <span className="shrink-0 text-[0.625rem] font-medium text-link uppercase">
              New
            </span>
          )}
          {locked && (
            <Badge
              variant="secondary"
              className="h-4 shrink-0 px-1.5 text-[0.625rem]"
            >
              <LockIcon data-icon="inline-start" />
              Pro
            </Badge>
          )}
          {isDefault && (
            <span className="shrink-0 text-xs text-muted-foreground">
              Default
            </span>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-1 pl-1 text-muted-foreground">
            {CAPABILITIES.filter(({ has }) => has(model)).map(
              ({ filter, label, icon: Icon }) => (
                <Icon key={filter} aria-label={label} className="size-3.5!" />
              ),
            )}
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate">
            {unreadableReason ?? model.description}
          </span>
          {showCredits && (
            <span className="ml-auto shrink-0 tabular-nums">
              {formatCredits(model.creditsPerReply)}
            </span>
          )}
        </span>
      </div>
    </>
  );
}

/** About how many credits a reply costs, as the picker shows it. */
function formatCredits(credits: number): string {
  if (credits < 0.1) return "<0.1 credits";
  const rounded =
    credits < 10 ? Number(credits.toFixed(1)) : Math.round(credits);
  return `~${rounded} ${rounded === 1 ? "credit" : "credits"}`;
}
