export const GITHUB_URL = "https://github.com/abdtriedcoding/a8-chat";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
if (!siteUrl) {
  throw new Error(
    "Missing NEXT_PUBLIC_SITE_URL. Set it in .env.local to the app's URL, like http://localhost:3000.",
  );
}

/** The app's public URL. Link previews, robots.txt and the sitemap need absolute URLs. */
export const SITE_URL = new URL(siteUrl);
