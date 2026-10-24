import type { Metadata } from "next";
import { ThreadView } from "@/components/chat/thread-view";

// ThreadView sets the thread's title itself once the thread shows, so this
// needs no query.
export const metadata: Metadata = { title: "Chat" };

export default async function ThreadPage(props: PageProps<"/c/[threadId]">) {
  const { threadId } = await props.params;
  return <ThreadView key={threadId} threadId={threadId} />;
}
