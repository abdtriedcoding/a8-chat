import { handler } from "@/lib/auth-server";

// Proxies Better Auth requests to the Convex HTTP actions, so auth cookies
// live on this app's origin.
export const { GET, POST } = handler;
