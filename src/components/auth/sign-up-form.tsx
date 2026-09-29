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
import { GoogleButton } from "./google-button";
import { PasswordInput } from "./password-input";

// Better Auth's default password length limits.
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;

const signUpSchema = z.object({
  name: z.string().trim().min(1, "Enter your name."),
  email: z.email("Enter a valid email address."),
  password: z
    .string()
    .min(MIN_PASSWORD, `Use at least ${MIN_PASSWORD} characters.`)
    .max(MAX_PASSWORD, `Use at most ${MAX_PASSWORD} characters.`),
});

export function SignUpForm({ next, google }: { next: string; google: boolean }) {
  const router = useRouter();
  // Uncontrolled inputs and no defaultValues, so register() starts from what
  // is already in each input: text typed or autofilled before hydration.
  const form = useForm<z.infer<typeof signUpSchema>>({
    resolver: zodResolver(signUpSchema),
  });
  const { errors, isSubmitting, isSubmitSuccessful } = form.formState;
  // Stay pending through the navigation so the form can't resubmit.
  const pending = isSubmitting || isSubmitSuccessful;

  async function onSubmit(values: z.infer<typeof signUpSchema>) {
    const { error } = await authClient.signUp.email(values);
    if (error) {
      form.setError("root", {
        message: error.message ?? "Couldn't create your account. Please try again.",
      });
      return;
    }
    router.replace(next);
    router.refresh();
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
      {/* POST, so a submit that lands before hydration can't put the
          password in the URL. */}
      <form method="post" noValidate onSubmit={form.handleSubmit(onSubmit)}>
        <FieldGroup>
          {errors.root && (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertDescription>{errors.root.message}</AlertDescription>
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
                Or sign up with email
              </FieldSeparator>
            </>
          )}
          <Field data-invalid={!!errors.name}>
            <FieldLabel htmlFor="sign-up-name">Name</FieldLabel>
            <Input
              {...form.register("name")}
              id="sign-up-name"
              autoComplete="name"
              placeholder="Ada Lovelace"
              aria-invalid={!!errors.name}
            />
            <FieldError errors={[errors.name]} />
          </Field>
          <Field data-invalid={!!errors.email}>
            <FieldLabel htmlFor="sign-up-email">Email</FieldLabel>
            <Input
              {...form.register("email")}
              id="sign-up-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              aria-invalid={!!errors.email}
            />
            <FieldError errors={[errors.email]} />
          </Field>
          <Field data-invalid={!!errors.password}>
            <FieldLabel htmlFor="sign-up-password">Password</FieldLabel>
            <PasswordInput
              {...form.register("password")}
              id="sign-up-password"
              autoComplete="new-password"
              aria-invalid={!!errors.password}
            />
            {errors.password ? (
              <FieldError errors={[errors.password]} />
            ) : (
              <FieldDescription>
                At least {MIN_PASSWORD} characters.
              </FieldDescription>
            )}
          </Field>
          <Field>
            <Button type="submit" size="lg" disabled={pending}>
              {pending && <Spinner data-icon="inline-start" />}
              Create account
            </Button>
            <FieldDescription>
              Already have an account?{" "}
              <Link href={withNext("/sign-in", next)}>Sign in</Link>
            </FieldDescription>
          </Field>
        </FieldGroup>
      </form>
    </div>
  );
}
