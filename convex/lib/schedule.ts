/**
 * A scheduled prompt's schedule (GLOSSARY.md), and when it next runs. Times
 * are wall-clock times in the scheduled prompt's IANA time zone, so 08:00
 * stays 08:00 local across daylight saving changes.
 */
import { CronExpressionParser, type CronDate } from "cron-parser";
import { v, type Infer } from "convex/values";

/** "HH:MM", 24-hour. */
const vTime = v.string();

export const vSchedule = v.union(
  v.object({
    kind: v.literal("once"),
    // "YYYY-MM-DD"
    date: v.string(),
    time: vTime,
  }),
  v.object({ kind: v.literal("daily"), time: vTime }),
  v.object({ kind: v.literal("weekdays"), time: vTime }),
  v.object({
    kind: v.literal("weekly"),
    // 0 is Sunday.
    days: v.array(v.number()),
    time: vTime,
  }),
  v.object({
    kind: v.literal("monthly"),
    // 1 to 31. Past the end of a shorter month, the run falls on its last day.
    day: v.number(),
    time: vTime,
  }),
);

export type Schedule = Infer<typeof vSchedule>;

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Why the schedule is malformed, or null if it's fine. A one-off in the past
 * is well formed; findNextRun returns null for it.
 */
export function scheduleProblem(schedule: Schedule): string | null {
  if (!TIME_PATTERN.test(schedule.time)) return "Pick a time.";
  switch (schedule.kind) {
    case "once": {
      const match = DATE_PATTERN.exec(schedule.date);
      if (!match) return "Pick a date.";
      const [, year, month, day] = match.map(Number);
      const date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        return "Pick a date.";
      }
      return null;
    }
    case "weekly":
      if (schedule.days.length === 0) return "Pick at least one day.";
      if (schedule.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
        return "Pick days of the week.";
      }
      return null;
    case "monthly":
      if (
        !Number.isInteger(schedule.day) ||
        schedule.day < 1 ||
        schedule.day > 31
      ) {
        return "Pick a day of the month from 1 to 31.";
      }
      return null;
    default:
      return null;
  }
}

/**
 * The first instant after `from` the schedule runs at in `timeZone`, in ms
 * since the epoch. Null for a one-off whose time isn't after `from`.
 * Expects a schedule scheduleProblem passed and a valid time zone.
 */
export function findNextRun(
  schedule: Schedule,
  timeZone: string,
  from: number,
): number | null {
  const [hour, minute] = schedule.time.split(":").map(Number);
  const at = `${minute} ${hour}`;
  switch (schedule.kind) {
    case "once": {
      const [year, month, day] = schedule.date.split("-").map(Number);
      // The wall-clock time in the zone, found from a day before it in UTC.
      // Every zone is within a day of UTC.
      const runAt = nextMatch(`${at} ${day} ${month} *`, timeZone, {
        from: Date.UTC(year, month - 1, day) - DAY_MS,
      });
      return runAt > from ? runAt : null;
    }
    case "daily":
      return nextMatch(`${at} * * *`, timeZone, { from });
    case "weekdays":
      return nextMatch(`${at} * * 1-5`, timeZone, { from });
    case "weekly":
      return nextMatch(
        `${at} * * ${[...new Set(schedule.days)].sort().join(",")}`,
        timeZone,
        { from },
      );
    case "monthly":
      if (schedule.day <= 28) {
        return nextMatch(`${at} ${schedule.day} * *`, timeZone, { from });
      }
      // A plain day of month skips months too short for it. This lists the
      // day and each month's last day, and keeps whichever comes first in
      // the month: the day, or the last day when the month is shorter.
      return nextMatch(`${at} ${schedule.day},L * *`, timeZone, {
        from,
        accept: (date) =>
          date.getDate() ===
          Math.min(
            schedule.day,
            daysInMonth(date.getFullYear(), date.getMonth()),
          ),
      });
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Enough to get past every rejected candidate in a monthly schedule. */
const MAX_CANDIDATES = 4;

function nextMatch(
  expression: string,
  timeZone: string,
  {
    from,
    accept = () => true,
  }: { from: number; accept?: (date: CronDate) => boolean },
): number {
  const dates = CronExpressionParser.parse(expression, {
    currentDate: from,
    tz: timeZone,
  });
  for (let i = 0; i < MAX_CANDIDATES; i++) {
    const date = dates.next();
    if (accept(date)) return date.getTime();
  }
  throw new Error(`No run found for "${expression}".`);
}

/** Days in a month, where `month` counts from 0. */
function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}
