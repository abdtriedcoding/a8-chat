"use client";

import { ReconnectButton } from "@/components/connectors/reconnect-button";
import { Button } from "@/components/ui/button";
import { useQueryWithLocalCopy } from "@/hooks/use-query-with-local-copy";
import { api } from "../../../convex/_generated/api";
import type { ConnectorView } from "../../../convex/lib/connectorView";

/**
 * A button like "Reconnect Notion" that signs in to the connector again.
 * The reply shows it when one of its calls found the connection needing
 * reconnecting. The chip shows only while the connection still needs it,
 * so old replies stop asking once the user reconnects or disconnects.
 */
export function ReconnectChip({ connector }: { connector: ConnectorView }) {
  const { data, stale } = useQueryWithLocalCopy(api.connectors.list, {});
  const status = data?.find(({ id }) => id === connector.id)?.status;
  if (status !== "needs_reconnect") return null;

  return (
    <ReconnectButton
      connector={connector}
      // A status from the device's copy may be out of date.
      disabled={stale}
      logo
      render={<Button variant="outline" size="sm" className="self-start" />}
    />
  );
}
