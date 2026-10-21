import { cn } from "cn";
import type { ComponentProps } from "react";
import { LABS, labName, type Lab } from "../../../convex/lib/models";

/**
 * A lab's logo, in the text's color. The logos in public/labs are
 * one-color SVGs (scripts/sync-models.ts), drawn here as a mask so they
 * follow the theme. A lab without one gets its first letter. The logo is
 * decorative, so put the lab or model name in text next to it.
 */
export function LabLogo({
  lab,
  className,
  ...props
}: Omit<ComponentProps<"span">, "children"> & { lab: Lab }) {
  if (LABS.find((entry) => entry.id === lab)?.logo) {
    const mask = `url(/labs/${lab}.svg) center / contain no-repeat`;
    return (
      <span
        aria-hidden
        className={cn("size-4 shrink-0 bg-current", className)}
        style={{ mask, WebkitMask: mask }}
        {...props}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-sm bg-muted text-[0.625rem] leading-none font-semibold uppercase",
        className,
      )}
      {...props}
    >
      {labName(lab).charAt(0)}
    </span>
  );
}
