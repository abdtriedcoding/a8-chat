import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ThreadView } from "@/components/chat/thread-view";
import { isAuthenticated } from "@/lib/auth-server";
import { withNext } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Chat" };

export default async function ThreadPage(props: PageProps<"/c/[threadId]">) {
  const { threadId } = await props.params;
  if (!(await isAuthenticated())) {
    redirect(withNext("/sign-in", `/c/${threadId}`));
  }
  // Keyed, so switching threads starts from fresh state.
  return <ThreadView key={threadId} threadId={threadId} />;
}
