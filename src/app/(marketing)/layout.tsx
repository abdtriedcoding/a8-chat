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
  const signedIn = getSessionCookie(await headers()) !== null;
  return (
    <>
      <SiteHeader signedIn={signedIn} />
      <main className="flex flex-1 flex-col bg-muted">{children}</main>
      <SiteFooter />
    </>
  );
}
