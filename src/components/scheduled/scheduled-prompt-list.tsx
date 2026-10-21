"use client";

import { cn } from "cn";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import {
  CalendarClockIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  SearchIcon,
  SendIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfirm } from "@/hooks/use-confirm";
import { useErrorToast } from "@/hooks/use-error-toast";
import { errorMessage } from "@/lib/errors";
import { api } from "../../../convex/_generated/api";
import { describeSchedule } from "../../../convex/lib/scheduleText";
import {
  EditScheduledPromptSheet,
  NewScheduledPromptSheet,
  type ScheduledPrompt,
} from "./scheduled-prompt-form";

/** A run's date and time, on the wall clock of the row's time zone. */
function formatRunTime(at: number, timeZone: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(at);
}

function subscribeToHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function readHash() {
  return window.location.hash.slice(1);
}

const LAST_RUN_OUTCOMES = {
  finished: "Finished",
  actionWaiting: "Waiting on an action card",
  failed: "Failed",
  stopped: "Stopped",
  skipped: "Skipped. The last run hadn't finished",
} satisfies Record<NonNullable<ScheduledPrompt["lastRun"]>["outcome"], string>;

/** The last run's outcome and time, and why it failed if we know. */
function LastRun({ row }: { row: ScheduledPrompt }) {
  const { lastRun } = row;
  if (!lastRun) return null;
  const failed = lastRun.outcome === "failed";
  return (
    <p
      className={cn(
        "text-xs text-muted-foreground",
        failed && "text-destructive",
      )}
    >
      Last run {formatRunTime(lastRun.at, row.timeZone)}:{" "}
      {LAST_RUN_OUTCOMES[lastRun.outcome]}
      {failed && lastRun.message ? `. ${lastRun.message}` : null}
    </p>
  );
}

/**
 * The user's scheduled prompts, each with its schedule, next run and a menu
 * to run it now, edit, pause or resume, and delete it. Above them, a search
 * box that filters them by title or prompt and the button that makes a new
 * one.
 */
export function ScheduledPromptList() {
  const { isAuthenticated } = useConvexAuth();
  const scheduledPrompts = useQuery(
    api.scheduledPrompts.list,
    isAuthenticated ? {} : "skip",
  );
  const [search, setSearch] = useState("");
  const pause = useMutation(api.scheduledPrompts.pause);
  const resume = useMutation(api.scheduledPrompts.resume);
  const runNow = useMutation(api.scheduledPrompts.runNow);
  const remove = useMutation(api.scheduledPrompts.remove);
  const router = useRouter();
  const [confirmDialog, confirm] = useConfirm();
  const showError = useErrorToast();
  const [editing, setEditing] = useState<ScheduledPrompt | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  // The row a thread's Scheduled badge links to, as /scheduled#<id>.
  const linkedId = useSyncExternalStore(subscribeToHash, readHash, () => "");
  const loaded = scheduledPrompts !== undefined;
  useEffect(() => {
    if (loaded && linkedId) {
      document.getElementById(linkedId)?.scrollIntoView({ block: "nearest" });
    }
  }, [loaded, linkedId]);

  const query = search.trim().toLowerCase();
  const matches = scheduledPrompts?.filter(
    ({ title, prompt }) =>
      title.toLowerCase().includes(query) ||
      prompt.toLowerCase().includes(query),
  );

  function edit(row: ScheduledPrompt) {
    setEditing(row);
    setEditOpen(true);
  }

  function setPaused(row: ScheduledPrompt, paused: boolean) {
    const id = { scheduledPromptId: row._id };
    (paused ? pause(id) : resume(id)).then(
      () => toast.success(paused ? "Paused." : "Resumed."),
      (error: unknown) => toast.error(errorMessage(error)),
    );
  }

  function run(row: ScheduledPrompt) {
    runNow({ scheduledPromptId: row._id }).then(
      ({ status }) =>
        toast.success(
          status === "sent"
            ? "Running now."
            : "Queued. It starts when its chat is free.",
          {
            action: {
              label: "Open chat",
              onClick: () => router.push(`/c/${row.threadId}`),
            },
          },
        ),
      showError,
    );
  }

  async function deleteScheduledPrompt(row: ScheduledPrompt) {
    await confirm({
      title: "Delete this scheduled task?",
      description: (
        <>
          &ldquo;{row.title}&rdquo; won&apos;t run again. Its chat stays, with
          every run so far.
        </>
      ),
      confirmLabel: "Delete",
      destructive: true,
      onConfirm: () => remove({ scheduledPromptId: row._id }),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-2">
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search scheduled tasks"
            aria-label="Search scheduled tasks"
          />
        </InputGroup>
        <NewScheduledPromptSheet />
      </div>
      {matches === undefined ? (
        <div aria-hidden="true" className="flex flex-col gap-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : scheduledPrompts?.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarClockIcon />
            </EmptyMedia>
            <EmptyTitle>No scheduled tasks</EmptyTitle>
            <EmptyDescription>
              Your scheduled tasks show up here with their next run.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : matches.length === 0 ? (
        <p className="text-center text-muted-foreground">
          No scheduled tasks match &ldquo;{search.trim()}&rdquo;.
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {matches.map((row) => (
            <li
              key={row._id}
              id={row._id}
              className={cn(
                "flex scroll-m-4 items-start justify-between gap-3 px-4 py-3",
                row._id === linkedId && "bg-muted",
              )}
            >
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex min-w-0 items-center gap-2">
                  <Link
                    href={`/c/${row.threadId}`}
                    className="truncate text-sm font-medium underline-offset-4 hover:underline"
                  >
                    {row.title}
                  </Link>
                  {row.status !== "active" && (
                    <Badge variant="secondary" className="shrink-0">
                      {row.status === "done" ? "Done" : "Paused"}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {describeSchedule(row.schedule)} · {row.timeZone}
                </p>
                {row.pausedAfterFailures !== undefined && (
                  <p className="text-xs text-destructive">
                    Paused itself after {row.pausedAfterFailures} failed runs
                    in a row. Resume it to try again.
                  </p>
                )}
                <LastRun row={row} />
                {row.nextRunAt !== undefined && (
                  <p className="text-xs text-muted-foreground">
                    Next run {formatRunTime(row.nextRunAt, row.timeZone)}
                  </p>
                )}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" className="shrink-0">
                    <MoreHorizontalIcon />
                    <span className="sr-only">
                      More options for {row.title}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuGroup>
                    <DropdownMenuItem onSelect={() => run(row)}>
                      <SendIcon />
                      Run now
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => edit(row)}>
                      <PencilIcon />
                      Edit
                    </DropdownMenuItem>
                    {row.status === "active" && (
                      <DropdownMenuItem onSelect={() => setPaused(row, true)}>
                        <PauseIcon />
                        Pause
                      </DropdownMenuItem>
                    )}
                    {row.status === "paused" && (
                      <DropdownMenuItem onSelect={() => setPaused(row, false)}>
                        <PlayIcon />
                        Resume
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => void deleteScheduledPrompt(row)}
                    >
                      <Trash2Icon />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}
      <EditScheduledPromptSheet
        row={editing}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
      {confirmDialog}
    </div>
  );
}
