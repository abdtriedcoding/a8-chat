"use client";

import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";

/**
 * "Skip to message box", the first Tab stop on /chat and on a thread. It's
 * hidden until focused, and moves focus past the sidebar to the composer.
 */
export function SkipLink() {
  const pathname = usePathname();
  if (pathname !== "/chat" && !pathname.startsWith("/c/")) return null;
  return (
    <Button
      asChild
      variant="outline"
      className="fixed top-2 left-2 z-50 not-focus:sr-only"
    >
      <a
        href="#"
        onClick={(event) => {
          event.preventDefault();
          document
            .querySelector<HTMLTextAreaElement>("[data-composer]")
            ?.focus();
        }}
      >
        Skip to message box
      </a>
    </Button>
  );
}
