import type { ReactNode } from "react";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";

export default function MarketingLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <main className="flex flex-1 flex-col bg-muted">{children}</main>
      <SiteFooter />
    </>
  );
}
