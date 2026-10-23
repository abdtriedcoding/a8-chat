import type { Metadata } from "next";
import { ConnectorList } from "@/components/connectors/connector-list";
import { PageShell } from "@/components/page-shell";

export const metadata: Metadata = { title: "Connectors" };

export default function ConnectorsPage() {
  return (
    <PageShell title="Connectors">
      <p className="text-muted-foreground">
        Connect the apps you work in, and a8 can search, read and write in
        them.
      </p>
      <ConnectorList />
    </PageShell>
  );
}

