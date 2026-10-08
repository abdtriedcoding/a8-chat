import Image, { type StaticImageData } from "next/image";
import notion from "../../../convex/connectors/notion/logo.svg";

// Each connector's logo lives in its folder next to its manifest
// (convex/connectors). Add new ones here by handle.
const LOGOS: Record<string, StaticImageData> = { notion };

/** A connector's logo on a white tile, so brand colors read in both themes. */
export function ConnectorLogo({
  handle,
  name,
}: {
  handle: string;
  name: string;
}) {
  const logo = LOGOS[handle];
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white text-sm font-semibold text-black ring-1 ring-foreground/10">
      {logo ? (
        <Image src={logo} alt="" className="size-6" />
      ) : (
        <span aria-hidden="true">{name.slice(0, 1)}</span>
      )}
    </span>
  );
}
