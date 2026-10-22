import type { ReactNode } from "react";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";
import { VisitorProvider } from "@/components/landing/visitor";

// Static. The parts that depend on the visitor load in the browser.
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <VisitorProvider>
      <SiteHeader />
      <main className="flex flex-1 flex-col bg-muted dark:bg-background">{children}</main>
      <SiteFooter />
    </VisitorProvider>
  );
}
