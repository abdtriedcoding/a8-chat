"use client";

import Image from "next/image";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/errors";
import type { ConnectorToolCall } from "./connector-tool-call";

/**
 * An argument that says where the action happens, like `parent`, `page_id`
 * or `page_or_database_ids`. The card shows these as the target and every
 * other argument as the content.
 */
const TARGET_ARGUMENT = /(^|_)(parent|ids?)$/i;

/** Approves or cancels the action waiting on the card with this approval ID. */
export type DecideAction = (
  approvalId: string,
  approve: boolean,
) => Promise<void>;

/**
 * The card for an action waiting in a reply (ADR 0002): the connector, the
 * target and the content, with Approve and Cancel. a8 sends nothing to the
 * app until the user approves. Once they decide, the reply shows the call as
 * a row instead.
 */
export function ActionCard({
  call,
  onDecide,
}: {
  call: ConnectorToolCall;
  onDecide: DecideAction;
}) {
  const [deciding, setDeciding] = useState<"approve" | "cancel">();
  const args = Object.entries(isRecord(call.input) ? call.input : {});
  const target = args.filter(([name]) => TARGET_ARGUMENT.test(name));
  const content = args.filter(([name]) => !TARGET_ARGUMENT.test(name));

  // A second click before the call ends does nothing.
  async function decide(approve: boolean) {
    if (deciding || !call.approval) return;
    setDeciding(approve ? "approve" : "cancel");
    try {
      await onDecide(call.approval.id, approve);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDeciding(undefined);
    }
  }

  return (
    <section
      aria-label={`${call.label}, waiting for approval`}
      className="flex w-full flex-col gap-3 rounded-xl bg-card p-3 text-sm shadow-xs ring-1 ring-foreground/10"
    >
      <header className="flex items-center gap-2">
        {/* Logos are drawn for a light background, so they get a white one in both themes. */}
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-white ring-1 ring-foreground/10">
          <Image src={call.connector.logo} alt="" width={16} height={16} />
        </span>
        <h3 className="min-w-0 flex-1 truncate font-medium">{call.label}</h3>
        <span className="shrink-0 text-xs text-muted-foreground">
          Needs approval
        </span>
      </header>
      <ActionDetail title="Target">
        {target.length > 0 ? (
          <ArgumentList entries={target} />
        ) : (
          <p>Default location in {call.connector.name}</p>
        )}
      </ActionDetail>
      {content.length > 0 && (
        <ActionDetail title="Content">
          <ArgumentList entries={content} />
        </ActionDetail>
      )}
      <footer className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void decide(false)}
        >
          {deciding === "cancel" && <Spinner data-icon="inline-start" />}
          Cancel
        </Button>
        <Button size="sm" onClick={() => void decide(true)}>
          {deciding === "approve" && <Spinner data-icon="inline-start" />}
          Approve
        </Button>
      </footer>
    </section>
  );
}

function ActionDetail({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-1">
      <h4 className="text-xs font-medium text-muted-foreground">{title}</h4>
      <div className="max-h-72 overflow-y-auto rounded-md border bg-muted/40 p-2.5">
        {children}
      </div>
    </section>
  );
}

/** Arguments as labelled values. Nested objects indent under their name. */
function ArgumentList({ entries }: { entries: [string, unknown][] }) {
  return (
    <dl className="flex flex-col gap-1.5">
      {entries.map(([name, value]) => (
        <div key={name} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">
            {argumentLabel(name)}
          </dt>
          <dd className="min-w-0">
            <ArgumentValue value={value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ArgumentValue({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    // A list of one, like the single page in notion-create-pages, reads
    // better without a number.
    if (value.length === 1) return <ArgumentValue value={value[0]} />;
    return (
      <ol className="flex list-decimal flex-col gap-2 pl-5">
        {value.map((item, i) => (
          <li key={i}>
            <ArgumentValue value={item} />
          </li>
        ))}
      </ol>
    );
  }
  if (isRecord(value)) {
    return (
      <div className="border-l pl-3">
        <ArgumentList entries={Object.entries(value)} />
      </div>
    );
  }
  return <p className="break-words whitespace-pre-wrap">{String(value)}</p>;
}

/** An argument's name as a label, so `page_id` reads "Page id". */
function argumentLabel(name: string): string {
  const words = name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
