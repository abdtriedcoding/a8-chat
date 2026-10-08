"use client";

import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { CheckIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/errors";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { ConnectorLogo } from "./connector-logo";

export type CatalogEntry = FunctionReturnType<
  typeof api.connections.list
>["connectors"][number];

/**
 * One connector in the Apps grid: its logo, name, description and status,
 * with Connect, Reconnect or Disconnect. Connect first shows what access
 * the app asks for.
 */
export function ConnectorCard({
  connector,
  waiting,
  onConnect,
  onCancel,
}: {
  connector: CatalogEntry;
  /** Whether this app's sign-in is open and hasn't reported back. */
  waiting: boolean;
  onConnect: () => void;
  onCancel: () => void;
}) {
  const [confirmingConnect, setConfirmingConnect] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const { status, connectionId } = connector;

  return (
    <Card size="sm">
      <CardHeader className="gap-3">
        <div className="flex items-center gap-3">
          <ConnectorLogo handle={connector.handle} name={connector.name} />
          <div className="flex min-w-0 flex-col items-start gap-1">
            <CardTitle className="truncate">{connector.name}</CardTitle>
            <StatusBadge status={status} />
          </div>
        </div>
        <CardDescription>{connector.description}</CardDescription>
      </CardHeader>
      <CardFooter className="mt-auto flex-wrap gap-2">
        {waiting ? (
          <>
            <Button variant="outline" size="sm" disabled>
              <Spinner data-icon="inline-start" />
              Waiting for sign-in
            </Button>
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            {status !== "connected" && (
              <Button
                variant={status === "needsReconnect" ? "default" : "outline"}
                size="sm"
                onClick={() => setConfirmingConnect(true)}
              >
                {status === "needsReconnect" ? "Reconnect" : "Connect"}
              </Button>
            )}
            {connectionId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmingDisconnect(true)}
              >
                Disconnect
              </Button>
            )}
          </>
        )}
      </CardFooter>
      <ConnectDialog
        connector={connector}
        open={confirmingConnect}
        onOpenChange={setConfirmingConnect}
        onContinue={() => {
          setConfirmingConnect(false);
          onConnect();
        }}
      />
      {connectionId && (
        <DisconnectDialog
          name={connector.name}
          connectionId={connectionId}
          open={confirmingDisconnect}
          onOpenChange={setConfirmingDisconnect}
        />
      )}
    </Card>
  );
}

function StatusBadge({ status }: { status: CatalogEntry["status"] }) {
  switch (status) {
    case "connected":
      return (
        <Badge variant="secondary">
          <CheckIcon data-icon="inline-start" />
          Connected
        </Badge>
      );
    case "needsReconnect":
      return (
        <Badge variant="destructive">
          <TriangleAlertIcon data-icon="inline-start" />
          Needs reconnect
        </Badge>
      );
    case "notConnected":
      return <Badge variant="outline">Not connected</Badge>;
  }
}

/** What the app asks for, shown before the sign-in opens. */
function ConnectDialog({
  connector,
  open,
  onOpenChange,
  onContinue,
}: {
  connector: CatalogEntry;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onContinue: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-3">
            <ConnectorLogo handle={connector.handle} name={connector.name} />
            <DialogTitle>Connect {connector.name}</DialogTitle>
          </div>
          <DialogDescription>
            You&apos;ll sign in to {connector.name} next. After that, a8 can:
          </DialogDescription>
        </DialogHeader>
        <ul className="flex list-disc flex-col gap-1.5 pl-5">
          {connector.access.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={onContinue}>Continue to {connector.name}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DisconnectDialog({
  name,
  connectionId,
  open,
  onOpenChange,
}: {
  name: string;
  connectionId: Id<"connections">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const disconnect = useAction(api.connections.disconnect);
  const [disconnecting, setDisconnecting] = useState(false);

  async function confirmDisconnect() {
    setDisconnecting(true);
    try {
      const refused = await disconnect({ connectionId });
      if (refused) toast.error(refused.message);
      else toast.success(`${name} is disconnected.`);
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!disconnecting) onOpenChange(next);
      }}
    >
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Disconnect {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            a8 signs out of {name} and can&apos;t reach it until you connect it
            again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={disconnecting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={disconnecting}
            onClick={(event) => {
              // Stay open until the disconnect lands, so a failure can show.
              event.preventDefault();
              void confirmDisconnect();
            }}
          >
            {disconnecting && <Spinner data-icon="inline-start" />}
            Disconnect
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
