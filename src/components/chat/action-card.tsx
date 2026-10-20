"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ConnectorLogo } from "@/components/connectors/connector-logo";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/errors";
import type { ConnectorToolCall } from "./connector-tool-call";
import { useThreadActionsContext } from "./thread-actions-context";

/**
 * The card for an action waiting in a reply (ADR 0002): the app, the target
 * and the content, with Approve and Cancel. The app is a connector, or a8
 * for a scheduled prompt (ADR 0013). a8 sends nothing to the app until the
 * user approves. Once they decide, the reply shows the call as a row
 * instead. It must be inside a ThreadActionsProvider.
 *
 * The catalog marks which arguments are the action's target. A tool without
 * marked targets shows every argument under Details.
 */
export function ActionCard({ call }: { call: ConnectorToolCall }) {
  const { decide: decideAction } = useThreadActionsContext();
  const [deciding, setDeciding] = useState<"approve" | "cancel">();
  const input = isRecord(call.input) ? call.input : {};
  const args = Object.entries(call.cardInput?.(input) ?? input);
  const isTarget = ([name]: [string, unknown]) =>
    call.target?.includes(name) ?? false;
  const target = args.filter(isTarget);
  const content = args.filter((arg) => !isTarget(arg));

  // A second click before the call ends does nothing.
  async function decide(approve: boolean) {
    if (deciding || !call.approval || !decideAction) return;
    setDeciding(approve ? "approve" : "cancel");
    try {
      await decideAction(call.approval.id, approve);
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
        <ConnectorLogo connector={call.app} size="md" />
        <h3 className="min-w-0 flex-1 truncate font-medium">{call.label}</h3>
        <span className="shrink-0 text-xs text-muted-foreground">
          Needs approval
        </span>
      </header>
      {call.target ? (
        <>
          <ActionDetail title="Target">
            {target.length > 0 ? (
              <ArgumentList entries={target} />
            ) : (
              <p>Default location in {call.app.name}</p>
            )}
          </ActionDetail>
          {content.length > 0 && (
            <ActionDetail title="Content">
              <ArgumentList entries={content} />
            </ActionDetail>
          )}
        </>
      ) : (
        args.length > 0 && (
          <ActionDetail title="Details">
            <ArgumentList entries={args} />
          </ActionDetail>
        )
      )}
      {decideAction && (
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
      )}
    </section>
  );
}

/**
 * Tells a screen reader, without interrupting it, when an action card shows
 * up. `calls` are the thread's waiting actions. The region stays in the page
 * with or without cards, because a screen reader announces a change to a
 * live region's text but not a region that's just been added.
 */
export function ActionCardAnnouncer({ calls }: { calls: ConnectorToolCall[] }) {
  return (
    <div role="status" className="sr-only">
      {calls.map((call) => `${call.label}, waiting for approval.`).join(" ")}
    </div>
  );
}

function ActionDetail({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
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
