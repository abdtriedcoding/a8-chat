"use client";

import { useAction } from "convex/react";
import { SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryWithLocalCopy } from "@/hooks/use-query-with-local-copy";
import { isConnected } from "@/lib/connection-status";
import { CONNECT_TOAST_ID, showConnectResult } from "@/lib/connect-result";
import { takeConnectCallback } from "@/lib/connect-callback";
import { readConnectReturn } from "@/lib/connect-return";
import { searchConnectors } from "@/lib/connector-search";
import { api } from "../../../convex/_generated/api";
import type { ConnectResult } from "../../../convex/connectors";
import { CONNECTOR_VIEWS } from "../../../convex/lib/connectorView";
import { ConnectorCard } from "./connector-card";

export function ConnectorList() {
  // Until they load, the device's copy shows, with the toggles turned off.
  const { data: connections, stale } = useQueryWithLocalCopy(
    api.connectors.list,
    {},
  );
  useFinishSignIn();
  const [search, setSearch] = useState("");

  const cards = searchConnectors(CONNECTOR_VIEWS, search).map((connector) => ({
    connector,
    connection: connections?.find(({ id }) => id === connector.id),
  }));
  const sections = [
    {
      heading: "Connected",
      cards: cards.filter(({ connection }) => isConnected(connection)),
    },
    {
      heading: "Available",
      cards: cards.filter(({ connection }) => !isConnected(connection)),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search connectors"
          aria-label="Search connectors"
        />
      </InputGroup>
      {cards.length === 0 && (
        <p className="text-center text-muted-foreground">
          No connectors match &ldquo;{search.trim()}&rdquo;.
        </p>
      )}
      {/* Until the connections load, a card doesn't know its section. */}
      {connections === undefined && cards.length > 0 && (
        <div aria-hidden="true" className="flex flex-col gap-4">
          <Skeleton className="h-44 w-full rounded-xl" />
          <Skeleton className="h-44 w-full rounded-xl" />
          <Skeleton className="h-44 w-full rounded-xl" />
        </div>
      )}
      {connections !== undefined &&
        sections.map(
          ({ heading, cards }) =>
            cards.length > 0 && (
              <section key={heading} className="flex flex-col gap-3">
                <h2 className="font-heading text-sm font-medium text-muted-foreground">
                  {heading}
                </h2>
                <ul className="flex flex-col gap-4">
                  {cards.map(({ connector, connection }) => (
                    <li key={connector.id}>
                      <ConnectorCard
                        connector={connector}
                        connection={connection}
                        stale={stale}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ),
        )}
    </div>
  );
}

/**
 * Finishes the sign-in the callback sent the user back with, or shows why
 * it ended early. finishConnect only finishes a sign-in for the signed-in
 * user who started it, and the Convex client holds the call until it sends
 * the user's token. A signed-out user signs in first, and the sign-in page
 * holds the callback until they're back (holdConnectCallback). A sign-in
 * started on another page goes back there once it connects
 * (ConnectReturn).
 */
function useFinishSignIn() {
  const router = useRouter();
  const finishConnect = useAction(api.connectors.finishConnect);

  useEffect(() => {
    // Taking the callback clears it, so a second run, like React's in
    // development, finds nothing and can't call finishConnect twice.
    const callback = takeConnectCallback();
    if (!callback) return;
    if ("error" in callback) {
      showConnectResult(callback);
      return;
    }
    toast.loading("Connecting…", { id: CONNECT_TOAST_ID });
    void finishConnect(callback.finish)
      .catch((): ConnectResult => ({ error: "failed" }))
      .then((result) => {
        showConnectResult(result);
        const started = readConnectReturn();
        if (
          "connected" in result &&
          started?.connectorId === result.connected
        ) {
          router.replace(started.path);
        }
      });
  }, [router, finishConnect]);
}
