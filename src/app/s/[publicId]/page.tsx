import { fetchQuery } from "convex/nextjs";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { SharedSnapshotView } from "@/components/shared/shared-snapshot-view";
import { threadTitle } from "@/lib/thread-title";
import { api } from "../../../../convex/_generated/api";

// One fetch per request, shared by generateMetadata and the page.
const getSnapshot = cache((publicId: string) =>
  fetchQuery(api.sharedSnapshots.getSharedSnapshot, { publicId }),
);

// The page title is the thread's title, so a link preview shows it. The card
// image is the app's, from src/app/opengraph-image.tsx.
export async function generateMetadata(
  props: PageProps<"/s/[publicId]">,
): Promise<Metadata> {
  const { publicId } = await props.params;
  const snapshot = await getSnapshot(publicId);
  return { title: snapshot ? threadTitle(snapshot) : "Link not available" };
}

// A dead link gets a real 404. A link unshared while it's open shows the same
// message from SharedSnapshotView's live query.
export default async function SharedPage(props: PageProps<"/s/[publicId]">) {
  const { publicId } = await props.params;
  if ((await getSnapshot(publicId)) === null) notFound();
  return <SharedSnapshotView publicId={publicId} />;
}
