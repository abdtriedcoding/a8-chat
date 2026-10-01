import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ThreadView } from "@/components/chat/thread-view";
import { isAuthenticated } from "@/lib/auth-server";

export const metadata: Metadata = { title: "Chat" };

export default async function ThreadPage(props: PageProps<"/c/[threadId]">) {
  if (!(await isAuthenticated())) redirect("/sign-in");
  const { threadId } = await props.params;
  // Keyed, so switching threads starts from fresh state.
  return <ThreadView key={threadId} threadId={threadId} />;
}
