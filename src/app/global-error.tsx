"use client";

import { cn } from "cn";
import { CircleAlertIcon } from "lucide-react";
import { geistMono, rubik } from "./fonts";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

/**
 * Replaces the root layout when it throws, so it brings its own document,
 * styles, fonts and theme. It leaves out the layout's TooltipProvider and
 * Toaster, which nothing here needs.
 */
export default function GlobalError({ retry }: { retry: () => void }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("h-full", "antialiased", rubik.variable, geistMono.variable, "font-sans")}
    >
      <body className="min-h-full flex flex-col">
        <title>Something went wrong · a8</title>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <Empty className="min-h-svh">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CircleAlertIcon />
              </EmptyMedia>
              <EmptyTitle>Something went wrong</EmptyTitle>
              <EmptyDescription>
                a8 couldn&apos;t load. Please try again.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent className="flex-row justify-center">
              <Button onClick={retry}>Try again</Button>
              <Button variant="outline" asChild>
                {/* A full page load, so the root layout starts over. */}
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                <a href="/">Home</a>
              </Button>
            </EmptyContent>
          </Empty>
        </ThemeProvider>
      </body>
    </html>
  );
}
