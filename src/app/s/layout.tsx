import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import { PublicConvexProvider } from "../PublicConvexProvider";

// Shared links are for the people they're sent to, not for search results.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/** Shared snapshot pages: public, outside the chat layout and sign-in. */
export default function SharedLayout({ children }: { children: ReactNode }) {
  return (
    <PublicConvexProvider>
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center px-4">
          <Link
            href="/"
            aria-label="a8 home"
            className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Logo className="text-lg" />
          </Link>
        </div>
      </header>
      {children}
    </PublicConvexProvider>
  );
}
