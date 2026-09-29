"use client";

import { useConvexAuth, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { CircleAlertIcon } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";
import { api } from "../../../convex/_generated/api";

type Viewer = NonNullable<FunctionReturnType<typeof api.users.viewer>>;

// Temporary M2 check page: M4 replaces it with the chat layout and nav-user.
export function ViewerCard() {
  const { isLoading } = useConvexAuth();
  const viewer = useQuery(api.users.viewer, isLoading ? "skip" : {});
  // Sign-out ends the session before the page leaves, so users.viewer turns
  // null for a moment. Keep showing who was signed in until the redirect.
  const [signingOutAs, setSigningOutAs] = useState<Viewer | null>(null);
  const shown = signingOutAs ?? viewer;

  async function signOut(current: Viewer) {
    setSigningOutAs(current);
    await authClient.signOut();
    // A full load drops all client state; replace keeps the signed-in page
    // out of history.
    window.location.replace("/sign-in");
  }

  if (shown === undefined) return <Spinner />;

  if (shown === null) {
    return (
      <Alert variant="destructive" className="max-w-sm">
        <CircleAlertIcon />
        <AlertTitle>Signed in, but users.viewer is null</AlertTitle>
        <AlertDescription>
          Convex didn&apos;t accept the session. Check convex/auth.config.ts and
          the SITE_URL env var.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Signed in as {shown.name}</CardTitle>
        <CardDescription>{shown.email}</CardDescription>
      </CardHeader>
      <CardFooter>
        <Button
          variant="outline"
          disabled={signingOutAs !== null}
          onClick={() => signOut(shown)}
        >
          {signingOutAs && <Spinner data-icon="inline-start" />}
          Sign out
        </Button>
      </CardFooter>
    </Card>
  );
}
