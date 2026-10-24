"use client";

import { createContext, use, useEffect, useState, type ReactNode } from "react";
import type { Visitor } from "@/app/api/visitor/route";

const SIGNED_OUT: Visitor = { signedIn: false, plan: null };

const VisitorContext = createContext<Visitor | null>(null);

/**
 * Fetches the visitor once per visit to the landing page. Null until it
 * answers, so the page doesn't show "Sign in" to a signed-in visitor.
 */
export function VisitorProvider({ children }: { children: ReactNode }) {
  const [visitor, setVisitor] = useState<Visitor | null>(null);
  useEffect(() => {
    let current = true;
    fetch("/api/visitor")
      .then((response) => response.json() as Promise<Visitor>)
      .then(
        (next) => {
          if (current) setVisitor(next);
        },
        // A failed lookup shows the signed-out view, which still works.
        () => {
          if (current) setVisitor(SIGNED_OUT);
        },
      );
    return () => {
      current = false;
    };
  }, []);
  return <VisitorContext value={visitor}>{children}</VisitorContext>;
}

/** The visitor, or null while the lookup runs. */
export function useVisitor() {
  return use(VisitorContext);
}
