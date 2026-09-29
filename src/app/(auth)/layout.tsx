import Link from "next/link";
import type { ReactNode } from "react";
import { AuthShowcase } from "@/components/auth/auth-showcase";
import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="grid flex-1 lg:grid-cols-2">
      <div className="flex flex-col justify-center px-6 py-12 sm:px-10">
        <div className="mx-auto flex w-full max-w-md flex-col gap-10">
          <Link
            href="/"
            aria-label="a8 home"
            className="self-start rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Logo />
          </Link>
          {children}
        </div>
      </div>
      <AuthShowcase />
    </main>
  );
}
