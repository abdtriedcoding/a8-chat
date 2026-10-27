"use client";

import { catchError, type ErrorInfo } from "next/error";
import { useEffect } from "react";
import { useSignInOnUnauthenticated } from "@/components/session-guard";

/**
 * An error boundary that renders nothing in place of what failed, for the
 * chat layout's parts that show little or nothing of their own. The layout
 * is outside the pages' error.tsx, so without one a failed query in them
 * would reach the root error.tsx and replace the whole app.
 */
export const QuietBoundary = catchError(function QuietFallback(
  _props: object,
  { error }: ErrorInfo,
) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  useSignInOnUnauthenticated(error);
  return null;
});
