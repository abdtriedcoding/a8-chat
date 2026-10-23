import type { Metadata } from "next";
import { LinkUnavailable } from "@/components/shared/shared-snapshot-view";

// Next skips the page's generateMetadata once it calls notFound().
export const metadata: Metadata = { title: "Link not available" };

// Keeps the shared layout's header, unlike the root 404.
export default function SharedNotFound() {
  return <LinkUnavailable />;
}
