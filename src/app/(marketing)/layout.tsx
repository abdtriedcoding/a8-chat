import type { ReactNode } from "react";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";
import { isAuthenticated } from "@/lib/auth-server";

export default async function MarketingLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Cached: the root layout already fetched this request's token.
  const signedIn = await isAuthenticated();
  return (
    <>
      <SiteHeader signedIn={signedIn} />
      <main className="flex flex-1 flex-col bg-muted">{children}</main>
      <SiteFooter />
    </>
  );
}
