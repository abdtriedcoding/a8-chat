"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { BlocksIcon } from "lucide-react";
import { ChatHeader } from "@/components/chat/chat-header";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useConnectApp } from "@/hooks/use-connect-app";
import { api } from "../../../convex/_generated/api";
import { ConnectorCard } from "./connector-card";

const NO_CONNECTORS: never[] = [];

/** The catalog of apps, each with its status and Connect or Disconnect. */
export function AppsPage() {
  const { isLoading } = useConvexAuth();
  const catalog = useQuery(api.connections.list, isLoading ? "skip" : {});
  const { connect, waiting, cancel } = useConnectApp(
    catalog?.connectors ?? NO_CONNECTORS,
  );

  return (
    <>
      <ChatHeader>
        <h1 className="px-2 text-sm font-medium">Apps</h1>
      </ChatHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
          <p className="text-sm text-muted-foreground">
            Connect the apps you use, so the assistant can work in them.
          </p>
          {catalog === undefined ? (
            <div
              aria-hidden="true"
              className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            >
              <Skeleton className="h-40 rounded-xl" />
            </div>
          ) : !catalog.available ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BlocksIcon />
                </EmptyMedia>
                <EmptyTitle>Apps aren&apos;t set up</EmptyTitle>
                <EmptyDescription>
                  This server has no vault key, so it can&apos;t store app
                  sign-ins. Chat works as usual.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {catalog.connectors.map((connector) => (
                <ConnectorCard
                  key={connector.handle}
                  connector={connector}
                  waiting={waiting === connector.handle}
                  onConnect={() => void connect(connector)}
                  onCancel={cancel}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
