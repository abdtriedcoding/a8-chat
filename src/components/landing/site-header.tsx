import Link from "next/link";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { APP_HOME } from "@/lib/safe-redirect";
import { GITHUB_URL } from "@/lib/site";
import { GitHubIcon } from "./github-icon";

export function SiteHeader({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b bg-card/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link
          href="/"
          aria-label="a8 home"
          className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Logo />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
          <Button asChild variant="ghost" size="lg" className="hidden sm:inline-flex">
            <Link href="/#pricing">Pricing</Link>
          </Button>
          <Button asChild variant="ghost" size="lg" className="hidden sm:inline-flex">
            <a href={GITHUB_URL}>
              <GitHubIcon data-icon="inline-start" />
              GitHub
            </a>
          </Button>
          {signedIn ? (
            <Button asChild size="lg">
              <Link href={APP_HOME}>Open a8</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="lg">
                <Link href="/sign-in">Sign in</Link>
              </Button>
              <Button asChild size="lg">
                <Link href="/sign-up">Get started</Link>
              </Button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
