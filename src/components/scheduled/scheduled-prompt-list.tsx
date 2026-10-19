"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { CalendarClockIcon } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "../../../convex/_generated/api";
import { describeSchedule } from "../../../convex/lib/scheduleText";

/** The next run's date and time, on the wall clock of the row's time zone. */
function formatNextRun(at: number, timeZone: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(at);
}

/** The user's scheduled prompts, each with its schedule and next run. */
export function ScheduledPromptList() {
  const { isAuthenticated } = useConvexAuth();
  const scheduledPrompts = useQuery(
    api.scheduledPrompts.list,
    isAuthenticated ? {} : "skip",
  );

  if (scheduledPrompts === undefined) {
    return (
      <div aria-hidden="true" className="flex flex-col gap-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (scheduledPrompts.length === 0) {
    return (
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
    );
  }

  return (
    <ul className="flex flex-col divide-y rounded-lg border">
      {scheduledPrompts.map((row) => (
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
  );
}
