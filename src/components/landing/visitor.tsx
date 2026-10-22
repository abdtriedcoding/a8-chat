"use client";

import { createContext, use, useEffect, useState, type ReactNode } from "react";
import type { Visitor } from "@/app/api/visitor/route";

const SIGNED_OUT: Visitor = { signedIn: false, plan: null };

const VisitorContext = createContext<Visitor>(SIGNED_OUT);

/**
 * Fetches the visitor once per visit to the landing page. Until it answers,
 * the page shows what a signed-out visitor sees, which is most visitors.
 */
export function VisitorProvider({ children }: { children: ReactNode }) {
  const [visitor, setVisitor] = useState(SIGNED_OUT);
  useEffect(() => {
    let current = true;
    fetch("/api/visitor")
      .then((response) => response.json() as Promise<Visitor>)
      .then(
        (next) => {
          if (current) setVisitor(next);
        },
        // A failed lookup leaves the signed-out view, which still works.
        () => {},
      );
    return () => {
      current = false;
    };
  }, []);
  return <VisitorContext value={visitor}>{children}</VisitorContext>;
}

export function useVisitor() {
  return use(VisitorContext);
}
