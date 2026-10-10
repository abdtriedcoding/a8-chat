import type { Metadata } from "next";
import { ThreadView } from "@/components/chat/thread-view";

export const metadata: Metadata = { title: "Chat" };

export default async function ThreadPage(props: PageProps<"/c/[threadId]">) {
  const { threadId } = await props.params;
  // Keyed, so switching threads starts from fresh state.
  return <ThreadView key={threadId} threadId={threadId} />;
}
