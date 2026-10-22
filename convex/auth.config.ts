import { getAuthConfigProvider } from "@convex-dev/better-auth/auth-config";
import type { AuthConfig } from "convex/server";
import { env } from "./_generated/server";

// Convex refuses to push an auth config that reads an unset env var, so
// staticJwks returns undefined instead of reading it. With JWKS set, the
// provider carries the public keys and Convex checks tokens without fetching
// them. Unset, it points Convex at Better Auth's JWKS URL.
function staticJwks() {
  try {
    return env.JWKS;
  } catch {
    return undefined;
  }
}

export default {
  providers: [getAuthConfigProvider({ jwks: staticJwks() })],
} satisfies AuthConfig;
