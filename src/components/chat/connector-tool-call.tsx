import { ChevronRightIcon } from "lucide-react";
import Image from "next/image";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { ThreadMessage } from "@/lib/stopped-turns";
import {
  findConnectorTool,
  type Connector,
} from "../../../convex/lib/connectors";

/** A reply's call to a connector tool (convex/lib/connectorTools.ts). */
export type ConnectorToolCall = {
  id: string;
  connector: Connector;
  label: string;
  state: string;
  // Partial while the model is still writing it.
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

/** The reply's connector tool calls, in the order the model made them. */
export function connectorToolCalls(message: ThreadMessage): ConnectorToolCall[] {
  return message.parts.flatMap((part) => {
    if (!part.type.startsWith("tool-")) return [];
    const found = findConnectorTool(part.type.slice("tool-".length));
    if (!found) return [];
    // The UI message doesn't know the tool's types, so this reads the
    // fields every tool part has.
    const call = part as unknown as {
      toolCallId: string;
      state: string;
      input?: unknown;
      output?: unknown;
      errorText?: string;
    };
    // A saved reply loses the error state: the Agent shows the AI SDK's
    // "Error: ..." text as a result. A connector tool's own results always
    // start with its untrusted-data tag, so that text means the call failed.
    const savedError =
      call.state === "output-available" &&
      typeof call.output === "string" &&
      call.output.startsWith("Error: ");
    return [
      {
        id: call.toolCallId,
        ...found,
        state: savedError ? "output-error" : call.state,
        input: call.input,
        output: call.output,
        errorText: savedError ? (call.output as string) : call.errorText,
      },
    ];
  });
}

/** Whether a call is still running, without a result or an error yet. */
export function isRunning(call: ConnectorToolCall): boolean {
  return call.state === "input-streaming" || call.state === "input-available";
}

/**
 * One connector tool call in a reply: the connector's logo and a label like
 * "Searching Notion". Opening it shows the arguments and the result.
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
  const failed = call.state === "output-error";
  return (
    <Collapsible className="w-full">
      <CollapsibleTrigger className="group/trigger flex max-w-full items-center gap-2 rounded-md text-left text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
        {/* Logos are drawn for a light background, so they get a white one in both themes. */}
        <span className="flex size-5 shrink-0 items-center justify-center rounded-sm bg-white ring-1 ring-foreground/10">
          <Image src={call.connector.logo} alt="" width={14} height={14} />
        </span>
        <span className={running ? "shimmer truncate" : "truncate"}>
          {call.label}
          {failed && " failed"}
        </span>
        <ChevronRightIcon className="size-3.5 shrink-0 transition-transform group-data-[state=open]/trigger:rotate-90" />
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
  const text =
    typeof value === "string" ? value : JSON.stringify(value ?? {}, null, 2);
  return (
    <section className="flex min-w-0 flex-col gap-1">
      <h3 className="font-medium text-muted-foreground">{title}</h3>
      <pre className="max-h-64 overflow-auto font-mono break-words whitespace-pre-wrap">
        {text}
      </pre>
    </section>
  );
}
