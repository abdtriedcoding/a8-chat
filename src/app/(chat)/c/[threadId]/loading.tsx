import { ChatHeader } from "@/components/chat/chat-header";
import { ConversationSkeleton } from "@/components/chat/conversation-skeleton";

// Next prefetches this in production, so a click on a thread link shows the
// new URL and this skeleton at once, before the page's server response.
export default function ThreadLoading() {
  return (
    <>
      <ChatHeader />
      <ConversationSkeleton />
    </>
  );
}
