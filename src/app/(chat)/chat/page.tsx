import type { Metadata } from "next";
import { NewChat } from "@/components/chat/new-chat";
import { requireSignedIn } from "@/lib/auth-server";

export const metadata: Metadata = { title: "New chat" };

export default async function NewChatPage(props: PageProps<"/chat">) {
  await requireSignedIn();
  // Set by a connector's example prompt.
  const { prompt } = await props.searchParams;
  return <NewChat prompt={typeof prompt === "string" ? prompt : undefined} />;
}
