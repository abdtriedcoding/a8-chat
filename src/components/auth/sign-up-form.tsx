"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlertIcon, MailCheckIcon } from "lucide-react";
import Link from "next/link";
import { Controller, useForm } from "react-hook-form";
import { useState } from "react";
import * as z from "zod";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";
import { GoogleButton } from "./google-button";
import { PasswordInput } from "./password-input";

const formSchema = z.object({
  name: z.string().trim().min(1, "Enter your name."),
  email: z.email("Enter a valid email address."),
  // Better Auth's default password length limits.
  password: z
    .string()
    .min(8, "Use at least 8 characters.")
    .max(128, "Use at most 128 characters."),
});

export function SignUpForm() {
  // Set once the form is accepted. It shows the same screen for a new and a
  // registered email, so the form doesn't reveal which emails have accounts.
  const [sentTo, setSentTo] = useState<string | null>(null);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
    },
  });

  const pending = form.formState.isSubmitting;

  async function onSubmit(data: z.infer<typeof formSchema>) {
    const { error } = await authClient.signUp.email({
      ...data,
      callbackURL: `${window.location.origin}/chat`,
    });
    // Better Auth answers a registered email with success when verification
    // is required. This also covers the older error, in case that changes.
    if (error && error.code !== "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") {
      form.setError("root", {
        message: error.message ?? "Couldn't create your account. Please try again.",
      });
      return;
    }
    setSentTo(data.email);
  }

  if (sentTo) {
    return (
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <MailCheckIcon className="size-8 text-muted-foreground" />
          <h1 className="text-3xl font-bold tracking-tight">Check your email</h1>
          <p className="text-muted-foreground">
            If {sentTo} can be used for a new account, we sent a link to it.
            Open the link to verify your email and sign in.
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          Already verified? <Link href="/sign-in">Sign in</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">
          Create your account
        </h1>
        <p className="text-muted-foreground">
          It takes a few seconds, and it&apos;s free.
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
          <Field>
            <GoogleButton
              disabled={pending}
              onError={(message) => form.setError("root", { message })}
            />
          </Field>
          <FieldSeparator>Or sign up with email</FieldSeparator>
          <Controller
            name="name"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="sign-up-name">Name</FieldLabel>
                <Input
                  {...field}
                  id="sign-up-name"
                  aria-invalid={fieldState.invalid}
                  placeholder="Ada Lovelace"
                  autoComplete="name"
                />
                {fieldState.invalid && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </Field>
            )}
          />
          <Controller
            name="email"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="sign-up-email">Email</FieldLabel>
                <Input
                  {...field}
                  id="sign-up-email"
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
          <Controller
            name="password"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="sign-up-password">Password</FieldLabel>
                <PasswordInput
                  {...field}
                  id="sign-up-password"
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
              Create account
            </Button>
            <FieldDescription>
              Already have an account?{" "}
              <Link href="/sign-in">Sign in</Link>
            </FieldDescription>
          </Field>
        </FieldGroup>
      </form>
    </div>
  );
}
