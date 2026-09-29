import {
  ArrowRightIcon,
  CalendarDaysIcon,
  HashIcon,
  LockKeyholeIcon,
  MailIcon,
  NotebookPenIcon,
  ServerIcon,
  SquareKanbanIcon,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ChatDemo } from "@/components/landing/chat-demo";
import { Faq } from "@/components/landing/faq";
import { Features } from "@/components/landing/features";
import { GitHubIcon } from "@/components/landing/github-icon";
import { Highlight } from "@/components/landing/highlight";
import { Pricing } from "@/components/landing/pricing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GITHUB_URL } from "@/lib/site";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: { absolute: "a8: the AI chat that does the work in your apps" },
  description:
    "Connect Gmail, Slack, Google Calendar, Notion and Linear, pick any AI model, and ask. a8 does the task and waits for your OK before anything is sent. Open source.",
};

const APPS: { icon: LucideIcon; name: string; handle: string }[] = [
  { icon: MailIcon, name: "Gmail", handle: "gmail" },
  { icon: CalendarDaysIcon, name: "Google Calendar", handle: "calendar" },
  { icon: HashIcon, name: "Slack", handle: "slack" },
  { icon: NotebookPenIcon, name: "Notion", handle: "notion" },
  { icon: SquareKanbanIcon, name: "Linear", handle: "linear" },
];

export default function LandingPage() {
  return (
    <>
      <Hero />
      <WorksWith />
      <WithoutSwitchingTabs />
      <Section
        title="It does the task. You make the call."
        description="Connect your apps once, pick a model, and ask for what you need in plain words."
      >
        <Features />
      </Section>
      <OpenSource />
      <Section
        id="pricing"
        title="Pricing"
        description="Start free. Upgrade when a8 becomes part of your day."
      >
        <Pricing />
        <p className="mt-8 text-center text-sm text-muted-foreground">
          A credit is one US cent of model cost. A typical reply on a cheap
          model uses about one credit.
        </p>
      </Section>
      <Section id="faq" title="Common questions" className="max-w-3xl">
        <Faq />
      </Section>
      <FinalCta />
    </>
  );
}

function Hero() {
  return (
    <section className="px-4 pt-16 pb-8 sm:px-6 sm:pt-24">
      <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
        <Badge asChild variant="outline" className="h-8 gap-2 bg-card px-3.5 text-sm">
          <a href={GITHUB_URL}>
            <GitHubIcon data-icon="inline-start" />
            Open source · Free to self-host
          </a>
        </Badge>
        <h1 className="mt-6 text-5xl font-bold tracking-tight text-balance sm:text-6xl md:text-7xl">
          The AI chat that <Highlight>does the work</Highlight> in your apps
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-pretty text-muted-foreground sm:text-xl">
          a8 goes into your Gmail, Slack, Google Calendar, Notion and Linear
          and does the task for you.{" "}
          <strong className="font-semibold text-foreground">
            You just approve it.
          </strong>
        </p>
        <div className="mt-10 flex w-full flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild size="xl" className="w-full sm:w-auto sm:min-w-56">
            <Link href="/sign-up">
              Start for free
              <ArrowRightIcon data-icon="inline-end" />
            </Link>
          </Button>
          <Button asChild size="xl" variant="outline" className="w-full sm:w-auto">
            <a href={GITHUB_URL}>
              <GitHubIcon data-icon="inline-start" />
              View on GitHub
            </a>
          </Button>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Free plan, no card needed. Or run it on your own server.
        </p>
      </div>
      <ChatDemo className="mt-16 sm:mt-20" />
    </section>
  );
}

function WorksWith() {
  return (
    <section className="px-4 py-16 sm:px-6">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-5 text-center">
        <h2 className="text-sm font-medium text-balance text-muted-foreground">
          Works with the apps you already use. Type @ to pick one.
        </h2>
        <ul className="flex flex-wrap justify-center gap-2">
          {APPS.map((app) => (
            <li
              key={app.handle}
              className="flex h-10 items-center gap-2 rounded-lg border bg-card px-3 text-sm font-medium shadow-xs"
            >
              <app.icon className="size-4 text-muted-foreground" />
              {app.name}
              <span className="text-primary">@{app.handle}</span>
            </li>
          ))}
          <li className="flex h-10 items-center rounded-lg border border-dashed border-input px-3 text-sm font-medium text-muted-foreground">
            Any MCP server
          </li>
        </ul>
      </div>
    </section>
  );
}

