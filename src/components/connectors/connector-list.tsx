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
  connectorHandle,
  findConnector,
  type ConnectError,
  type Connector,
} from "../../../convex/lib/connectors";
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

const ERROR_MESSAGES: Record<ConnectError, string> = {
  cancelled: "Sign-in was cancelled, so nothing was connected.",
  expired: "That sign-in expired. Turn the toggle on to try again.",
  misconfigured:
    "This a8 isn't set up to connect that app. Ask whoever runs it to check its settings.",
  unreachable: "The app didn't respond. Please try again in a few minutes.",
  rejected_client:
    "The app didn't accept a8's sign-in. Turn the toggle on to try again.",
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
    (connector) =>
      connector.name.toLowerCase().includes(query) ||
      connectorHandle(connector).toLowerCase().includes(query),
  );
}

/** Whether the user has a connection, working or needing reconnecting. */
function hasConnection(connection: ConnectorStatus | undefined): boolean {
  return connection !== undefined && connection.status !== "disconnected";
}

/**
 * Finishes the sign-in the callback sent the user back with, or shows why
 * it ended early. The code comes from the URL fragment, which is cleared
 * on load.
 */
function useFinishSignIn(callbackParams: CallbackParams, authLoading: boolean) {
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
    if (authLoading) return;
    if (callbackParams && handledError.current !== callbackParams) {
      handledError.current = callbackParams;
      router.replace("/connectors");
      toast.error(ERROR_MESSAGES[callbackParams.error], { id: TOAST_ID });
    }
    const pending = finish.current;
    if (!pending) return;
    finish.current = null;
    toast.loading("Connecting…", { id: TOAST_ID });
    finishConnect(pending)
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
