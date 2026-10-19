import type { Metadata } from "next";
import { ChatHeader } from "@/components/chat/chat-header";
import { ScheduledPromptList } from "@/components/scheduled/scheduled-prompt-list";
import { requireSignedIn } from "@/lib/auth-server";

export const metadata: Metadata = { title: "Scheduled tasks" };

export default async function ScheduledPage() {
  await requireSignedIn();
  return (
    <>
      <ChatHeader>
        <h1 className="px-2 text-sm font-medium">Scheduled tasks</h1>
      </ChatHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
          <p className="text-muted-foreground">
            A scheduled task sends its prompt for you, once or on a repeating
            schedule. Each one has its own chat, and every run goes there.
          </p>
          <ScheduledPromptList />
        </div>
      </div>
    </>
  );
}
