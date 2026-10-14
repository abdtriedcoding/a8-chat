import { useAction } from "convex/react";
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { showConnectResult } from "@/lib/connect-result";
import { currentPath, saveConnectReturn } from "@/lib/connect-return";
import { errorMessage } from "@/lib/errors";
import { api } from "../../convex/_generated/api";
import type { ConnectorId } from "../../convex/lib/connectorView";

// The connectors this tab is starting a sign-in to. It lives outside React
// so that every component for a connector, like a card's toggle and its
// Reconnect button, shows the same state.
const starting = new Set<string>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setStarting(connectorId: string, value: boolean) {
  if (value) starting.add(connectorId);
  else starting.delete(connectorId);
  for (const listener of listeners) listener();
}

/**
 * Starts signing in to a connector. The browser goes to the vendor's
 * sign-in and comes back to the Connectors page. A sign-in started on
 * another page returns to that page once it connects (ConnectReturn), and
 * `draft`, the composer's text, goes back in its composer. A connector with
 * no sign-in connects at once, and the browser stays on the page.
 *
 * `connecting` stays true until the browser leaves, until a connector with
 * no sign-in has connected, or until the start fails and shows a toast.
 */
export function useConnectConnector(connectorId: ConnectorId) {
  const connect = useAction(api.connectors.connect);
  const connecting = useSyncExternalStore(
    subscribe,
    () => starting.has(connectorId),
    () => false,
  );

  async function startConnect(draft?: string) {
    if (starting.has(connectorId)) return;
    setStarting(connectorId, true);
    // Read before the await, while the URL is still this event's page.
    const path = currentPath();
    const onConnectorsPage = window.location.pathname === "/connectors";
    try {
      const start = await connect({ connectorId });
      if ("authorizationUrl" in start) {
        // On the Connectors page there's nowhere to return to. A sign-in
        // saved from another page stays, so a draft it holds isn't lost.
        if (!onConnectorsPage) {
          saveConnectReturn({ connectorId, path, draft });
        }
        window.location.assign(start.authorizationUrl);
        return;
      }
      showConnectResult(start);
    } catch (error) {
      toast.error(errorMessage(error));
    }
    setStarting(connectorId, false);
  }

  return { connecting, startConnect };
}
