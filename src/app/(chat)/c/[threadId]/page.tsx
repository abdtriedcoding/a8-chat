import type { Metadata } from "next";
import { ThreadView } from "@/components/chat/thread-view";
import { fetchAuthQuery, requireSignedIn } from "@/lib/auth-server";
import { api } from "../../../../../convex/_generated/api";

// A temporary thread's tab doesn't show a title made from the prompt.
export async function generateMetadata(
  props: PageProps<"/c/[threadId]">,
): Promise<Metadata> {
  const { threadId } = await props.params;
  const thread = await fetchAuthQuery(api.threads.get, { threadId });
  return { title: thread?.temporary ? "Temporary chat" : "Chat" };
}

export default async function ThreadPage(props: PageProps<"/c/[threadId]">) {
  await requireSignedIn();
  const { threadId } = await props.params;
  return <ThreadView key={threadId} threadId={threadId} />;
}
