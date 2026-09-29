import { getAuthConfigProvider } from "@convex-dev/better-auth/auth-config";
import type { AuthConfig } from "convex/server";

// Required: without this file Convex never validates the Better Auth JWT,
// and every user silently appears signed out.
export default {
  providers: [getAuthConfigProvider()],
} satisfies AuthConfig;
