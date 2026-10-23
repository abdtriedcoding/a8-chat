"use client";

import { useAction } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
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
import { isConnected } from "@/lib/connection-status";
import { CONNECT_TOAST_ID, showConnectResult } from "@/lib/connect-result";
import { readConnectReturn } from "@/lib/connect-return";
import { searchConnectors } from "@/lib/connector-search";
import { api } from "../../../convex/_generated/api";
import type { ConnectResult } from "../../../convex/connectors";
import {
  CONNECT_ERRORS,
  CONNECTOR_VIEWS,
  type ConnectError,
} from "../../../convex/lib/connectorView";
import { ConnectorCard } from "./connector-card";

/** What the callback's redirect put in the URL fragment. */
type Callback =
  | { finish: { state: string; code: string; iss?: string } }
  | { error: ConnectError };

/** Reads the fragment, then removes it so the code leaves the URL and history. */
function takeCallbackFromHash(): Callback | null {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const error = CONNECT_ERRORS.find((code) => code === fragment.get("error"));
  const state = fragment.get("finish");
  const code = fragment.get("code");
  let callback: Callback | null = null;
  if (error) callback = { error };
  else if (state !== null && code !== null) {
    callback = {
      finish: { state, code, iss: fragment.get("iss") ?? undefined },
    };
  }
  if (callback) {
    window.history.replaceState(null, "", window.location.pathname);
  }
  return callback;
}

export function ConnectorList() {
  const connections = useQuery(api.connectors.list, {});
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
                        key={connection?.connectedAt}
                        connector={connector}
                        connection={connection}
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
 * the user's token. A sign-in started on another page goes back there once
 * it connects (ConnectReturn).
 */
function useFinishSignIn() {
  const router = useRouter();
  const finishConnect = useAction(api.connectors.finishConnect);

  useEffect(() => {
    // Taking the fragment clears it, so a second run, like React's in
    // development, finds nothing and can't call finishConnect twice.
    const callback = takeCallbackFromHash();
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
