import { toast } from "sonner";
import type { ConnectResult } from "../../convex/connectors";
import {
  findConnectorView,
  type ConnectError,
} from "../../convex/lib/connectorView";

const CONNECT_ERROR_MESSAGES: Record<ConnectError, string> = {
  cancelled: "Sign-in was cancelled, so nothing was connected.",
  expired: "That sign-in expired. Turn the toggle on to try again.",
  misconfigured:
    "This a8 isn't set up to connect that app. Ask whoever runs it to check its settings.",
  unreachable: "The app didn't respond. Please try again in a few minutes.",
  rejected_client:
    "The app didn't accept a8's sign-in. Turn the toggle on to try again.",
  rejected_code:
    "The app didn't accept that sign-in. Turn the toggle on to try again.",
  failed: "Couldn't connect. Please try again.",
};

/** A fixed id, so each step of a sign-in replaces the last one's toast. */
export const CONNECT_TOAST_ID = "connector-sign-in";

/**
 * Shows how connecting ended, after a sign-in or after turning on a
 * connector with no sign-in.
 */
export function showConnectResult(result: ConnectResult) {
  if ("error" in result) {
    toast.error(CONNECT_ERROR_MESSAGES[result.error], {
      id: CONNECT_TOAST_ID,
    });
    return;
  }
  const name = findConnectorView(result.connected)?.name;
  toast.success(name ? `${name} is connected.` : "Connected.", {
    id: CONNECT_TOAST_ID,
  });
}
