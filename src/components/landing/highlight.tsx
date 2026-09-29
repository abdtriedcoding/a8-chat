import type { ReactNode } from "react";

/** Words set in the brand color on a slightly tilted marker. */
export function Highlight({ children }: { children: ReactNode }) {
  return (
    <span className="relative isolate inline-block px-[0.12em] text-primary">
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-[0.1em] bottom-[0.02em] -z-10 -rotate-1 bg-highlight"
      />
      {children}
    </span>
  );
}

/** An @mention, styled the way the composer shows it. */
export function Mention({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md bg-highlight px-1 py-0.5 font-medium text-primary">
      {children}
    </span>
  );
}
