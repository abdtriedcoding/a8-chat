"use client";

import { CircleAlertIcon } from "lucide-react";
import Link from "next/link";
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

export default function ThreadError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  if (useSignInOnUnauthenticated(error)) return null;
  return (
    <>
      <ChatHeader />
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CircleAlertIcon />
          </EmptyMedia>
          <EmptyTitle>Couldn&apos;t load this chat</EmptyTitle>
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
