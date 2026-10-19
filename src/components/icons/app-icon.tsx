import { cn } from "cn";
import { LogoMark } from "@/components/icons/logo-mark";

/**
 * a8's app icon: the mark in white on a tile with the sky photo's blues.
 * src/app/icon.svg is the same icon for the favicon, so change both
 * together. Size it with a size-* class.
 */
export function AppIcon({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-[23%] bg-linear-to-b from-[#0079e2] to-[#5cb8f5] text-white",
        className,
      )}
    >
      <LogoMark className="size-[68%]" />
    </span>
  );
}
