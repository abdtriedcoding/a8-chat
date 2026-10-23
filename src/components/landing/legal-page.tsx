import type { ReactNode } from "react";

/** The layout of the Privacy Policy and Terms pages. */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <article className="px-4 py-16 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-3xl rounded-3xl border bg-card p-6 shadow-sm sm:p-12">
        <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl">
          {title}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">Last updated {updated}</p>
        <div className="mt-10 flex flex-col gap-4 leading-7 text-pretty [&_a]:underline [&_a]:underline-offset-4 [&_a:hover]:text-primary [&_h2]:mt-6 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_strong]:font-semibold [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-2 [&_ul]:pl-6">
          {children}
        </div>
      </div>
    </article>
  );
}
