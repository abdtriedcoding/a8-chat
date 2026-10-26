import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Daily at 03:00 UTC.
crons.cron(
  "clean up unsent uploads",
  "0 3 * * *",
  internal.attachments.cleanup.cleanUpUnsentUploads,
  {},
);

// Daily at 03:15 UTC.
crons.cron(
  "clean up upload grants",
  "15 3 * * *",
  internal.attachments.cleanup.cleanUpUploadGrants,
  {},
);

// Daily at 03:30 UTC.
crons.cron(
  "clean up orphaned storage",
  "30 3 * * *",
  internal.attachments.cleanup.cleanUpOrphanedStorage,
  {},
);

// Sign-ins expire after 10 minutes, so an hourly sweep keeps the table small.
crons.interval(
  "clean up expired connects",
  { hours: 1 },
  internal.signIns.cleanUpExpiredConnects,
  {},
);

// Emails are deleted a day after a8 queues them, so an hourly sweep keeps
// each one about 25 hours.
crons.interval(
  "clean up old emails",
  { hours: 1 },
  internal.emails.cleanUpExpiredEmails,
  {},
);

// A temporary thread is deleted after a day with no new message, so an
// hourly sweep keeps it to about 25 hours.
crons.interval(
  "delete idle temporary threads",
  { hours: 1 },
  internal.temporaryThreads.deleteIdleTemporaryThreads,
  {},
);

export default crons;
