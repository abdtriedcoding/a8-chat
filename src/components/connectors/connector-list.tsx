"use client";

import { useAction, useConvexAuth, useQuery } from "convex/react";
import { SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { api } from "../../../convex/_generated/api";
import type {
  ConnectorStatus,
  ConnectResult,
} from "../../../convex/connectors";
import {
  CONNECTORS,
  findConnector,
  type ConnectError,
  type Connector,
} from "../../../convex/lib/connectors";
import { ConnectorCard } from "./connector-card";

/**
 * What the sign-in callback's redirect put in the page's search params: a
 * sign-in to finish, or why it ended early.
 */
export type CallbackParams =
  | { finish: string }
  | { error: ConnectError }
  | undefined;

const ERROR_MESSAGES: Record<ConnectError, string> = {
  cancelled: "Sign-in was cancelled, so nothing was connected.",
  expired: "That sign-in expired. Turn the toggle on to try again.",
  failed: "Couldn't connect. Please try again.",
};

/** A fixed id, so each step of a sign-in replaces the last one's toast. */
const TOAST_ID = "connector-sign-in";

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
  const { isLoading } = useConvexAuth();
  const connections = useQuery(api.connectors.list, isLoading ? "skip" : {});
  useFinishSignIn(callbackParams, isLoading);
  const [search, setSearch] = useState("");

  const cards = matchingConnectors(search).map((connector) => ({
    connector,
    connection: connections?.find(({ id }) => id === connector.id),
  }));
  const sections: { heading?: string; cards: typeof cards }[] = connections
    ? [
        {
          heading: "Connected",
          cards: cards.filter(({ connection }) => hasConnection(connection)),
        },
        {
          heading: "Available",
          cards: cards.filter(({ connection }) => !hasConnection(connection)),
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
 * The connectors whose name or handle contains the search, in catalog
 * order. A leading @ is ignored, so `@no` finds Notion.
 */
function matchingConnectors(search: string): Connector[] {
  const query = search.trim().replace(/^@/, "").toLowerCase();
  return CONNECTORS.filter(
    ({ name, handle }) =>
      name.toLowerCase().includes(query) ||
      handle.toLowerCase().includes(query),
  );
}

/** Whether the user has a connection, working or needing reconnecting. */
function hasConnection(connection: ConnectorStatus | undefined): boolean {
  return connection !== undefined && connection.status !== "disconnected";
}

/**
 * Finishes the sign-in the callback sent the user back with, or shows why
 * it ended early. Then drops the params from the URL.
 */
function useFinishSignIn(callbackParams: CallbackParams, authLoading: boolean) {
  const router = useRouter();
  const finishConnect = useAction(api.connectors.finishConnect);
  // finishConnect deletes the sign-in, so a second call would report it
  // expired. React can run an effect twice in development.
  const handled = useRef<CallbackParams>(undefined);

  useEffect(() => {
    if (!callbackParams || authLoading || handled.current === callbackParams) {
      return;
    }
    handled.current = callbackParams;
    router.replace("/connectors");
    if ("error" in callbackParams) {
      toast.error(ERROR_MESSAGES[callbackParams.error], { id: TOAST_ID });
      return;
    }
    toast.loading("Connecting…", { id: TOAST_ID });
    finishConnect({ state: callbackParams.finish })
      .catch((): ConnectResult => ({ error: "failed" }))
      .then(showResult);
  }, [callbackParams, authLoading, router, finishConnect]);
}

function showResult(result: ConnectResult) {
  if ("error" in result) {
    toast.error(ERROR_MESSAGES[result.error], { id: TOAST_ID });
    return;
  }
  const name = findConnector(result.connected)?.name;
  toast.success(name ? `${name} is connected.` : "Connected.", {
    id: TOAST_ID,
  });
}
