"use client";

import { useAction } from "convex/react";
import { MessageSquareIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { errorMessage } from "@/lib/errors";
import { api } from "../../../convex/_generated/api";
import type { ConnectorStatus } from "../../../convex/connectors";
import type { Connector } from "../../../convex/lib/connectors";

/**
 * One catalog entry on the Connectors page. Turning the toggle on sends the
 * browser to the vendor's sign-in, and turning it off disconnects. The
 * example prompt opens a new chat with that prompt in the composer, unsent.
 *
 * `connection` is undefined until the user's connections load.
 */
export function ConnectorCard({
  connector,
  connection,
}: {
  connector: Connector;
  connection: ConnectorStatus | undefined;
}) {
  const { id, name, handle, logo, description, examplePrompt } = connector;
  const connect = useAction(api.connectors.connect);
  const disconnect = useAction(api.connectors.disconnect);
  const [connecting, setConnecting] = useState(false);
  // connectedAt of the connection being disconnected. The toggle shows off
  // from the click until the list query drops the connection, which can
  // land after the action returns.
  const [disconnectingConnectedAt, setDisconnectingConnectedAt] = useState<number>();
  const connected =
    connection !== undefined && connection.status !== "disconnected";
  const disconnecting =
    connected &&
    disconnectingConnectedAt !== undefined &&
    connection.connectedAt === disconnectingConnectedAt;

  async function startConnect() {
    setConnecting(true);
    try {
      window.location.assign(await connect({ connectorId: id }));
    } catch (error) {
      toast.error(errorMessage(error));
      setConnecting(false);
    }
  }

  async function startDisconnect() {
    setDisconnectingConnectedAt(connection?.connectedAt);
    try {
      const { revoked } = await disconnect({ connectorId: id });
      if (revoked) {
        toast.success(`${name} is disconnected.`);
      } else {
        toast.warning(
          `${name} is disconnected, but a8 couldn't revoke its access in ${name}. You can remove a8 in ${name}'s connection settings.`,
        );
      }
    } catch (error) {
      toast.error(errorMessage(error));
      setDisconnectingConnectedAt(undefined);
    }
  }

  return (
    <Card size="sm">
      <CardHeader className="flex items-center gap-3">
        {/* Logos are drawn for a light background, so they get a white one in both themes. */}
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-foreground/10">
          <Image src={logo} alt="" width={24} height={24} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-heading font-medium">{name}</h2>
          <p className="truncate text-muted-foreground">
            @{handle}
            {connected && !disconnecting && (
              <> · {connection.accountLabel ?? "Connected"}</>
            )}
          </p>
        </div>
        <Switch
          checked={(connected && !disconnecting) || connecting}
          disabled={connection === undefined || connecting || disconnecting}
          onCheckedChange={(checked) => {
            if (checked) void startConnect();
            else void startDisconnect();
          }}
          aria-label={`${name} connection`}
        />
      </CardHeader>
      <CardContent>
        <p>{description}</p>
        <Link
          href={`/chat?prompt=${encodeURIComponent(examplePrompt)}`}
          className="flex items-start gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-left outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <MessageSquareIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 break-words">{examplePrompt}</span>
        </Link>
      </CardContent>
    </Card>
  );
}
