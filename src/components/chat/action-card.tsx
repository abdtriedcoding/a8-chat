"use client";

import { cn } from "cn";
import {
  ChevronDownIcon,
  InfoIcon,
  TriangleAlertIcon,
  ZapIcon,
} from "lucide-react";
import { createContext, use, useState, type ReactNode } from "react";
import { ConnectorLogo } from "@/components/connectors/connector-logo";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useErrorToast } from "@/hooks/use-error-toast";
import {
  isRecord,
  summarizeAction,
  type ActionSummary,
  type KnownItems,
} from "./action-summary";
import { detailText, type ConnectorToolCall } from "./connector-tool-call";
import { useThreadActionsContext } from "./thread-actions-context";

/**
 * The card for an action waiting in a reply (ADR 0002): the app, the target
 * and the content, with Approve and Cancel. The app is a connector, or a8
 * for a scheduled prompt (ADR 0013). a8 sends nothing to the app until the
 * user approves. Once they decide, the reply shows the call as a row
 * instead. It must be inside a ThreadActionsProvider.
 *
 * A tool with a summary (action-summary.ts) leads with what happens in
 * plain words and keeps the arguments under "Show details". Any other tool
 * shows its arguments: the target the catalog marks, then the content, or
 * every argument under Details when it marks no target.
 */
/**
 * The items the thread's tool results named, by ID (knownItems), so a card
 * can name its target instead of showing an ID. The message list sets it.
 */
export const KnownItemsContext = createContext<KnownItems>(new Map());

export function ActionCard({ call }: { call: ConnectorToolCall }) {
  const { decide: decideAction } = useThreadActionsContext();
  const [deciding, setDeciding] = useState<"approve" | "cancel">();
  const showError = useErrorToast();
  const input = isRecord(call.input) ? call.input : {};
  const summary = summarizeAction(call.toolName, input, use(KnownItemsContext));
  // A destructive card that can't name its target opens on the arguments,
  // so the user sees what it deletes before approving.
  const [showDetails, setShowDetails] = useState(
    summary?.destructive === true && summary.title === undefined,
  );
  // A second click before the call ends does nothing.
  async function decide(approve: boolean) {
    if (deciding || !call.approval || !decideAction) return;
    setDeciding(approve ? "approve" : "cancel");
    try {
      await decideAction(call.approval.id, approve);
    } catch (error) {
      showError(error);
    } finally {
      setDeciding(undefined);
    }
  }

  return (
    <section
      aria-label={`${summary?.headline ?? call.label}, waiting for approval`}
      className="flex w-full flex-col gap-3 rounded-xl bg-card p-3 text-sm shadow-xs ring-1 ring-foreground/10"
    >
      <header className="flex items-center gap-2">
        <ConnectorLogo connector={call.app} size="md" />
        <h3 className="min-w-0 flex-1 font-medium">
          {summary?.headline ?? call.label}
        </h3>
        <span className="shrink-0 text-xs text-muted-foreground">
          Needs approval
        </span>
      </header>
      {summary ? (
        <>
          <SummaryBody summary={summary} />
          {showDetails && <ArgumentDetails call={call} input={input} />}
        </>
      ) : (
        <ArgumentDetails call={call} input={input} />
      )}
      {decideAction && (
        <footer className="flex items-center gap-2">
          {summary && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              aria-expanded={showDetails}
              onClick={() => setShowDetails((open) => !open)}
            >
              {showDetails ? "Hide details" : "Show details"}
              <ChevronDownIcon
                data-icon="inline-end"
                className={cn(
                  "transition-transform",
                  showDetails && "rotate-180",
                )}
              />
            </Button>
          )}
          <div className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            onClick={() => void decide(false)}
          >
            {deciding === "cancel" && <Spinner data-icon="inline-start" />}
            Cancel
          </Button>
          <Button
            size="sm"
            variant={summary?.destructive ? "destructive" : "default"}
            onClick={() => void decide(true)}
          >
            {deciding === "approve" && <Spinner data-icon="inline-start" />}
            {summary?.verb ?? "Approve"}
          </Button>
        </footer>
      )}
    </section>
  );
}

/**
 * The record an action leaves when the thread's auto-approve ran it without
 * a card (ADR 0014): the app, what it did and an "Auto-approved" marker,
 * with the arguments and the result under "Show details". A failed one says
 * so and keeps the error under details, like a failed row. `running` is
 * true only while the call runs in a streaming reply.
 */
