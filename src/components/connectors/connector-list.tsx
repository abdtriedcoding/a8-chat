"use client";

import { useAction, useConvexAuth } from "convex/react";
import { SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { isConnected, useConnections } from "@/hooks/use-connections";
import { CONNECT_TOAST_ID, showConnectResult } from "@/lib/connect-result";
import { readConnectReturn } from "@/lib/connect-return";
import { searchConnectors } from "@/lib/connector-search";
import { api } from "../../../convex/_generated/api";
import type { ConnectResult } from "../../../convex/connectors";
import {
  CONNECTOR_VIEWS,
  type ConnectError,
} from "../../../convex/lib/connectorView";
import { ConnectorCard } from "./connector-card";

/** Why the sign-in callback's redirect says the sign-in ended early, if it did. */
export type CallbackParams = { error: ConnectError } | undefined;

/** What the callback's redirect put in the URL fragment. */
type Finish = { state: string; code: string; iss?: string };

/** Reads the fragment, then removes it so the code leaves the URL and history. */
function takeFinishFromHash(): Finish | null {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const state = fragment.get("finish");
  const code = fragment.get("code");
  if (state === null || code === null) return null;
  window.history.replaceState(null, "", window.location.pathname);
  return { state, code, iss: fragment.get("iss") ?? undefined };
}

/**
 * The catalog with the user's connection status, under a search box that
 * filters by name or handle. Cards with a connection, including ones that
 * need reconnecting, go under Connected and the rest under Available.
 * Until the query loads, every card renders from the catalog in one list
 * with no heading.
 */
export function ConnectorList({
  callbackParams,
}: {
  callbackParams: CallbackParams;
}) {
  const connections = useConnections();
  useFinishSignIn(callbackParams);
  const [search, setSearch] = useState("");

  const cards = searchConnectors(CONNECTOR_VIEWS, search).map((connector) => ({
    connector,
    connection: connections?.find(({ id }) => id === connector.id),
  }));
  const sections: { heading?: string; cards: typeof cards }[] = connections
    ? [
        {
          heading: "Connected",
          cards: cards.filter(({ connection }) => isConnected(connection)),
        },
        {
          heading: "Available",
          cards: cards.filter(({ connection }) => !isConnected(connection)),
        },
      ]
    : [{ cards }];

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
      {sections.map(
        ({ heading, cards }) =>
          cards.length > 0 && (
            <section key={heading ?? "all"} className="flex flex-col gap-3">
              {heading && (
                <h2 className="font-heading text-sm font-medium text-muted-foreground">
                  {heading}
                </h2>
              )}
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
 * it ended early. The code comes from the URL fragment, which is cleared
 * on load. A sign-in started on another page goes back there once it
 * connects (ConnectReturn).
 */
function useFinishSignIn(callbackParams: CallbackParams) {
  const { isAuthenticated } = useConvexAuth();
  const router = useRouter();
  const finishConnect = useAction(api.connectors.finishConnect);
  // finishConnect deletes the sign-in, so a second call would report it
  // expired. React can run an effect twice in development, and the first run
  // clears the fragment, so the second must keep what the first read.
  const finish = useRef<Finish | null>(null);
  const handledError = useRef<CallbackParams>(undefined);

  useEffect(() => {
    finish.current ??= takeFinishFromHash();
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (callbackParams && handledError.current !== callbackParams) {
      handledError.current = callbackParams;
      router.replace("/connectors");
      showConnectResult(callbackParams);
    }
    const pending = finish.current;
    if (!pending) return;
    finish.current = null;
    toast.loading("Connecting…", { id: CONNECT_TOAST_ID });
    void finishConnect(pending)
      .catch((): ConnectResult => ({ error: "failed" }))
      .then((result) => {
        showConnectResult(result);
        const started = readConnectReturn();
        if ("connected" in result && started?.connectorId === result.connected) {
          router.replace(started.path);
        }
      });
  }, [callbackParams, isAuthenticated, router, finishConnect]);
}
