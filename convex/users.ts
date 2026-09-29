import { v } from "convex/values";
import { query } from "./_generated/server";
import { getViewer } from "./lib/access";

/** The signed-in user's profile, or null when signed out. Never throws. */
export const viewer = query({
  args: {},
  returns: v.union(
    v.object({
      // Better Auth user _id, which is also the JWT subject.
      _id: v.string(),
      name: v.string(),
      email: v.string(),
      image: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return null;
    return {
      _id: viewer._id,
      name: viewer.name,
      email: viewer.email,
      // Better Auth stores a missing image as null.
      image: viewer.image ?? undefined,
    };
  },
});
