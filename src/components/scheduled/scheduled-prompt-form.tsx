"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { CircleAlertIcon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
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
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { errorMessage } from "@/lib/errors";
import { api } from "../../../convex/_generated/api";
import { MAX_RENAME_LENGTH } from "../../../convex/lib/prompt";
import type { Schedule } from "../../../convex/lib/schedule";
import { WEEKDAYS } from "../../../convex/lib/scheduleText";
import { browserTimeZone } from "../../../convex/lib/timeZone";

type Kind = Schedule["kind"];

export type ScheduledPrompt = FunctionReturnType<
  typeof api.scheduledPrompts.list
>[number];

const KINDS: { kind: Kind; label: string }[] = [
  { kind: "once", label: "Once" },
  { kind: "daily", label: "Daily" },
  { kind: "weekdays", label: "Weekdays" },
  { kind: "weekly", label: "Weekly" },
  { kind: "monthly", label: "Monthly" },
];

const DAYS_OF_MONTH = Array.from({ length: 31 }, (_, i) => i + 1);

const formSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Type a title first.")
      .max(
        MAX_RENAME_LENGTH,
        `Titles can be at most ${MAX_RENAME_LENGTH} characters.`,
      ),
    prompt: z.string().trim().min(1, "Type a prompt first."),
    kind: z.enum(["once", "daily", "weekdays", "weekly", "monthly"]),
    date: z.string(),
    time: z.string().min(1, "Pick a time."),
    days: z.array(z.string()),
    dayOfMonth: z.string(),
    timeZone: z.string().min(1, "Pick a time zone."),
  })
  .superRefine((values, ctx) => {
    if (values.kind === "once" && !values.date) {
      ctx.addIssue({ code: "custom", path: ["date"], message: "Pick a date." });
    }
    if (values.kind === "weekly" && values.days.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["days"],
        message: "Pick at least one day.",
      });
    }
  });

type FormValues = z.infer<typeof formSchema>;

/**
 * The browser's time zones, plus UTC and `extra`, such as its own zone,
 * which the browser can leave out.
 */
function timeZoneOptions(extra: (string | undefined)[]) {
  const zones = new Set(Intl.supportedValuesOf("timeZone"));
  for (const zone of extra) if (zone) zones.add(zone);
  zones.add("UTC");
  return [...zones].sort();
}

/** Today in `timeZone`, as "YYYY-MM-DD". */
function today(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(Date.now());
}

/** The form filled in from `row`, or blank for a new scheduled prompt. */
function toFormValues(
  row: ScheduledPrompt | undefined,
  ownTimeZone: string,
): FormValues {
  const timeZone = row?.timeZone ?? ownTimeZone;
  const schedule = row?.schedule;
  return {
    title: row?.title ?? "",
    prompt: row?.prompt ?? "",
    kind: schedule?.kind ?? "daily",
    date: schedule?.kind === "once" ? schedule.date : today(timeZone),
    time: schedule?.time ?? "09:00",
    days: schedule?.kind === "weekly" ? schedule.days.map(String) : ["1"],
    dayOfMonth: schedule?.kind === "monthly" ? String(schedule.day) : "1",
    timeZone,
  };
}

function toSchedule(values: FormValues): Schedule {
  const { kind, date, time } = values;
  switch (kind) {
    case "once":
      return { kind, date, time };
    case "weekly":
      return { kind, days: values.days.map(Number), time };
    case "monthly":
      return { kind, day: Number(values.dayOfMonth), time };
    default:
      return { kind, time };
  }
}

/**
 * The "New task" button, and the sheet it opens with the form that makes a
 * scheduled prompt. The sheet closes once the task is made.
 */
