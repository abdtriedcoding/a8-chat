import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Crawlers skip the API and the (chat) pages, which need a sign-in. Add a
// page here when it goes in (chat). /s/ stays crawlable because link
// previews have to fetch it, and its noindex keeps it out of search results.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api",
        "/c/",
        "/chat",
        "/archived",
        "/connectors",
        "/scheduled",
        "/settings",
      ],
    },
    sitemap: new URL("/sitemap.xml", SITE_URL).href,
  };
}