export function AutoApprovedRecord({
  call,
  running,
}: {
  call: ConnectorToolCall;
  running: boolean;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const input = isRecord(call.input) ? call.input : {};
  const summary = summarizeAction(call.toolName, input, use(KnownItemsContext));
  const headline = summary?.headline ?? call.label;
  const failed = call.state === "output-error";
  // Approved, but the user stopped the reply before it ran.
  const stopped = call.state === "approval-responded" && !running;

  return (
    <section
      aria-label={`${headline}, auto-approved`}
      className="flex w-full flex-col gap-2 rounded-xl bg-card p-3 text-sm shadow-xs ring-1 ring-foreground/10"
    >
      <header className="flex items-start gap-2">
        <ConnectorLogo connector={call.app} size="md" />
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className={cn("font-medium break-words", running && "shimmer")}>
            {headline}
          </h3>
          {summary?.title && (
            <p className="truncate text-muted-foreground">{summary.title}</p>
          )}
        </div>
        <span className="flex shrink-0 items-center gap-1 pt-0.5 text-xs text-muted-foreground">
          <ZapIcon className="size-3.5" />
          Auto-approved
        </span>
      </header>
      {(failed || stopped) && (
        <p
          className={cn(
            "flex items-center gap-1.5 text-xs",
            failed ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {failed && <TriangleAlertIcon className="size-3.5 shrink-0" />}
          {failed ? "This action failed." : "Stopped before it ran."}
        </p>
      )}
      {showDetails && (
        <>
          <ArgumentDetails call={call} input={input} />
          {failed ? (
            <ActionDetail title="Error">
              <ResultText value={call.errorText} />
            </ActionDetail>
          ) : (
            call.state === "output-available" && (
              <ActionDetail title="Result">
                <ResultText value={call.output} />
              </ActionDetail>
            )
          )}
        </>
      )}
      <Button
        variant="ghost"
        size="xs"
        className="-ml-1 self-start text-muted-foreground"
        aria-expanded={showDetails}
        onClick={() => setShowDetails((open) => !open)}
      >
        {showDetails ? "Hide details" : "Show details"}
        <ChevronDownIcon
          data-icon="inline-end"
          className={cn("transition-transform", showDetails && "rotate-180")}
        />
      </Button>
    </section>
  );
}

function ResultText({ value }: { value: unknown }) {
  return (
    <pre className="font-mono text-xs break-words whitespace-pre-wrap">
      {detailText(value)}
    </pre>
  );
}

/** What happens, in plain words: the item's name, short fields and a preview. */
function SummaryBody({ summary }: { summary: ActionSummary }) {
  const { title, fields, preview, note, destructive } = summary;
  const NoteIcon = destructive ? TriangleAlertIcon : InfoIcon;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {title && <p className="text-base font-semibold break-words">{title}</p>}
      {fields.length > 0 && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
          {/* Labels can repeat, like two tasks due "today". */}
          {fields.map(({ label, value }, i) => (
            <div key={i} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="break-words">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {preview && (
        <div className="rounded-md border bg-muted/40 p-2.5 text-muted-foreground">
          <p className="line-clamp-4 break-words whitespace-pre-wrap">
            {preview}
          </p>
        </div>
      )}
      {note && (
        <p
          className={cn(
            "flex items-center gap-1.5 text-xs",
            destructive ? "text-destructive" : "text-muted-foreground",
          )}
        >
          <NoteIcon className="size-3.5 shrink-0" />
          {note}
        </p>
      )}
    </div>
  );
}

/**
 * The call's arguments as they go to the app. The catalog marks which are
 * the target. A tool without marked targets shows every argument under
 * Details.
 */
function ArgumentDetails({
  call,
  input,
}: {
  call: ConnectorToolCall;
  input: Record<string, unknown>;
}) {
  const args = Object.entries(call.cardInput?.(input) ?? input);
  const isTarget = ([name]: [string, unknown]) =>
    call.target?.includes(name) ?? false;
  const target = args.filter(isTarget);
  const content = args.filter((arg) => !isTarget(arg));
  if (!call.target) {
    return (
      args.length > 0 && (
        <ActionDetail title="Details">
          <ArgumentList entries={args} />
        </ActionDetail>
      )
    );
  }
  return (
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
  );
}

/**
 * Tells a screen reader, without interrupting it, when an action card shows
 * up. `calls` are the thread's waiting actions. The region stays in the page
 * with or without cards, because a screen reader announces a change to a
 * live region's text but not a region that's just been added.
 */
export function ActionCardAnnouncer({ calls }: { calls: ConnectorToolCall[] }) {
  const known = use(KnownItemsContext);
  return (
    <div role="status" className="sr-only">
      {calls
        .map((call) => {
          const input = isRecord(call.input) ? call.input : {};
          const headline = summarizeAction(
            call.toolName,
            input,
            known,
          )?.headline;
          return `${headline ?? call.label}, waiting for approval.`;
        })
        .join(" ")}
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
