import { cn } from "cn";
import type { Metadata } from "next";
import { geistMono, rubik } from "./fonts";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SITE_URL } from "@/lib/site";

// Next copies each page's title and description into the Open Graph and
// Twitter tags, and opengraph-image.tsx is the card image for every page.
export const metadata: Metadata = {
  metadataBase: SITE_URL,
  title: { default: "a8", template: "%s · a8" },
  description: "Open-source AI workspace that gets work done across your apps",
  openGraph: { siteName: "a8", type: "website" },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // next-themes sets the theme class on <html> before React hydrates.
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("h-full", "antialiased", rubik.variable, geistMono.variable, "font-sans")}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
