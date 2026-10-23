import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// The browser talks to Convex over HTTPS and a WebSocket on the deployment's
// own host. Attachments are served from the same host.
const convexUrl = new URL(process.env.NEXT_PUBLIC_CONVEX_URL!);
const convexHttp = convexUrl.origin;
const convexWs = `wss://${convexUrl.host}`;

const csp = [
  "default-src 'self'",
  // Next.js inlines its RSC payload and bootstrap scripts without a nonce.
  // Dictation loads its AudioWorklet from a blob: URL. React needs eval in dev.
  `script-src 'self' 'unsafe-inline' blob:${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  // Reply images load from any https host, but only after the reader clicks
  // "Load image" (see RemoteImage in markdown.tsx).
  `img-src 'self' data: blob: https:`,
  "font-src 'self' data:",
  `connect-src 'self' ${convexHttp} ${convexWs} wss://api.deepgram.com`,
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Only dictation needs a device.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(self), geolocation=(), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  reactCompiler: true,
  poweredByHeader: false,
  experimental: {
    // Reuse a dynamic page's server response on revisits for 5 minutes,
    // matching the Convex query cache. The chat pages and the shared-link
    // page are dynamic, and their data comes live over Convex. A page that
    // starts rendering user data on the server would show it up to 5 minutes
    // old.
    staleTimes: { dynamic: 300 },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
