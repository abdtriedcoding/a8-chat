import {
  BoxesIcon,
  CheckIcon,
  HashIcon,
  MailIcon,
  NotebookPenIcon,
  PlugIcon,
  ShieldCheckIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Feature = {
  icon: LucideIcon;
  title: string;
  description: string;
  points: string[];
  picture: ReactNode;
};

const FEATURES: Feature[] = [
  {
    icon: PlugIcon,
    title: "Connect apps in one click",
    description:
      "Sign in to Gmail, Slack or Notion the way you normally would. No config files, no API keys, no servers to run.",
    points: [
      "Gmail, Google Calendar, Slack, Notion and Linear",
      "Paste an MCP server link to add any other app",
    ],
    picture: <ConnectionsPicture />,
  },
  {
    icon: ShieldCheckIcon,
    title: "Nothing is sent without your OK",
    description:
      "Reading is instant. Anything that sends, changes or deletes shows up as a card first, with the recipient and the full text.",
    points: [
      "Edit any field before you approve",
      "Every action is saved to your activity log",
    ],
    picture: <ApprovalPicture />,
  },
  {
    icon: BoxesIcon,
    title: "Use any model you like",
    description:
      "Pick from hundreds of models on OpenRouter, and switch whenever a better or cheaper one comes out.",
    points: [
      "Filter by price, vision and tool support",
      "Not tied to one AI company",
    ],
    picture: <ModelsPicture />,
  },
];

export function Features() {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {FEATURES.map((feature) => (
        <Card key={feature.title} className="pt-0">
          <div
            aria-hidden="true"
            inert
            className="flex h-44 items-center justify-center border-b bg-muted/60 bg-dots p-5"
          >
            {feature.picture}
          </div>
          <CardHeader>
            <feature.icon className="mb-2 size-5 text-primary" />
            <CardTitle className="text-lg">
              <h3>{feature.title}</h3>
            </CardTitle>
            <CardDescription className="text-base leading-relaxed">
              {feature.description}
            </CardDescription>
          </CardHeader>
          <CardContent className="mt-auto">
            <ul className="flex flex-col gap-2.5">
              {feature.points.map((point) => (
                <li key={point} className="flex gap-2.5">
                  <CheckIcon className="mt-0.5 size-4 shrink-0 text-success" />
                  {point}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// The pictures below are small, static sketches of the real screens.

function ConnectionsPicture() {
  const apps = [
    { icon: MailIcon, name: "Gmail", connected: true },
    { icon: HashIcon, name: "Slack", connected: true },
    { icon: NotebookPenIcon, name: "Notion", connected: false },
  ];
  return (
    <div className="flex w-full max-w-64 flex-col divide-y rounded-xl border bg-card text-sm shadow-sm">
      {apps.map((app) => (
        <div key={app.name} className="flex h-11 items-center gap-2.5 px-3">
          <app.icon className="size-4 text-muted-foreground" />
          <span className="font-medium">{app.name}</span>
          {app.connected ? (
            <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-1.5 rounded-full bg-success" />
              Connected
            </span>
          ) : (
            <Button size="xs" className="ml-auto">
              Connect
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

function ApprovalPicture() {
  return (
    <div className="flex w-full max-w-64 flex-col gap-2.5 rounded-xl border bg-card p-3 text-sm shadow-sm">
      <p className="flex items-center gap-2 font-semibold">
        <HashIcon className="size-4 text-primary" />
        Post to #launch
      </p>
      <p className="text-muted-foreground">
        Launch is Thursday. Demo video is down to 60 seconds.
      </p>
      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" size="xs">
          Cancel
        </Button>
        <Button size="xs">Approve</Button>
      </div>
    </div>
  );
}

function ModelsPicture() {
  const models = [
    { name: "Claude", maker: "Anthropic" },
    { name: "GPT", maker: "OpenAI" },
    { name: "Gemini", maker: "Google" },
  ];
  return (
    <div className="flex w-full max-w-64 flex-col gap-0.5 rounded-xl border bg-card p-1.5 text-sm shadow-sm">
      {models.map((model, i) => (
        <div
          key={model.name}
          className={cn(
            "flex h-9 items-center gap-2 rounded-lg px-2.5",
            i === 0 && "bg-muted",
          )}
        >
          <span className="font-medium">{model.name}</span>
          <span className="text-muted-foreground">{model.maker}</span>
          {i === 0 && <CheckIcon className="ml-auto size-4 text-primary" />}
        </div>
      ))}
      <p className="px-2.5 pt-1 pb-1.5 text-xs text-muted-foreground">
        and hundreds more
      </p>
    </div>
  );
}
