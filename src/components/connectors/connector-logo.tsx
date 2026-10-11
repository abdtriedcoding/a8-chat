import { cn } from "cn";
import Image from "next/image";
import type { ComponentProps } from "react";
import type { ConnectorView } from "../../../convex/lib/connectorView";

/** Each size's tile classes and logo width in pixels. */
const SIZES = {
  xs: { tile: "size-4 rounded-sm", logo: 12 },
  sm: { tile: "size-5 rounded-sm", logo: 14 },
  md: { tile: "size-6 rounded-md", logo: 16 },
  lg: { tile: "size-10 rounded-lg", logo: 24 },
} as const;

/**
 * A connector's logo on a white tile. Logos are drawn for a light
 * background, so the tile is white in both themes. The logo is decorative,
 * so put the connector's name in text next to it.
 */
export function ConnectorLogo({
  connector,
  size,
  className,
  ...props
}: Omit<ComponentProps<"span">, "children"> & {
  connector: Pick<ConnectorView, "logo">;
  size: keyof typeof SIZES;
}) {
  const { tile, logo } = SIZES[size];
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center bg-white ring-1 ring-foreground/10",
        tile,
        className,
      )}
      {...props}
    >
      <Image src={connector.logo} alt="" width={logo} height={logo} />
    </span>
  );
}
