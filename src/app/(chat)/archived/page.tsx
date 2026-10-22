import type { Metadata } from "next";
import { ArchivedThreadList } from "@/components/archived-thread-list";
import { ChatHeader } from "@/components/chat/chat-header";

export const metadata: Metadata = { title: "Archived chats" };

export default function ArchivedChatsPage() {
  return (
    <>
      <ChatHeader>
        <h1 className="px-2 text-sm font-medium">Archived chats</h1>
      </ChatHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
          <p className="text-muted-foreground">
            Archived chats stay out of the sidebar. Open one to read it, or
            send a message in it to move it back.
          </p>
          <ArchivedThreadList />
        </div>
      </div>
    </>
  );
}
