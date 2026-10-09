import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NewChat } from "@/components/chat/new-chat";
import { isAuthenticated } from "@/lib/auth-server";

export const metadata: Metadata = { title: "New chat" };

export default async function NewChatPage(props: PageProps<"/chat">) {
  if (!(await isAuthenticated())) redirect("/sign-in");
  // Set by a connector's example prompt.
  const { prompt } = await props.searchParams;
  return <NewChat prompt={typeof prompt === "string" ? prompt : undefined} />;
}
