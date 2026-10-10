"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import * as z from "zod";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";
import { PasswordInput } from "./password-input";

// Same rules as sign-up.
const formSchema = z.object({
  password: z
    .string()
    .min(8, "Use at least 8 characters.")
    .max(128, "Use at most 128 characters."),
});

const LINK_PROBLEM = "This reset link is invalid, expired, or already used.";

export function ResetPasswordForm({
  token,
  linkError,
}: {
  token?: string;
  linkError?: string;
}) {
  const router = useRouter();
  // Keeps the button busy while the redirect to sign-in settles.
  const [done, setDone] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { password: "" },
  });
  const pending = form.formState.isSubmitting || done;

  async function onSubmit(data: z.infer<typeof formSchema>) {
    if (!token) return;
    const { error } = await authClient.resetPassword({
      newPassword: data.password,
      token,
    });
    if (error) {
      form.setError("root", {
        message:
          error.code === "INVALID_TOKEN"
            ? LINK_PROBLEM
            : (error.message ?? "Couldn't reset your password. Try again."),
      });
      return;
    }
    setDone(true);
    router.replace("/sign-in");
  }

  if (!token || linkError) {
    return (
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Link not valid</h1>
          <p className="text-muted-foreground">{LINK_PROBLEM}</p>
        </div>
        <Button asChild size="lg">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    );
  }

  const rootError = form.formState.errors.root?.message;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">
          Set a new password
        </h1>
        <p className="text-muted-foreground">
          Your other devices will be signed out.
        </p>
      </div>

      <form method="post" noValidate onSubmit={form.handleSubmit(onSubmit)}>
        <FieldGroup>
          {rootError && (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertDescription>
                {rootError}{" "}
                {rootError === LINK_PROBLEM && (
                  <Link href="/forgot-password">Request a new link.</Link>
                )}
              </AlertDescription>
            </Alert>
          )}
          <Controller
            name="password"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="reset-password">New password</FieldLabel>
                <PasswordInput
                  {...field}
                  id="reset-password"
                  aria-invalid={fieldState.invalid}
                  autoComplete="new-password"
                />
                <FieldDescription>At least 8 characters.</FieldDescription>
                {fieldState.invalid && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </Field>
            )}
          />
          <Field>
            <Button type="submit" size="lg" disabled={pending}>
              {pending && <Spinner data-icon="inline-start" />}
              Reset password
            </Button>
          </Field>
        </FieldGroup>
      </form>
    </div>
  );
}
