import type { Metadata } from "next";
import { ChatHeader } from "@/components/chat/chat-header";
import { ConnectorList } from "@/components/connectors/connector-list";

export const metadata: Metadata = { title: "Connectors" };

export default function ConnectorsPage() {
  return (
    <>
      <ChatHeader>
        <h1 className="px-2 text-sm font-medium">Connectors</h1>
      </ChatHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
          <p className="text-muted-foreground">
            Connect the apps you work in, and a8 can search, read and write in
            them.
          </p>
          <ConnectorList />
        </div>
      </div>
    </>
  );
}

