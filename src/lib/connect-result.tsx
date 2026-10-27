import { toast } from "sonner";
import { Avatar, AvatarImage } from "@/components/ui/avatar";
import type { ConnectResult } from "../../convex/connectors";
import {
  findConnectorView,
  type ConnectError,
  type ConnectorView,
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
 * connector with no sign-in. When the result names the account, the toast
 * shows its avatar and stays until dismissed, with a Disconnect button that
 * calls `disconnect`. A vendor may skip its consent screen for an account
 * the browser is already signed in to, which on a shared browser is
 * someone else's.
 */
export function showConnectResult(
  result: ConnectResult,
  disconnect?: (connector: ConnectorView) => void,
) {
  if ("error" in result) {
    toast.error(CONNECT_ERROR_MESSAGES[result.error], {
      id: CONNECT_TOAST_ID,
    });
    return;
  }
  const connector = findConnectorView(result.connected);
  const name = connector?.name;
  const { account } = result;
  if (connector && account && disconnect) {
    toast.success(`${connector.name} is connected as ${account.label}.`, {
      id: CONNECT_TOAST_ID,
      icon: account.avatarUrl && (
        <Avatar className="size-5">
          <AvatarImage src={account.avatarUrl} alt="" />
        </Avatar>
      ),
      description: "Not you?",
      duration: Infinity,
      action: { label: "Disconnect", onClick: () => disconnect(connector) },
    });
    return;
  }
  toast.success(name ? `${name} is connected.` : "Connected.", {
    id: CONNECT_TOAST_ID,
  });
}

/** Shows how a disconnect ended, and whether a8 revoked its access at the app. */
export function showDisconnectResult(name: string, revoked: boolean) {
  if (revoked) {
    toast.success(`${name} is disconnected.`);
  } else {
    toast.warning(
      `${name} is disconnected, but a8 couldn't revoke its access in ${name}. You can remove a8 in ${name}'s connection settings.`,
    );
  }
}
