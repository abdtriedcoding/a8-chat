import { fetchQuery } from "convex/nextjs";
import type { Metadata } from "next";
import { SharedSnapshotView } from "@/components/shared/shared-snapshot-view";
import { threadTitle } from "@/lib/thread-title";
import { api } from "../../../../convex/_generated/api";

// The page title is the thread's title, so a link preview shows it. The page
// has no Open Graph image.
export async function generateMetadata(
  props: PageProps<"/s/[publicId]">,
): Promise<Metadata> {
  const { publicId } = await props.params;
  const snapshot = await fetchQuery(api.sharedSnapshots.getSharedSnapshot, {
    publicId,
  });
  return { title: snapshot ? threadTitle(snapshot) : "Link not available" };
}

export default async function SharedPage(props: PageProps<"/s/[publicId]">) {
  const { publicId } = await props.params;
  return <SharedSnapshotView publicId={publicId} />;
}
