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

export default crons;
