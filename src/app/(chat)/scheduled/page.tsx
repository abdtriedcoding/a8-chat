import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { ScheduledPromptList } from "@/components/scheduled/scheduled-prompt-list";

export const metadata: Metadata = { title: "Scheduled tasks" };

export default function ScheduledPage() {
  return (
    <PageShell title="Scheduled tasks">
      <p className="text-muted-foreground">
        A scheduled task sends its prompt for you, once or on a repeating
        schedule. Each one has its own chat, and every run goes there.
      </p>
      <ScheduledPromptList />
    </PageShell>
  );
}
