"use client";

import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
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
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useInBrowser } from "@/hooks/use-in-browser";
import { errorMessage } from "@/lib/errors";
import { api } from "../../../convex/_generated/api";
import { MAX_RENAME_LENGTH } from "../../../convex/lib/prompt";
import type { Schedule } from "../../../convex/lib/schedule";
import { WEEKDAYS } from "../../../convex/lib/scheduleText";
import { browserTimeZone } from "../../../convex/lib/timeZone";

type Kind = Schedule["kind"];

const KINDS: { kind: Kind; label: string }[] = [
  { kind: "once", label: "Once" },
  { kind: "daily", label: "Daily" },
  { kind: "weekdays", label: "Weekdays" },
  { kind: "weekly", label: "Weekly" },
  { kind: "monthly", label: "Monthly" },
];

const DAYS_OF_MONTH = Array.from({ length: 31 }, (_, i) => i + 1);

/**
 * The browser's time zones, with its own zone and UTC in the list even when
 * the browser leaves them out.
 */
function timeZoneOptions(own: string) {
  const zones = new Set(Intl.supportedValuesOf("timeZone"));
  zones.add(own);
  zones.add("UTC");
  return [...zones].sort();
}

/** Today in `timeZone`, as "YYYY-MM-DD". */
function today(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(Date.now());
}

/**
 * The form that makes a scheduled prompt. It fills the time zone and date
 * from the browser, so it renders only once it's in one.
 */
export function ScheduledPromptForm() {
  if (!useInBrowser()) return <Skeleton className="h-96 w-full" />;
  return <CreateForm />;
}

function CreateForm() {
  const create = useMutation(api.scheduledPrompts.create);
  const router = useRouter();
  const [ownTimeZone] = useState(browserTimeZone);
  const [timeZones] = useState(() => timeZoneOptions(ownTimeZone));
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<Kind>("daily");
  const [date, setDate] = useState(() => today(ownTimeZone));
  const [time, setTime] = useState("09:00");
  const [days, setDays] = useState<string[]>(["1"]);
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [timeZone, setTimeZone] = useState(ownTimeZone);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  function schedule(): Schedule {
    switch (kind) {
      case "once":
        return { kind, date, time };
      case "weekly":
        return { kind, days: days.map(Number), time };
      case "monthly":
        return { kind, day: Number(dayOfMonth), time };
      default:
        return { kind, time };
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    setSaving(true);
    try {
      const { threadId } = await create({
        title,
        prompt,
        schedule: schedule(),
        timeZone,
      });
      setTitle("");
      setPrompt("");
      toast.success("Scheduled task created.", {
        action: {
          label: "Open chat",
          onClick: () => router.push(`/c/${threadId}`),
        },
      });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <form onSubmit={(event) => void save(event)} noValidate>
        <CardHeader>
          <CardTitle>New scheduled task</CardTitle>
          <CardDescription>
            It runs in a chat of its own, named after its title.
          </CardDescription>
        </CardHeader>
        <CardContent className="py-4">
          <FieldGroup className="gap-5">
            <Field>
              <FieldLabel htmlFor="scheduled-title">Title</FieldLabel>
              <Input
                id="scheduled-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Morning email digest"
                maxLength={MAX_RENAME_LENGTH}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="scheduled-prompt">Prompt</FieldLabel>
              <Textarea
                id="scheduled-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Summarize my unread email from yesterday."
                className="max-h-60"
              />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="scheduled-kind">Repeats</FieldLabel>
                <NativeSelect
                  id="scheduled-kind"
                  className="w-full"
                  value={kind}
                  onChange={(event) => setKind(event.target.value as Kind)}
                >
                  {KINDS.map((option) => (
                    <NativeSelectOption key={option.kind} value={option.kind}>
                      {option.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              {kind === "once" && (
                <Field>
                  <FieldLabel htmlFor="scheduled-date">Date</FieldLabel>
                  <Input
                    id="scheduled-date"
                    type="date"
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                  />
                </Field>
              )}
              {kind === "monthly" && (
                <Field>
                  <FieldLabel htmlFor="scheduled-day">Day of the month</FieldLabel>
                  <NativeSelect
                    id="scheduled-day"
                    className="w-full"
                    value={dayOfMonth}
                    onChange={(event) => setDayOfMonth(event.target.value)}
                  >
                    {DAYS_OF_MONTH.map((day) => (
                      <NativeSelectOption key={day} value={day}>
                        {day}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
              )}
              <Field>
                <FieldLabel htmlFor="scheduled-time">Time</FieldLabel>
                <Input
                  id="scheduled-time"
                  type="time"
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="scheduled-time-zone">Time zone</FieldLabel>
                <NativeSelect
                  id="scheduled-time-zone"
                  className="w-full"
                  value={timeZone}
                  onChange={(event) => setTimeZone(event.target.value)}
                >
                  {timeZones.map((zone) => (
                    <NativeSelectOption key={zone} value={zone}>
                      {zone}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            {kind === "weekly" && (
              <Field>
                <FieldLabel id="scheduled-days">Days</FieldLabel>
                <ToggleGroup
                  type="multiple"
                  variant="outline"
                  aria-labelledby="scheduled-days"
                  className="flex-wrap"
                  value={days}
                  onValueChange={setDays}
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
              </Field>
            )}
            {kind === "monthly" && Number(dayOfMonth) > 28 && (
              <p className="text-sm text-muted-foreground">
                In shorter months it runs on the last day.
              </p>
            )}
          </FieldGroup>
        </CardContent>
        <CardFooter className="flex-col items-start gap-3">
          {error && <FieldError>{error}</FieldError>}
          <Button type="submit" disabled={saving}>
            {saving && <Spinner data-icon="inline-start" />}
            Schedule
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
