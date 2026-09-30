import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NewChat } from "@/components/chat/new-chat";
import { isAuthenticated } from "@/lib/auth-server";

export const metadata: Metadata = { title: "New chat" };

export default async function NewChatPage() {
  if (!(await isAuthenticated())) redirect("/sign-in");
  return <NewChat />;
}
