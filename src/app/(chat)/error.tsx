"use client";

import { ChatErrorState } from "@/components/chat-error";

export default function ChatError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ChatErrorState title="Couldn't load this page" {...props} />;
}
