import type { Metadata } from "next";
import { ArchivedThreadList } from "@/components/archived-thread-list";
import { PageShell } from "@/components/page-shell";

export const metadata: Metadata = { title: "Archived chats" };

export default function ArchivedChatsPage() {
  return (
    <PageShell title="Archived chats">
      <p className="text-muted-foreground">
        Archived chats stay out of the sidebar. Open one to read it, or
        send a message in it to move it back.
      </p>
      <ArchivedThreadList />
    </PageShell>
  );
}