function WithoutSwitchingTabs() {
  return (
    <section className="px-4 py-20 sm:px-6 sm:py-28">
      <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
        <h2 className="text-4xl font-bold tracking-tight sm:text-6xl">
          <Highlight>Without switching tabs:</Highlight>
        </h2>
        <p className="mt-8 flex flex-col gap-2 text-3xl font-semibold tracking-tight sm:text-5xl">
          <span className="text-muted-foreground/70">catch up on #launch.</span>
          <span className="text-muted-foreground">write the client update.</span>
          <span className="text-foreground">approve it, and it&apos;s sent.</span>
        </p>
        <Button asChild size="xl" className="mt-12 w-full max-w-sm">
          <Link href="/sign-up">
            Try it free
            <ArrowRightIcon data-icon="inline-end" />
          </Link>
        </Button>
      </div>
    </section>
  );
}

function OpenSource() {
  const points = [
    {
      icon: ServerIcon,
      title: "Self-host for free",
      text: "Every feature, on your own server, with one OpenRouter key.",
    },
    {
      icon: LockKeyholeIcon,
      title: "Tokens stay encrypted",
      text: "Your app tokens never reach the browser or the model.",
    },
    {
      icon: GitHubIcon,
      title: "Built in public",
      text: "Decisions and weekly progress notes live in the repo.",
    },
  ];
  return (
    <section className="px-4 py-20 sm:px-6">
      <div className="mx-auto grid max-w-6xl items-center gap-10 rounded-3xl border bg-card p-6 shadow-sm sm:p-12 lg:grid-cols-2 lg:gap-16">
        <div className="flex flex-col items-start">
          <Badge variant="secondary">AGPL-3.0</Badge>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            Open source, and yours to run
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            All of a8 is on GitHub. Read exactly what it does with your inbox,
            or run it on your own server for free.
          </p>
          <ul className="mt-8 flex flex-col gap-5">
            {points.map((point) => (
              <li key={point.title} className="flex gap-3.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-highlight text-primary">
                  <point.icon className="size-4" />
                </span>
                <span>
                  <span className="block font-semibold">{point.title}</span>
                  <span className="text-muted-foreground">{point.text}</span>
                </span>
              </li>
            ))}
          </ul>
          <Button asChild size="lg" variant="outline" className="mt-8">
            <a href={GITHUB_URL}>
              <GitHubIcon data-icon="inline-start" />
              View on GitHub
            </a>
          </Button>
        </div>
        <Terminal />
      </div>
    </section>
  );
}

function Terminal() {
  return (
    <div className="min-w-0 overflow-hidden rounded-xl bg-foreground text-background shadow-lg">
      <div className="flex items-center gap-1.5 border-b border-background/10 px-4 py-3">
        <span className="size-3 rounded-full bg-background/20" />
        <span className="size-3 rounded-full bg-background/20" />
        <span className="size-3 rounded-full bg-background/20" />
      </div>
      <pre className="overflow-x-auto p-5 font-mono text-sm leading-7">
        <code>
          <Prompt />
          git clone {GITHUB_URL}
          {"\n"}
          <Prompt />
          cd a8-chat
          {"\n"}
          <Prompt />
          cp .env.example .env{" "}
          <span className="text-background/50"># add your OpenRouter key</span>
          {"\n"}
          <Prompt />
          docker compose up
        </code>
      </pre>
    </div>
  );
}

function Prompt() {
  return <span className="text-background/50 select-none">$ </span>;
}

function FinalCta() {
  return (
    <section className="px-4 pt-8 pb-24 sm:px-6">
      <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
        <h2 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl">
          Start with the app you use most
        </h2>
        <p className="mt-4 text-lg text-muted-foreground">
          Connect it, ask for something, and see what a8 drafts. You can add
          the rest later.
        </p>
        <Button asChild size="xl" className="mt-10 w-full max-w-sm">
          <Link href="/sign-up">
            Try a8 free
            <ArrowRightIcon data-icon="inline-end" />
          </Link>
        </Button>
      </div>
    </section>
  );
}

function Section({
  id,
  title,
  description,
  className,
  children,
}: {
  id?: string;
  title: string;
  description?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-16 px-4 py-20 sm:px-6">
      <div className={cn("mx-auto max-w-6xl", className)}>
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <h2 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl">
            {title}
          </h2>
          {description && (
            <p className="mt-4 text-lg text-pretty text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {children}
      </div>
    </section>
  );
}
