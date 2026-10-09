import { MessageSquareIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import type { Connector } from "../../../convex/lib/connectors";

/**
 * One catalog entry on the Connectors page. The example prompt opens a new
 * chat with that prompt in the composer, unsent.
 */
export function ConnectorCard({ connector }: { connector: Connector }) {
  const { name, handle, logo, description, examplePrompt } = connector;
  return (
    <Card size="sm">
      <CardHeader className="flex items-center gap-3">
        {/* Logos are drawn for a light background, so they get a white one in both themes. */}
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-foreground/10">
          <Image src={logo} alt="" width={24} height={24} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-heading font-medium">{name}</h2>
          <p className="text-muted-foreground">@{handle}</p>
        </div>
        {/* Doesn't connect anything yet. */}
        <Switch disabled aria-label={`Connect ${name}`} />
      </CardHeader>
      <CardContent>
        <p>{description}</p>
        <Link
          href={`/chat?prompt=${encodeURIComponent(examplePrompt)}`}
          className="flex items-start gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-left outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <MessageSquareIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 break-words">{examplePrompt}</span>
        </Link>
      </CardContent>
    </Card>
  );
}
