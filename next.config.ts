import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  experimental: {
    // Reuse a dynamic page's server response on revisits for 5 minutes,
    // matching the Convex query cache. The chat pages and the shared-link
    // page are dynamic, and their data comes live over Convex. A page that
    // starts rendering user data on the server would show it up to 5 minutes
    // old.
    staleTimes: { dynamic: 300 },
  },
};

export default nextConfig;
