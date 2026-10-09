import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChatHeader } from "@/components/chat/chat-header";
import { ConnectorCard } from "@/components/connectors/connector-card";
import { isAuthenticated } from "@/lib/auth-server";
import { CONNECTORS } from "../../../../convex/lib/connectors";

export const metadata: Metadata = { title: "Connectors" };

export default async function ConnectorsPage() {
  if (!(await isAuthenticated())) redirect("/sign-in");
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
          <ul className="flex flex-col gap-4">
            {CONNECTORS.map((connector) => (
              <li key={connector.id}>
                <ConnectorCard connector={connector} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
