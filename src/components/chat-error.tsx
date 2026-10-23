"use client";

import { CircleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { ChatHeader } from "@/components/chat/chat-header";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useSignInOnUnauthenticated } from "@/components/session-guard";
import { errorMessage } from "@/lib/errors";

/**
 * The error boundary body for pages in the (chat) group. It renders inside
 * the layout, so the sidebar stays.
 */
export function ChatErrorState({
  title,
  error,
  retry,
}: {
  title: string;
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  if (useSignInOnUnauthenticated(error)) return null;
  return (
    <>
      <ChatHeader />
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CircleAlertIcon />
          </EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{errorMessage(error)}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row justify-center">
          <Button onClick={retry}>Try again</Button>
          <Button variant="outline" asChild>
            <Link href="/chat">New chat</Link>
          </Button>
        </EmptyContent>
      </Empty>
    </>
  );
}
