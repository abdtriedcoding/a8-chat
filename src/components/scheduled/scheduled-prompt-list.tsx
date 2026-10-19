"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { CalendarClockIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
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
import { api } from "../../../convex/_generated/api";
import { describeSchedule } from "../../../convex/lib/scheduleText";
import { NewScheduledPromptSheet } from "./scheduled-prompt-form";

/** The next run's date and time, on the wall clock of the row's time zone. */
function formatNextRun(at: number, timeZone: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(at);
}

/**
 * The user's scheduled prompts, each with its schedule and next run, under
 * a search box that filters them by title or prompt and the button that
 * makes a new one.
 */
export function ScheduledPromptList() {
  const { isAuthenticated } = useConvexAuth();
  const scheduledPrompts = useQuery(
    api.scheduledPrompts.list,
    isAuthenticated ? {} : "skip",
  );
  const [search, setSearch] = useState("");

  const query = search.trim().toLowerCase();
  const matches = scheduledPrompts?.filter(
    ({ title, prompt }) =>
      title.toLowerCase().includes(query) ||
      prompt.toLowerCase().includes(query),
  );

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
            <li key={row._id} className="flex flex-col gap-1 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
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
              {row.nextRunAt !== undefined && (
                <p className="text-xs text-muted-foreground">
                  Next run {formatNextRun(row.nextRunAt, row.timeZone)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
