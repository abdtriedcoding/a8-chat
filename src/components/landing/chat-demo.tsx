import { cn } from "cn";
import {
  ArrowUpIcon,
  CheckIcon,
  MailIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { AppIcon } from "@/components/icons/app-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Mention } from "./highlight";

const THREADS = [
  "Launch update",
  "Move Friday's 1:1",
  "Open bugs in Linear",
  "Invoice reminders",
];

/**
 * A static picture of the product: the 30-second demo from the spec. It's
 * inert, so none of its buttons can be focused or clicked, and screen readers
 * get the caption instead.
 */
export function ChatDemo({ className }: { className?: string }) {
  return (
    <figure className={cn("mx-auto w-full max-w-5xl", className)}>
      <figcaption className="sr-only">
        An example chat. a8 reads the launch issues in Linear and lists what&apos;s
        left, then writes an email draft to a client in Gmail and waits for
        approval before saving it.
      </figcaption>
      <div
        aria-hidden="true"
        inert
        className="overflow-hidden rounded-2xl border bg-card shadow-2xl shadow-primary/10"
      >
        <div className="flex h-11 items-center gap-1.5 border-b px-4">
          <span className="size-3 rounded-full bg-border" />
          <span className="size-3 rounded-full bg-border" />
          <span className="size-3 rounded-full bg-border" />
        </div>
        <div className="flex">
          <div className="hidden w-56 shrink-0 flex-col gap-1 border-r p-3 md:flex">
            <Button variant="outline" size="sm" className="justify-start">
              <PlusIcon data-icon="inline-start" />
              New chat
            </Button>
            <p className="px-2 pt-4 pb-1 text-xs font-medium text-muted-foreground">
              Today
            </p>
            {THREADS.map((title, i) => (
              <p
                key={title}
                className={cn(
                  "truncate rounded-md px-2 py-1.5 text-sm",
                  i === 0 ? "bg-muted font-medium" : "text-muted-foreground",
                )}
              >
                {title}
              </p>
            ))}
          </div>

          <div className="flex min-w-0 flex-1 flex-col bg-muted/60 bg-dots">
            <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-6 text-left sm:px-8 sm:py-8">
              <UserMessage>
                <Mention>@linear</Mention> what&apos;s left before
                Thursday&apos;s launch?
              </UserMessage>

              <AssistantMessage step="Read 12 issues in the Launch project">
                <p>Three issues are still open:</p>
                <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
                  <li>Priya ships the pricing page by Wednesday.</li>
                  <li>The demo video gets cut to 60 seconds.</li>
                  <li>Sam reviews the launch checklist on Thursday.</li>
                </ul>
              </AssistantMessage>

              <UserMessage>
                <Mention>@gmail</Mention> draft an update to the client about
                the launch
              </UserMessage>

              <AssistantMessage step="Wrote an email draft">
                <ApprovalCard />
              </AssistantMessage>
            </div>

            <div className="mt-auto border-t bg-card px-4 py-3 sm:px-8">
              <InputGroup className="mx-auto max-w-2xl">
                <InputGroupTextarea
                  rows={1}
                  placeholder="Ask a8 to do something…"
                  className="min-h-0"
                />
                <InputGroupAddon align="block-end">
                  <Badge variant="secondary">
                    @linear
                    <XIcon data-icon="inline-end" />
                  </Badge>
                  <Badge variant="secondary">
                    @gmail
                    <XIcon data-icon="inline-end" />
                  </Badge>
                  <InputGroupButton
                    variant="default"
                    size="icon-sm"
                    className="ml-auto"
                  >
                    <ArrowUpIcon />
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
}

export function UserMessage({ children }: { children: ReactNode }) {
  return (
    <p className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-card px-4 py-2.5 text-sm leading-relaxed shadow-xs ring-1 ring-foreground/5">
      {children}
    </p>
  );
}

function AssistantMessage({
  step,
  children,
}: {
  step: string;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <AppIcon className="size-7" />
      <div className="flex min-w-0 flex-1 flex-col gap-2 text-sm leading-relaxed">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CheckIcon className="size-3.5 text-success" />
          {step}
        </p>
        <div>{children}</div>
      </div>
    </div>
  );
}

export function ApprovalCard() {
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b px-4 py-3">
        <p className="flex items-center gap-2 font-semibold whitespace-nowrap">
          <MailIcon className="size-4 text-primary" />
          Write a Gmail draft
        </p>
        <Badge variant="secondary">Waiting for you</Badge>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-b px-4 py-3">
        <dt className="text-muted-foreground">To</dt>
        <dd className="truncate">maria@example.com</dd>
        <dt className="text-muted-foreground">Subject</dt>
        <dd className="truncate">Launch update</dd>
      </dl>
      <div className="flex flex-col gap-3 px-4 py-3">
        <p>Hi Maria,</p>
        <p>
          Quick update on the launch. We&apos;re on track for Thursday, the
          pricing page goes live on Wednesday, and the demo video is down to 60
          seconds. I&apos;ll send you the final cut Wednesday night.
        </p>
        <p>
          Thanks,
          <br />
          Sam
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-muted/50 px-4 py-3">
        <Button variant="ghost" size="sm">
          Cancel
        </Button>
        <Button size="sm">
          <CheckIcon data-icon="inline-start" />
          Save draft
        </Button>
      </div>
    </div>
  );
}
