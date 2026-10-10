"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlertIcon, MailCheckIcon } from "lucide-react";
import Link from "next/link";
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
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";

const formSchema = z.object({
  email: z.email("Enter a valid email address."),
});

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: "" },
  });
  const pending = form.formState.isSubmitting;

  async function onSubmit(data: z.infer<typeof formSchema>) {
    const { error } = await authClient.requestPasswordReset({
      email: data.email,
      redirectTo: `${window.location.origin}/reset-password`,
    });
    // Better Auth answers the same for known and unknown emails. Only a
    // failed request, such as a rate limit, shows an error.
    if (error) {
      form.setError("root", {
        message: error.message ?? "Couldn't send the link. Please try again.",
      });
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <MailCheckIcon className="size-8 text-muted-foreground" />
          <h1 className="text-3xl font-bold tracking-tight">Check your email</h1>
          <p className="text-muted-foreground">
            If an account exists for that email, we sent a link to reset your
            password. It expires in 30 minutes.
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          Back to <Link href="/sign-in">sign in</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">
          Forgot your password?
        </h1>
        <p className="text-muted-foreground">
          Enter your email and we&apos;ll send you a reset link.
        </p>
      </div>

      <form method="post" noValidate onSubmit={form.handleSubmit(onSubmit)}>
        <FieldGroup>
          {form.formState.errors.root && (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertDescription>
                {form.formState.errors.root.message}
              </AlertDescription>
            </Alert>
          )}
          <Controller
            name="email"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="forgot-password-email">Email</FieldLabel>
                <Input
                  {...field}
                  id="forgot-password-email"
                  type="email"
                  aria-invalid={fieldState.invalid}
                  placeholder="you@example.com"
                  autoComplete="email"
                />
                {fieldState.invalid && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </Field>
            )}
          />
          <Field>
            <Button type="submit" size="lg" disabled={pending}>
              {pending && <Spinner data-icon="inline-start" />}
              Send reset link
            </Button>
            <FieldDescription>
              Remembered it? <Link href="/sign-in">Sign in</Link>
            </FieldDescription>
          </Field>
        </FieldGroup>
      </form>
    </div>
  );
}
