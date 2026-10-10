"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";
import { describeDevice } from "@/lib/user-agent";

type SessionRow = {
  token: string;
  userAgent?: string | null;
  updatedAt: Date;
};

/** Where the user is signed in, with a way to sign out of each place. */
export function SessionsCard() {
  const { data: current } = authClient.useSession();
  const [sessions, setSessions] = useState<SessionRow[]>();
  const [failed, setFailed] = useState(false);
  // The token being revoked, or "others" for all of them.
  const [revoking, setRevoking] = useState<string>();

  // Bumped to load the list again, such as after a sign-out.
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let cancelled = false;
    authClient
      .listSessions()
      .then(({ data }) => {
        if (cancelled) return;
        setFailed(!data);
        if (data) setSessions(newestFirst(data));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [reloads]);

  async function revoke(key: string, run: () => Promise<{ error: unknown }>) {
    setRevoking(key);
    try {
      const { error } = await run();
      if (error) throw error;
      setReloads((count) => count + 1);
    } catch {
      toast.error("Couldn't sign out. Please try again.");
    } finally {
      setRevoking(undefined);
    }
  }

  const currentToken = current?.session.token;
  const others = sessions?.filter(({ token }) => token !== currentToken) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sessions</CardTitle>
        <CardDescription>
          The devices signed in to your account. A device you sign out stays
          signed in to the chat for up to 15 minutes.
        </CardDescription>
        {others.length > 0 && (
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              disabled={revoking !== undefined}
              onClick={() =>
                void revoke("others", () => authClient.revokeOtherSessions())
              }
            >
              {revoking === "others" && <Spinner data-icon="inline-start" />}
              Sign out of all other devices
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3 py-4">
        {failed && (
          <p className="text-sm text-muted-foreground">
            Couldn&apos;t load your sessions. Refresh to try again.
          </p>
        )}
        {!failed && sessions === undefined && (
          <Skeleton className="h-10 w-full" />
        )}
        {sessions?.map((session) => {
          const isCurrent = session.token === currentToken;
          return (
            <div
              key={session.token}
              className="flex items-center justify-between gap-3"
            >
              <div className="flex min-w-0 flex-col">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <span className="truncate">
                    {describeDevice(session.userAgent)}
                  </span>
                  {isCurrent && <Badge variant="secondary">This device</Badge>}
                </span>
                <span className="text-xs text-muted-foreground">
                  Last active {formatLastActive(session.updatedAt)}
                </span>
              </div>
              {!isCurrent && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={revoking !== undefined}
                  onClick={() =>
                    void revoke(session.token, () =>
                      authClient.revokeSession({ token: session.token }),
                    )
                  }
                >
                  {revoking === session.token && (
                    <Spinner data-icon="inline-start" />
                  )}
                  Sign out
                </Button>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function newestFirst(sessions: SessionRow[]): SessionRow[] {
  return [...sessions].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

function formatLastActive(date: Date | string): string {
  return new Date(date).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
