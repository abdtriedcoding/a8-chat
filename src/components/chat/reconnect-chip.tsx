"use client";

import { useConvexAuth, useQuery } from "convex/react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useConnectConnector } from "@/hooks/use-connect-connector";
import { api } from "../../../convex/_generated/api";
import type { Connector } from "../../../convex/lib/connectors";

/**
 * A button like "Reconnect Notion" that signs in to the connector again.
 * The reply shows it when one of its calls found the connection needing
 * reconnecting. The chip shows only while the connection still needs it,
 * so old replies stop asking once the user reconnects or disconnects.
 */
export function ReconnectChip({ connector }: { connector: Connector }) {
  const { isLoading } = useConvexAuth();
  const connections = useQuery(api.connectors.list, isLoading ? "skip" : {});
  const { connecting, startConnect } = useConnectConnector(connector.id);
  const status = connections?.find(({ id }) => id === connector.id)?.status;
  if (status !== "needs_reconnect") return null;

  return (
    <Button
      variant="outline"
      size="sm"
      className="self-start"
      disabled={connecting}
      onClick={() => void startConnect()}
    >
      {connecting ? (
        <Spinner data-icon="inline-start" />
      ) : (
        // Logos are drawn for a light background, so they get a white one in both themes.
        <span
          data-icon="inline-start"
          className="flex size-4 items-center justify-center rounded-sm bg-white ring-1 ring-foreground/10"
        >
          <Image src={connector.logo} alt="" width={12} height={12} />
        </span>
      )}
      Reconnect {connector.name}
    </Button>
  );
}
