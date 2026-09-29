import type { Metadata } from "next";
import { Geist_Mono, Rubik } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { getToken } from "@/lib/auth-server";
import { cn } from "@/lib/utils";
import { ConvexClientProvider } from "./ConvexClientProvider";

const rubik = Rubik({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "a8", template: "%s · a8" },
  description: "Open-source AI workspace that gets work done across your apps",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Hands the session's Convex JWT to the client so the first render is
  // already authenticated. This makes every route dynamic, which is fine here.
  const token = await getToken();
  return (
    <html
      lang="en"
      className={cn("h-full", "antialiased", rubik.variable, geistMono.variable, "font-sans")}
    >
      <body className="min-h-full flex flex-col">
        <ConvexClientProvider initialToken={token}>
          {children}
        </ConvexClientProvider>
        <Toaster />
      </body>
    </html>
  );
}
