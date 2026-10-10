import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = { title: "Reset password" };

export default async function ResetPasswordPage(
  props: PageProps<"/reset-password">,
) {
  const { token, error } = await props.searchParams;
  return (
    <ResetPasswordForm
      token={typeof token === "string" ? token : undefined}
      linkError={typeof error === "string" ? error : undefined}
    />
  );
}