export function NewScheduledPromptSheet() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button>
          <PlusIcon data-icon="inline-start" />
          New task
        </Button>
      </SheetTrigger>
      <SheetContent className="gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>New scheduled task</SheetTitle>
          <SheetDescription>
            It runs in a chat of its own, named after its title.
          </SheetDescription>
        </SheetHeader>
        {/* The sheet's content mounts only when open, in the browser, so the
            form can read the browser's time zone as it renders. */}
        <ScheduledPromptForm onDone={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

/**
 * The sheet with the form that edits `row`. The list that opens it keeps
 * `row` set while the sheet closes, so the form doesn't blank mid-animation.
 */
export function EditScheduledPromptSheet({
  row,
  open,
  onOpenChange,
}: {
  row: ScheduledPrompt | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Edit scheduled task</SheetTitle>
          <SheetDescription>
            Changes apply from its next run. Past runs stay as they were.
          </SheetDescription>
        </SheetHeader>
        {row && (
          <ScheduledPromptForm
            key={row._id}
            row={row}
            onDone={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Makes a scheduled prompt, or saves changes to `row` when it's set. */
function ScheduledPromptForm({
  row,
  onDone,
}: {
  row?: ScheduledPrompt;
  onDone: () => void;
}) {
  const create = useMutation(api.scheduledPrompts.create);
  const update = useMutation(api.scheduledPrompts.update);
  const router = useRouter();
  const [ownTimeZone] = useState(browserTimeZone);
  const [timeZones] = useState(() =>
    timeZoneOptions([ownTimeZone, row?.timeZone]),
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: toFormValues(row, ownTimeZone),
  });

  const pending = form.formState.isSubmitting;
  const kind = useWatch({ control: form.control, name: "kind" });
  const dayOfMonth = useWatch({ control: form.control, name: "dayOfMonth" });

  async function onSubmit(values: FormValues) {
    const fields = {
      title: values.title,
      prompt: values.prompt,
      schedule: toSchedule(values),
      timeZone: values.timeZone,
    };
    try {
      if (row) {
        await update({
          ...fields,
          scheduledPromptId: row._id,
          email: row.email,
        });
        toast.success("Scheduled task saved.");
      } else {
        const { threadId } = await create(fields);
        toast.success("Scheduled task created.", {
          action: {
            label: "Open chat",
            onClick: () => router.push(`/c/${threadId}`),
          },
        });
      }
      onDone();
    } catch (caught) {
      form.setError("root", { message: errorMessage(caught) });
    }
  }

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
        <FieldGroup className="gap-5">
          {form.formState.errors.root && (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertDescription>
                {form.formState.errors.root.message}
              </AlertDescription>
            </Alert>
          )}
          <Controller
            name="title"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid} data-disabled={pending}>
                <FieldLabel htmlFor="scheduled-title">Title</FieldLabel>
                <Input
                  {...field}
                  id="scheduled-title"
                  aria-invalid={fieldState.invalid}
                  disabled={pending}
                  placeholder="Morning email digest"
                  maxLength={MAX_RENAME_LENGTH}
                />
                {fieldState.invalid && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </Field>
            )}
          />
          <Controller
            name="prompt"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid} data-disabled={pending}>
                <FieldLabel htmlFor="scheduled-prompt">Prompt</FieldLabel>
                <Textarea
                  {...field}
                  id="scheduled-prompt"
                  aria-invalid={fieldState.invalid}
                  disabled={pending}
                  placeholder="Summarize my unread email from yesterday."
                  className="max-h-60"
                />
                {fieldState.invalid && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </Field>
            )}
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <Controller
              name="kind"
              control={form.control}
              render={({ field }) => (
                <Field data-disabled={pending}>
                  <FieldLabel htmlFor="scheduled-kind">Repeats</FieldLabel>
                  <NativeSelect
                    {...field}
                    id="scheduled-kind"
                    className="w-full"
                    disabled={pending}
                  >
                    {KINDS.map((option) => (
                      <NativeSelectOption key={option.kind} value={option.kind}>
                        {option.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
              )}
            />
            {kind === "once" && (
              <Controller
                name="date"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field
                    data-invalid={fieldState.invalid}
                    data-disabled={pending}
                  >
                    <FieldLabel htmlFor="scheduled-date">Date</FieldLabel>
                    <Input
                      {...field}
                      id="scheduled-date"
                      type="date"
                      aria-invalid={fieldState.invalid}
                      disabled={pending}
                    />
                    {fieldState.invalid && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                )}
              />
            )}
            {kind === "monthly" && (
              <Controller
                name="dayOfMonth"
                control={form.control}
                render={({ field }) => (
                  <Field data-disabled={pending}>
                    <FieldLabel htmlFor="scheduled-day">
                      Day of the month
                    </FieldLabel>
                    <NativeSelect
                      {...field}
                      id="scheduled-day"
                      className="w-full"
                      disabled={pending}
                    >
                      {DAYS_OF_MONTH.map((day) => (
                        <NativeSelectOption key={day} value={day}>
                          {day}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                )}
              />
            )}
            <Controller
              name="time"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field
                  data-invalid={fieldState.invalid}
                  data-disabled={pending}
                >
                  <FieldLabel htmlFor="scheduled-time">Time</FieldLabel>
                  <Input
                    {...field}
                    id="scheduled-time"
                    type="time"
                    aria-invalid={fieldState.invalid}
                    disabled={pending}
                  />
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
            <Controller
              name="timeZone"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field
                  data-invalid={fieldState.invalid}
                  data-disabled={pending}
                >
                  <FieldLabel htmlFor="scheduled-time-zone">
                    Time zone
                  </FieldLabel>
                  <NativeSelect
                    {...field}
                    id="scheduled-time-zone"
                    className="w-full"
                    aria-invalid={fieldState.invalid}
                    disabled={pending}
                  >
                    {timeZones.map((zone) => (
                      <NativeSelectOption key={zone} value={zone}>
                        {zone}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
          </div>
          {kind === "weekly" && (
            <Controller
              name="days"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field
                  data-invalid={fieldState.invalid}
                  data-disabled={pending}
                >
                  <FieldLabel id="scheduled-days">Days</FieldLabel>
                  <ToggleGroup
                    type="multiple"
                    variant="outline"
                    aria-labelledby="scheduled-days"
                    aria-invalid={fieldState.invalid}
                    className="flex-wrap"
                    disabled={pending}
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    {WEEKDAYS.map(({ day, name, short }) => (
                      <ToggleGroupItem
                        key={day}
                        value={String(day)}
                        aria-label={name}
                      >
                        {short}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
          )}
          {kind === "monthly" && Number(dayOfMonth) > 28 && (
            <FieldDescription>
              In shorter months it runs on the last day.
            </FieldDescription>
          )}
        </FieldGroup>
      </div>
      <SheetFooter className="flex-row justify-end border-t">
        <SheetClose asChild>
          <Button type="button" variant="outline" disabled={pending}>
            Cancel
          </Button>
        </SheetClose>
        <Button type="submit" disabled={pending}>
          {pending && <Spinner data-icon="inline-start" />}
          {row ? "Save" : "Schedule"}
        </Button>
      </SheetFooter>
    </form>
  );
}
