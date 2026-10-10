import { getSessionCookie } from "better-auth/cookies";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";

export default async function MarketingLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Cookie presence only. It sets the header buttons, not access, so a stale
  // cookie costs nothing and the page skips the Convex token call.
  const signedIn = getSessionCookie(await headers()) !== null;
  return (
    <>
      <SiteHeader signedIn={signedIn} />
      <main className="flex flex-1 flex-col bg-muted">{children}</main>
      <SiteFooter />
    </>
  );
}
