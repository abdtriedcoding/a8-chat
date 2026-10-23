"use client";

import { useAction } from "convex/react";
import { InfoIcon, MessageSquareIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useConfirm } from "@/hooks/use-confirm";
import { useConnectConnector } from "@/hooks/use-connect-connector";
import { isConnected } from "@/lib/connection-status";
import { api } from "../../../convex/_generated/api";
import type { ConnectorStatus } from "../../../convex/connectors";
import type { ConnectorView } from "../../../convex/lib/connectorView";
import { ConnectorLogo } from "./connector-logo";
import { ReconnectButton } from "./reconnect-button";

/**
 * One catalog entry on the Connectors page. Turning the toggle on sends the
 * browser to the vendor's sign-in. Turning it off opens a confirm dialog,
 * and Cancel there leaves the toggle on. Either way, focus goes back to the
 * toggle. The example prompt opens a new chat with that prompt in the
 * composer, unsent. A connection that needs reconnecting shows a Reconnect
 * button, which signs in again, and so does one missing a scope the user
 * unticked at sign-in. A connector the deployment hasn't set up has no
 * toggle and links to its setup guide. A catalog card note shows under the
 * description.
 *
 * `connection` is undefined until the user's connections load.
 */
export function ConnectorCard({
  connector,
  connection,
  stale = false,
}: {
  connector: ConnectorView;
  connection: ConnectorStatus | undefined;
  /** Whether `connection` is the device's copy, which turns the toggle off. */
  stale?: boolean;
}) {
  const { id, name, handle, description, examplePrompt, cardNote, setupGuide } =
    connector;
  const { connecting, startConnect } = useConnectConnector(id);
  const disconnect = useAction(api.connectors.disconnect);
  const [confirmDialog, confirm] = useConfirm();
  // Called when the card unmounts, which a disconnect waits for.
  const onUnmount = useRef<() => void>(null);
  useEffect(() => () => onUnmount.current?.(), []);
  const connected = isConnected(connection);
  const needsReconnect = connected && connection?.status === "needs_reconnect";
  const missingScopes =
    connected && !needsReconnect && connection?.missingScopes === true;
  const notSetUp = connection?.setUp === false;
  // After a disconnect, focus goes to the remounted card's switch, which a
  // ref to this one can't reach.
  const switchId = `connector-switch-${id}`;

  function confirmDisconnect() {
    void confirm({
      title: `Disconnect ${name}?`,
      description:
        "a8 will lose access, and scheduled tasks that use it will run without it.",
      confirmLabel: "Disconnect",
      destructive: true,
      returnFocus: () => document.getElementById(switchId),
      onConfirm: async () => {
        const { revoked } = await disconnect({ connectorId: id });
        if (revoked) {
          toast.success(`${name} is disconnected.`);
        } else {
          toast.warning(
            `${name} is disconnected, but a8 couldn't revoke its access in ${name}. You can remove a8 in ${name}'s connection settings.`,
          );
        }
        // The dialog stays open until the list query drops the connection,
        // which can land after the action returns. The card moves to
        // Available then and remounts, taking the dialog with it. If it
        // already has, this never resolves, and nothing is left to update.
        await new Promise<void>((resolve) => {
          onUnmount.current = resolve;
        });
      },
    });
  }

  return (
    <Card size="sm">
      <CardHeader className="flex items-center gap-3">
        <ConnectorLogo connector={connector} size="lg" />
        <div className="min-w-0 flex-1">
          <h3 className="font-heading font-medium">{name}</h3>
          <p className="truncate text-muted-foreground">
            @{handle}
            {connected && <> · {connection?.accountLabel ?? "Connected"}</>}
            {notSetUp && !connected && <> · Not set up</>}
          </p>
        </div>
        {notSetUp && !connected ? (
          setupGuide && (
            <Button variant="outline" size="sm" asChild>
              <a href={setupGuide} target="_blank" rel="noreferrer">
                Setup guide
              </a>
            </Button>
          )
        ) : (
          <Switch
            id={switchId}
            checked={connected || connecting}
            disabled={connection === undefined || stale || connecting}
            onCheckedChange={(checked) => {
              if (checked) void startConnect();
              else confirmDisconnect();
            }}
            aria-label={`${name} connection`}
          />
        )}
        {confirmDialog}
      </CardHeader>
      <CardContent>
        {needsReconnect && (
          <ReconnectAlert
            connector={connector}
            variant="destructive"
            title="Needs reconnecting"
          >
            {name} stopped accepting a8&apos;s access.
          </ReconnectAlert>
        )}
        {missingScopes && (
          <ReconnectAlert connector={connector} title="Some permissions missing">
            Some of {name}&apos;s tools are off, because a permission
            wasn&apos;t allowed at sign-in.
          </ReconnectAlert>
        )}
        <div className="flex flex-col gap-1">
          <p>{description}</p>
          {cardNote && (
            <p className="flex items-start gap-1.5 text-muted-foreground">
              <InfoIcon className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 break-words">
                {cardNote.text}
                {cardNote.link && (
                  <>
                    {" "}
                    <a
                      href={cardNote.link.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-foreground underline underline-offset-4"
                    >
                      {cardNote.link.label}
                    </a>
                  </>
                )}
              </span>
            </p>
          )}
        </div>
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

/** An alert on the card about the connection, with a Reconnect button. */
function ReconnectAlert({
  connector,
  variant,
  title,
  children,
}: {
  connector: ConnectorView;
  variant?: "destructive";
  title: string;
  children: ReactNode;
}) {
  return (
    <Alert variant={variant} className="mb-3">
      <TriangleAlertIcon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
      <AlertAction>
        <ReconnectButton connector={connector} render={<Button size="sm" />}>
          Reconnect
        </ReconnectButton>
      </AlertAction>
    </Alert>
  );
}
