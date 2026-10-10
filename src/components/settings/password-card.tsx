"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { PasswordInput } from "@/components/auth/password-input";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { useHasPassword } from "@/hooks/use-has-password";
import { authClient } from "@/lib/auth-client";

/**
 * Changes the password, for users with an email account. Other sessions are
 * signed out, and this one stays.
 */
export function PasswordCard() {
  const hasPassword = useHasPassword();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  // Google-only users have no password to change.
  if (!hasPassword) return null;

  async function save(event: FormEvent) {
    event.preventDefault();
    // Better Auth's default password length limits, as at sign-up.
    if (newPassword.length < 8 || newPassword.length > 128) {
      setError("Use 8 to 128 characters for the new password.");
      return;
    }
    setError(undefined);
    setSaving(true);
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (result.error) {
        setError(result.error.message ?? "Couldn't change your password.");
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      toast.success("Password changed. Your other devices are signed out.");
    } catch {
      setError("Couldn't change your password. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <form onSubmit={(event) => void save(event)} noValidate>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>
            Changing it signs you out on your other devices.
          </CardDescription>
        </CardHeader>
        <CardContent className="py-4">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="current-password">
                Current password
              </FieldLabel>
              <PasswordInput
                id="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                autoComplete="current-password"
              />
            </Field>
            <Field data-invalid={error !== undefined}>
              <FieldLabel htmlFor="new-password">New password</FieldLabel>
              <PasswordInput
                id="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
                aria-invalid={error !== undefined}
              />
              {error && <FieldError>{error}</FieldError>}
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter>
          <Button
            type="submit"
            disabled={saving || !currentPassword || !newPassword}
          >
            {saving && <Spinner data-icon="inline-start" />}
            Change password
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
