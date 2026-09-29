import { defineSchema } from "convex/server";

// No users table: user profiles live in the Better Auth component's `user`
// table (read them with getViewer in convex/lib/access.ts). App data about a
// user goes in its own table, keyed by the Better Auth user _id.
export default defineSchema({});
