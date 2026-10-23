"use client";

import { cloneElement, type ReactElement, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useConnectConnector } from "@/hooks/use-connect-connector";
import type { ConnectorView } from "../../../convex/lib/connectorView";
import { ConnectorLogo } from "./connector-logo";

/** The props ReconnectButton sets on the button it renders. */
type ButtonElement = ReactElement<{
  disabled?: boolean;
  onClick?: () => void;
  children?: ReactNode;
}>;

/**
 * A button that signs in to the connector again, like "Reconnect Notion".
 * The Connectors page card, a thread's Reconnect chip and the composer's
 * blocked-mention banner all use it, and the banner also labels it
 * "Connect" for a connector that isn't connected. A sign-in started outside
 * the Connectors page comes back to the page it started on, with `draft`
 * back in the composer (useConnectConnector).
 *
 * `render` is the button to show, with its variant and size. `logo` puts
 * the connector's logo before the label. `disabled` turns it off. A spinner takes the logo's place
 * while the browser leaves for the vendor.
 */
export function ReconnectButton({
  connector,
  draft,
  disabled = false,
  logo = false,
  render = <Button variant="outline" size="sm" />,
  children = `Reconnect ${connector.name}`,
}: {
  connector: ConnectorView;
  draft?: string;
  disabled?: boolean;
  logo?: boolean;
  render?: ButtonElement;
  children?: ReactNode;
}) {
  const { connecting, startConnect } = useConnectConnector(connector.id);
  return cloneElement(render, {
    disabled: disabled || connecting,
    onClick: () => void startConnect(draft),
    children: (
      <>
        {connecting ? (
          <Spinner data-icon="inline-start" />
        ) : (
          logo && (
            <ConnectorLogo
              connector={connector}
              size="xs"
              data-icon="inline-start"
            />
          )
        )}
        {children}
      </>
    ),
  });
}
