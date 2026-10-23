import { Geist_Mono, Rubik } from "next/font/google";

// Shared by the root layout and global-error, which renders its own document.
export const rubik = Rubik({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});
