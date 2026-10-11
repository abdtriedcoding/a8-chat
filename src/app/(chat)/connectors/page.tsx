import type { Metadata } from "next";
import { ChatHeader } from "@/components/chat/chat-header";
import {
  ConnectorList,
  type CallbackParams,
} from "@/components/connectors/connector-list";
import {
  CONNECT_ERRORS,
  type ConnectError,
} from "../../../../convex/lib/connectorView";

export const metadata: Metadata = { title: "Connectors" };

export default async function ConnectorsPage(props: PageProps<"/connectors">) {
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
          <ConnectorList
            callbackParams={parseCallbackParams(await props.searchParams)}
          />
        </div>
      </div>
    </>
  );
}

/** The sign-in callback's redirect adds `?error=<code>` if the sign-in ended early. */
function parseCallbackParams(
  params: Record<string, string | string[] | undefined>,
): CallbackParams {
  const { error } = params;
  if (isConnectError(error)) return { error };
  return undefined;
}

function isConnectError(value: unknown): value is ConnectError {
  return CONNECT_ERRORS.some((error) => error === value);
}
