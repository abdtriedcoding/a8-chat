/**
 * A scheduled prompt's schedule in words. Apart from convex/lib/schedule.ts,
 * so the browser can use it without the cron parser.
 */
import type { Schedule } from "./schedule";

/** The days of the week, Monday first. `day` is as a schedule stores it. */
export const WEEKDAYS = [
  { day: 1, name: "Monday", short: "Mon" },
  { day: 2, name: "Tuesday", short: "Tue" },
  { day: 3, name: "Wednesday", short: "Wed" },
  { day: 4, name: "Thursday", short: "Thu" },
  { day: 5, name: "Friday", short: "Fri" },
  { day: 6, name: "Saturday", short: "Sat" },
  { day: 0, name: "Sunday", short: "Sun" },
];

/** The schedule in words, such as "Weekdays at 8:00 AM". */
export function describeSchedule(schedule: Schedule): string {
  const at = `at ${formatTime(schedule.time)}`;
  switch (schedule.kind) {
    case "once": {
      const [year, month, day] = schedule.date.split("-").map(Number);
      const date = new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(Date.UTC(year, month - 1, day));
      return `Once on ${date} ${at}`;
    }
    case "daily":
      return `Daily ${at}`;
    case "weekdays":
      return `Weekdays ${at}`;
    case "weekly": {
      const days = WEEKDAYS.filter(({ day }) =>
        schedule.days.includes(day),
      ).map(({ name }) => name);
      const list = new Intl.ListFormat("en-US").format(days);
      return `Every ${list} ${at}`;
    }
    case "monthly": {
      const shorter = schedule.day > 28 ? " (or the last day)" : "";
      return `Monthly on the ${ordinal(schedule.day)}${shorter} ${at}`;
    }
  }
}

/** "17:00" as "5:00 PM". */
function formatTime(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeStyle: "short",
    timeZone: "UTC",
  }).format(Date.UTC(2000, 0, 1, hour, minute));
}

function ordinal(day: number) {
  const suffixes = { one: "st", two: "nd", few: "rd", other: "th" };
  const rule = new Intl.PluralRules("en-US", { type: "ordinal" }).select(day);
  return `${day}${suffixes[rule as keyof typeof suffixes] ?? "th"}`;
}
