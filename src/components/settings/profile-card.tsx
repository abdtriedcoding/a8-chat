"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";

/** Edits the user's name. The user menu reads it from the same session. */
export function ProfileCard() {
  const { data: session } = authClient.useSession();
  const savedName = session?.user.name ?? "";
  // Undefined until the user types, so the field follows the session.
  const [draft, setDraft] = useState<string>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const name = draft ?? savedName;
  const changed = name.trim() !== savedName;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Enter your name.");
      return;
    }
    setError(undefined);
    setSaving(true);
    try {
      const result = await authClient.updateUser({ name: name.trim() });
      if (result.error) {
        setError(result.error.message ?? "Couldn't save your name.");
        return;
      }
      setDraft(undefined);
      toast.success("Name updated.");
    } catch {
      setError("Couldn't save your name. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <form onSubmit={(event) => void save(event)} noValidate>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            {session ? `Signed in as ${session.user.email}.` : "Your name."}
          </CardDescription>
        </CardHeader>
        <CardContent className="py-4">
          <Field data-invalid={error !== undefined}>
            <FieldLabel htmlFor="account-name">Name</FieldLabel>
            <Input
              id="account-name"
              value={name}
              onChange={(event) => setDraft(event.target.value)}
              disabled={!session}
              autoComplete="name"
              aria-invalid={error !== undefined}
            />
            {error && <FieldError>{error}</FieldError>}
          </Field>
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={!changed || saving}>
            {saving && <Spinner data-icon="inline-start" />}
            Save
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
