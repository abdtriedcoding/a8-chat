import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Daily at 03:00 UTC.
crons.cron(
  "clean up unsent uploads",
  "0 3 * * *",
  internal.attachments.cleanUpUnsentUploads,
  {},
);

// Sign-ins expire after 10 minutes, so an hourly sweep keeps the table small.
crons.interval(
  "clean up expired connects",
  { hours: 1 },
  internal.connectors.cleanUpExpiredConnects,
  {},
);

export default crons;
