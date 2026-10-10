import type { Metadata } from "next";
import { ChatHeader } from "@/components/chat/chat-header";
import { DeleteAccountCard } from "@/components/settings/delete-account-card";
import { PasswordCard } from "@/components/settings/password-card";
import { ProfileCard } from "@/components/settings/profile-card";
import { SessionsCard } from "@/components/settings/sessions-card";

export const metadata: Metadata = { title: "Account" };

export default function AccountSettingsPage() {
  return (
    <>
      <ChatHeader>
        <h1 className="px-2 text-sm font-medium">Account</h1>
      </ChatHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
          <ProfileCard />
          <PasswordCard />
          <SessionsCard />
          <DeleteAccountCard />
        </div>
      </div>
    </>
  );
}
