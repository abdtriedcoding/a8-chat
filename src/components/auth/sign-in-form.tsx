"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlertIcon, MailCheckIcon } from "lucide-react";
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
import {
  DEFAULT_NEXT,
  safeNext,
  verifyEmailCallback,
  withNext,
} from "@/lib/next-path";
import { GoogleButton, oauthErrorMessage } from "./google-button";
import { PasswordInput } from "./password-input";

const formSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

type Notice = { message: string; destructive: boolean };

/**
 * What the URL says about how the user got here. `?verify=1` means an email
 * verification link sent them, as set by verifyEmailCallback. A bad link adds
 * `?error=`. A good one lands here only when it was already used, or when the
 * proxy couldn't confirm the new session. The email is verified either way.
 * `?error=` alone is a failed Google sign-in.
 */
function urlNotice(error: string | null, verify: boolean): Notice | null {
  if (error && verify) {
    return {
      message: "This link has expired. Sign in to get a new one.",
      destructive: true,
    };
  }
  if (error) return { message: oauthErrorMessage(error), destructive: true };
  if (verify) {
    return {
      message: "Your email is verified. Sign in to continue.",
      destructive: false,
    };
  }
  return null;
}

// The page reads the callback once, and nothing changes it while it's open.
function subscribeToNothing() {
  return () => {};
}

/** SignInForm with what the URL holds: `?next=`, `?error=` and `?verify=`. */
export function SignInFormFromUrl() {
  const params = useSearchParams();
  return (
    <SignInForm
      next={safeNext(params.get("next"))}
      notice={urlNotice(params.get("error"), params.has("verify"))}
    />
  );
}

export function SignInForm({
  next = DEFAULT_NEXT,
  notice,
}: {
  next?: string;
  notice?: Notice | null;
}) {
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();
  // A connector's callback that reached a signed-out browser. Signing in
  // goes on to the Connectors page, which finishes connecting, instead of
  // `next`.
  const finishingConnect = useSyncExternalStore(
    subscribeToNothing,
    hasConnectCallback,
    () => false,
  );
  const destination = finishingConnect ? "/connectors" : next;

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
  // The notice from the URL shows until the first email attempt.
  const rootError = form.formState.errors.root?.message;
  const alert: Notice | null = rootError
    ? { message: rootError, destructive: true }
    : form.formState.submitCount === 0
      ? (notice ?? null)
      : null;

  async function onSubmit(data: z.infer<typeof formSchema>) {
    // The callback is for the verification email an unverified user gets.
    const { error } = await authClient.signIn.email({
      ...data,
      callbackURL: verifyEmailCallback(destination),
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
          {alert && (
            <Alert variant={alert.destructive ? "destructive" : "default"}>
              {alert.destructive ? <CircleAlertIcon /> : <MailCheckIcon />}
              <AlertDescription>{alert.message}</AlertDescription>
            </Alert>
          )}
          <Field>
            <GoogleButton
              next={destination}
              disabled={pending}
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
              <Link href={withNext("/sign-up", next)}>Sign up</Link>
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
