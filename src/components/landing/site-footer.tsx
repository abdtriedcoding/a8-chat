import Link from "next/link";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { GITHUB_URL } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="border-t bg-card">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-12 sm:flex-row sm:items-end sm:justify-between sm:px-6">
        <div className="flex flex-col gap-3">
          <Logo />
          <p className="text-muted-foreground">
            The open-source AI chat that does the work in your apps.
          </p>
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} a8
          </p>
        </div>
        <nav aria-label="Footer" className="-mx-2.5 flex flex-wrap items-center">
          <Button asChild variant="ghost">
            <Link href="/#pricing">Pricing</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/#faq">FAQ</Link>
          </Button>
          <Button asChild variant="ghost">
            <a href={GITHUB_URL}>GitHub</a>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/sign-in">Sign in</Link>
          </Button>
        </nav>
      </div>
    </footer>
  );
}
