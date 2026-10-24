import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// The marketing pages. Add a page here when it goes in (marketing).
export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/privacy", "/terms"].map((path) => ({
    url: new URL(path, SITE_URL).href,
  }));
}
