import agent from "@convex-dev/agent/convex.config";
import betterAuth from "@convex-dev/better-auth/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    SITE_URL: v.string(),
    BETTER_AUTH_SECRET: v.string(),
    GOOGLE_CLIENT_ID: v.string(),
    GOOGLE_CLIENT_SECRET: v.string(),
    ANTHROPIC_API_KEY: v.string(),
    // Optional. Without it, the model gets no web search tool.
    TAVILY_API_KEY: v.optional(v.string()),
  },
});

app.use(betterAuth);
app.use(agent);
app.use(rateLimiter);

export default app;
