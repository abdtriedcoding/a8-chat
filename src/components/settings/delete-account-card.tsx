"use client";

import { useState } from "react";
import { PasswordInput } from "@/components/auth/password-input";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useHasPassword } from "@/hooks/use-has-password";
import { authClient } from "@/lib/auth-client";

/**
 * Deletes the account after the user types their email. Email accounts also
 * send their password. A Google-only account needs a recent sign-in instead.
 */
export function DeleteAccountCard() {
  const { data: session } = authClient.useSession();
  const hasPassword = useHasPassword();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [deleting, setDeleting] = useState(false);

  const emailMatches =
    session !== undefined &&
    session !== null &&
    email.trim().toLowerCase() === session.user.email.toLowerCase();
  const ready =
    emailMatches && hasPassword !== undefined && (!hasPassword || password);

  function onOpenChange(next: boolean) {
    if (deleting) return;
    setOpen(next);
    if (!next) {
      setEmail("");
      setPassword("");
      setError(undefined);
    }
  }

  async function confirmDelete() {
    setError(undefined);
    setDeleting(true);
    try {
      const { error } = await authClient.deleteUser(
        hasPassword ? { password } : {},
      );
      if (error) {
        setError(
          error.code === "SESSION_EXPIRED"
            ? "For your security, sign in again, then delete your account."
            : (error.message ?? "Couldn't delete your account."),
        );
        return;
      }
      // The server already ended the session. This clears the client's copy.
      await authClient.signOut().catch(() => {});
      window.location.replace("/");
    } catch {
      setError("Couldn't delete your account. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Delete account</CardTitle>
        <CardDescription>
          Deletes your account, chats, uploads and connections. You can&apos;t
          undo this.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <Button variant="destructive" onClick={() => setOpen(true)}>
          Delete account
        </Button>
      </CardContent>
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes your chats, uploads and connections for good. a8
              also revokes its access to your connected apps.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="delete-email">
                Type {session?.user.email ?? "your email"} to confirm
              </FieldLabel>
              <Input
                id="delete-email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="off"
                disabled={deleting}
              />
            </Field>
            {hasPassword && (
              <Field>
                <FieldLabel htmlFor="delete-password">Password</FieldLabel>
                <PasswordInput
                  id="delete-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  disabled={deleting}
                />
              </Field>
            )}
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!ready || deleting}
              onClick={(event) => {
                // Stay open until the delete lands, so a failure can show.
                event.preventDefault();
                void confirmDelete();
              }}
            >
              {deleting && <Spinner data-icon="inline-start" />}
              Delete account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
