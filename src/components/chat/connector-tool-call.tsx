import { cn } from "cn";
import { ChevronRightIcon } from "lucide-react";
import { ConnectorLogo } from "@/components/connectors/connector-logo";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { ThreadMessage } from "@/lib/stopped-turns";
import {
  findA8Tool,
  findConnectorTool,
  isReconnectError,
  type ConnectorView,
  type FoundA8Tool,
  type ToolApp,
} from "../../../convex/lib/connectorView";

/**
 * A tool call row's pill: the app's logo and the label, so a reply's calls
 * to different apps tell apart at a glance.
 */
const TOOL_PILL =
  "flex w-fit max-w-full items-center gap-2 rounded-full bg-card py-1 pr-3 pl-1 text-sm font-medium ring-1 ring-foreground/10 shadow-xs";

/**
 * A reply's call to a connector tool (convex/lib/connectorTools.ts), or to
 * one of a8's scheduled prompt tools (convex/tools/scheduledPrompts.ts).
 */
export type ConnectorToolCall = {
  id: string;
  /** The tool's model name, like `gmail__create_draft`. */
  toolName: string;
  /** The connector, or a8 for a scheduled prompt tool. */
  app: ToolApp;
  /** The connector, unset for a scheduled prompt tool. */
  connector?: ConnectorView;
  label: string;
  /** The tool's target arguments from the catalog, if it marks any. */
  target?: readonly string[];
  /** Set for a scheduled prompt tool (FoundA8Tool). */
  cardInput?: FoundA8Tool["cardInput"];
  /**
   * Unset on a call in a shared snapshot, which keeps only the tool's name
   * (convex/lib/sharedMessages.ts).
   */
  state?: string;
  // Partial while the model is still writing it.
  input?: unknown;
  output?: unknown;
  errorText?: string;
  /**
   * Set on an action (ADR 0002). `approved` is undefined while its card
   * waits, and set once the user decides. `isAutomatic` is set on an action
   * the thread's auto-approve ran without a card (ADR 0014).
   */
  approval?: { id: string; approved?: boolean; isAutomatic?: boolean };
};

/**
 * The reply's connector and scheduled prompt tool calls, in the order the
 * model made them.
 */
export function connectorToolCalls(message: ThreadMessage): ConnectorToolCall[] {
  return message.parts.flatMap((part) => {
    if (!part.type.startsWith("tool-")) return [];
    const name = part.type.slice("tool-".length);
    const connectorTool = findConnectorTool(name);
    const found = connectorTool
      ? { app: connectorTool.connector, ...connectorTool }
      : findA8Tool(name);
    if (!found) return [];
    // The UI message doesn't know the tool's types, so this reads the
    // fields every tool part has.
    const call = part as unknown as {
      toolCallId: string;
      state?: string;
      input?: unknown;
      output?: unknown;
      errorText?: string;
      approval?: { id: string; approved?: boolean; isAutomatic?: boolean };
    };
    return [
      {
        id: call.toolCallId,
        toolName: name,
        ...found,
        state: call.state,
        input: call.input,
        output: call.output,
        errorText: call.errorText,
        approval: call.approval && {
          id: call.approval.id,
          approved: call.approval.approved,
          isAutomatic: call.approval.isAutomatic,
        },
      },
    ];
  });
}

/**
 * Whether a call is still running, without a result or an error yet. An
 * approved action counts from the click on Approve.
 */
export function isRunning(call: ConnectorToolCall): boolean {
  return (
    call.state === "input-streaming" ||
    call.state === "input-available" ||
    (call.state === "approval-responded" && call.approval?.approved === true)
  );
}

/** Whether the thread's auto-approve ran the action without a card. */
export function isAutoApproved(call: ConnectorToolCall): boolean {
  return call.approval?.isAutomatic === true;
}

/** Whether a call is an action whose card is waiting for the user. */
function isWaitingForApproval(call: ConnectorToolCall): boolean {
  return call.state === "approval-requested" && !isAutoApproved(call);
}

/**
 * The reply's actions whose cards show. A stopped reply can't continue, so
 * its waiting actions show as rows.
 */
export function replyWaitingActions(
  toolCalls: ConnectorToolCall[],
  stopped: boolean,
): ConnectorToolCall[] {
  return stopped ? [] : toolCalls.filter(isWaitingForApproval);
}

/** Whether a call failed because its connection needs reconnecting. */
export function failedNeedingReconnect(call: ConnectorToolCall): boolean {
  return call.state === "output-error" && isReconnectError(call.errorText);
}

/**
 * Whether the user cancelled the action, on its card or by sending a new
 * prompt while the card waited.
 */
function isCancelled(call: ConnectorToolCall): boolean {
  return call.approval?.approved === false;
}

/**
 * One connector or scheduled prompt tool call in a reply: the app's logo
 * and a label like "Searching Notion". Opening it shows the arguments and
 * the result. A call in a shared snapshot shows only its label, since the
 * snapshot keeps nothing else.
 *
 * `running` is false for a call a stopped reply left unfinished.
 */
export function ConnectorToolRow({
  call,
  running,
}: {
  call: ConnectorToolCall;
  running: boolean;
}) {
  if (call.state === undefined) {
    return (
      <div className={TOOL_PILL}>
        <ConnectorLogo
          connector={call.app}
          size="md"
          className="rounded-full"
        />
        <span className="truncate">{call.label}</span>
      </div>
    );
  }
  const failed = call.state === "output-error";
  const cancelled = isCancelled(call);
  // Approved, but the user stopped the reply before it ran.
  const stopped = call.state === "approval-responded" && !running;
  return (
    <Collapsible className="w-full">
      <CollapsibleTrigger
        className={cn(
          TOOL_PILL,
          "group/trigger text-left transition-colors outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50",
        )}
      >
        <ConnectorLogo
          connector={call.app}
          size="md"
          className="rounded-full"
        />
        <span className={running ? "shimmer truncate" : "truncate"}>
          {call.label}
          {failed && " failed"}
          {cancelled && " cancelled"}
          {stopped && !cancelled && " stopped"}
        </span>
        <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/trigger:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 flex flex-col gap-2 rounded-md border bg-muted/40 p-3 text-xs">
        <ToolCallDetail title="Arguments" value={call.input} />
        {failed ? (
          <ToolCallDetail title="Error" value={call.errorText} />
        ) : (
          call.state === "output-available" && (
            <ToolCallDetail title="Result" value={call.output} />
          )
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function ToolCallDetail({ title, value }: { title: string; value: unknown }) {
  const text = detailText(value);
  return (
    <section className="flex min-w-0 flex-col gap-1">
      <h3 className="font-medium text-muted-foreground">{title}</h3>
      <pre className="max-h-64 overflow-auto font-mono break-words whitespace-pre-wrap">
        {text}
      </pre>
    </section>
  );
}

/** A call's result or error as text, with JSON laid out over lines. */
export function detailText(value: unknown): string {
  return typeof value === "string"
    ? value
    : JSON.stringify(value ?? {}, null, 2);
}
