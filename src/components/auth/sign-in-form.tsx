"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { useEffect, useSyncExternalStore, useTransition } from "react";
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
import {
  hasConnectCallback,
  holdConnectCallback,
} from "@/lib/connect-callback";
import { GoogleButton, oauthErrorMessage } from "./google-button";
import { PasswordInput } from "./password-input";

const formSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

/** SignInForm with the error Better Auth puts in the URL when Google sign-in fails. */
export function SignInFormFromUrl() {
  const error = useSearchParams().get("error");
  return <SignInForm oauthError={error ?? undefined} />;
}

// The page reads the callback once, and nothing changes it while it's open.
function subscribeToNothing() {
  return () => {};
}

export function SignInForm({ oauthError }: { oauthError?: string }) {
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();
  // A connector's callback that reached a signed-out browser. Signing in
  // goes on to the Connectors page, which finishes connecting.
  const finishingConnect = useSyncExternalStore(
    subscribeToNothing,
    hasConnectCallback,
    () => false,
  );
  const destination = finishingConnect ? "/connectors" : "/chat";

  useEffect(() => {
    holdConnectCallback();
  }, []);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  // `navigating` clears when the redirect settles, so a bounced redirect
  // leaves the form usable.
  const pending = form.formState.isSubmitting || navigating;
  // The OAuth error from the URL shows until the first email attempt.
  const error =
    form.formState.errors.root?.message ??
    (oauthError && form.formState.submitCount === 0
      ? oauthErrorMessage(oauthError)
      : null);

  async function onSubmit(data: z.infer<typeof formSchema>) {
    const { error } = await authClient.signIn.email({
      ...data,
      callbackURL: `${window.location.origin}${destination}`,
    });
    if (error) {
      form.setError("root", {
        message:
          error.code === "EMAIL_NOT_VERIFIED"
            ? "Verify your email first. We sent a new link to your inbox."
            : (error.message ?? "Couldn't sign you in. Please try again."),
      });
      return;
    }
    startNavigation(() => {
      router.replace(destination);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Welcome back</h1>
        <p className="text-muted-foreground">
          {finishingConnect
            ? "Sign in to finish connecting."
            : "Sign in to pick up where you left off."}
        </p>
      </div>

      <form method="post" noValidate onSubmit={form.handleSubmit(onSubmit)}>
        <FieldGroup>
          {error && (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Field>
            <GoogleButton
              disabled={pending}
              callbackURL={destination}
              onError={(message) => form.setError("root", { message })}
            />
          </Field>
          <FieldSeparator>Or continue with email</FieldSeparator>
          <Controller
            name="email"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field
                data-invalid={fieldState.invalid}
                data-disabled={pending}
              >
                <FieldLabel htmlFor="sign-in-email">Email</FieldLabel>
                <Input
                  {...field}
                  id="sign-in-email"
                  type="email"
                  aria-invalid={fieldState.invalid}
                  disabled={pending}
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
              <Field
                data-invalid={fieldState.invalid}
                data-disabled={pending}
              >
                <div className="flex items-center justify-between">
                  <FieldLabel htmlFor="sign-in-password">Password</FieldLabel>
                  <Link
                    href="/forgot-password"
                    className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
                <PasswordInput
                  {...field}
                  id="sign-in-password"
                  aria-invalid={fieldState.invalid}
                  disabled={pending}
                  autoComplete="current-password"
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
              Sign in
            </Button>
            <FieldDescription>
              Don&apos;t have an account?{" "}
              <Link href="/sign-up">Sign up</Link>
            </FieldDescription>
            <FieldDescription>
              By continuing you agree to the <Link href="/terms">Terms</Link>{" "}
              and <Link href="/privacy">Privacy Policy</Link>.
            </FieldDescription>
          </Field>
        </FieldGroup>
      </form>
    </div>
  );
}
