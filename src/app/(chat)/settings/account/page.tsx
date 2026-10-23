import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { DefaultModelCard } from "@/components/settings/default-model-card";
import { DeleteAccountCard } from "@/components/settings/delete-account-card";
import { PasswordCard } from "@/components/settings/password-card";
import { ProfileCard } from "@/components/settings/profile-card";
import { SessionsCard } from "@/components/settings/sessions-card";

export const metadata: Metadata = { title: "Account" };

export default function AccountSettingsPage() {
  return (
    <PageShell title="Account">
      <ProfileCard />
      <DefaultModelCard />
      <PasswordCard />
      <SessionsCard />
      <DeleteAccountCard />
    </PageShell>
  );
}
