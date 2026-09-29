import agent from "@convex-dev/agent/convex.config";
import betterAuth from "@convex-dev/better-auth/convex.config";
import { defineApp } from "convex/server";
import { v } from "convex/values";

// CONVEX_SITE_URL is provided by the platform; never declare it here.
const app = defineApp({
  env: {
    SITE_URL: v.string(),
    BETTER_AUTH_SECRET: v.string(),
    GOOGLE_CLIENT_ID: v.optional(v.string()),
    GOOGLE_CLIENT_SECRET: v.optional(v.string()),
    // Optional so the app deploys without them; sending a message checks
    // for the key (assertModelConfigured in convex/lib/models.ts).
    OPENROUTER_API_KEY: v.optional(v.string()),
    DEFAULT_MODEL: v.optional(v.string()),
  },
});

app.use(betterAuth);
app.use(agent);

export default app;
