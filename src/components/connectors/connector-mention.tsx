import type { ConnectorView } from "../../../convex/lib/connectorView";
import { ConnectorLogo } from "./connector-logo";

/**
 * A connector mentioned in a sent prompt: its logo and name in a pill, in
 * place of the @handle the user typed.
 */
export function ConnectorMention({
  connector,
}: {
  connector: Pick<ConnectorView, "logo" | "name">;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-background/70 py-px pr-1.5 pl-0.5 align-bottom font-medium ring-1 ring-foreground/10">
      <ConnectorLogo connector={connector} size="xs" />
      {connector.name}
    </span>
  );
}
