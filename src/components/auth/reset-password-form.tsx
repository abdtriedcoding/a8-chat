"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
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
import { newPassword, PasswordInput } from "./password-input";

const formSchema = z.object({ password: newPassword });

const LINK_PROBLEM = "This reset link is invalid, expired, or already used.";

/**
 * The form's heading, for the static HTML. The form itself needs the URL's
 * token, which only the browser reads.
 */
export function ResetPasswordHeading() {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-3xl font-bold tracking-tight">Set a new password</h1>
      <p className="text-muted-foreground">
        Your other devices will be signed out.
      </p>
    </div>
  );
}

/**
 * Sets the new password with the token from the email's link, or shows the
 * error Better Auth puts there when the token was bad.
 */
export function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const linkError = searchParams.get("error");
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { password: "" },
  });
  const pending = form.formState.isSubmitting || navigating;

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

  const onSubmit = async (data: z.infer<typeof formSchema>) => {
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
    startNavigation(() => {
      router.replace("/sign-in?reset=1");
    });
  };

  const rootError = form.formState.errors.root?.message;

  return (
    <div className="flex flex-col gap-8">
      <ResetPasswordHeading />

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
              <Field
                data-invalid={fieldState.invalid}
                data-disabled={pending}
              >
                <FieldLabel htmlFor="reset-password">New password</FieldLabel>
                <PasswordInput
                  {...field}
                  id="reset-password"
                  aria-invalid={fieldState.invalid}
                  disabled={pending}
                  autoComplete="new-password"
                />
                {fieldState.invalid ? (
                  <FieldError errors={[fieldState.error]} />
                ) : (
                  <FieldDescription>At least 8 characters.</FieldDescription>
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
