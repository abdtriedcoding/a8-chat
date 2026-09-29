"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
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
import { withNext } from "@/lib/safe-redirect";
import { GoogleButton, oauthErrorMessage } from "./google-button";
import { PasswordInput } from "./password-input";

const signInSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export function SignInForm({
  next,
  google,
  oauthError,
}: {
  next: string;
  google: boolean;
  oauthError?: string;
}) {
  const router = useRouter();
  // Uncontrolled inputs and no defaultValues, so register() starts from what
  // is already in each input: text typed or autofilled before hydration.
  const form = useForm<z.infer<typeof signInSchema>>({
    resolver: zodResolver(signInSchema),
  });
  const { errors, isSubmitting, isSubmitSuccessful, submitCount } =
    form.formState;
  // Stay pending through the navigation so the form can't resubmit.
  const pending = isSubmitting || isSubmitSuccessful;
  // The OAuth error from the URL shows until the first email attempt.
  const error =
    errors.root?.message ??
    (oauthError && submitCount === 0 ? oauthErrorMessage(oauthError) : null);

  async function onSubmit(values: z.infer<typeof signInSchema>) {
    const { error } = await authClient.signIn.email(values);
    if (error) {
      form.setError("root", {
        message: error.message ?? "Couldn't sign you in. Please try again.",
      });
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Welcome back</h1>
        <p className="text-muted-foreground">
          Sign in to pick up where you left off.
        </p>
      </div>
      {/* POST, so a submit that lands before hydration can't put the
          password in the URL. */}
      <form method="post" noValidate onSubmit={form.handleSubmit(onSubmit)}>
        <FieldGroup>
          {error && (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {google && (
            <>
              <Field>
                <GoogleButton
                  next={next}
                  disabled={pending}
                  onError={(message) => form.setError("root", { message })}
                />
              </Field>
              <FieldSeparator>
                Or continue with email
              </FieldSeparator>
            </>
          )}
          <Field data-invalid={!!errors.email}>
            <FieldLabel htmlFor="sign-in-email">Email</FieldLabel>
            <Input
              {...form.register("email")}
              id="sign-in-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              aria-invalid={!!errors.email}
            />
            <FieldError errors={[errors.email]} />
          </Field>
          <Field data-invalid={!!errors.password}>
            <FieldLabel htmlFor="sign-in-password">Password</FieldLabel>
            <PasswordInput
              {...form.register("password")}
              id="sign-in-password"
              autoComplete="current-password"
              aria-invalid={!!errors.password}
            />
            <FieldError errors={[errors.password]} />
          </Field>
          <Field>
            <Button type="submit" size="lg" disabled={pending}>
              {pending && <Spinner data-icon="inline-start" />}
              Sign in
            </Button>
            <FieldDescription>
              Don&apos;t have an account?{" "}
              <Link href={withNext("/sign-up", next)}>Sign up</Link>
            </FieldDescription>
          </Field>
        </FieldGroup>
      </form>
    </div>
  );
}
