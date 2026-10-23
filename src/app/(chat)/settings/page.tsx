import { redirect } from "next/navigation";

// Settings has no overview, so it opens on the first tab.
export default function SettingsPage() {
  redirect("/settings/account");
}
