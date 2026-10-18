import type { Metadata } from "next";
import { ThreadView } from "@/components/chat/thread-view";
import { requireSignedIn } from "@/lib/auth-server";

export const metadata: Metadata = { title: "Chat" };

export default async function ThreadPage(props: PageProps<"/c/[threadId]">) {
  await requireSignedIn();
  const { threadId } = await props.params;
  return <ThreadView key={threadId} threadId={threadId} />;
}
