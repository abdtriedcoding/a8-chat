import { LogoMark } from "@/components/icons/logo-mark";
import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-xl font-bold tracking-tight",
        className,
      )}
    >
      <LogoMark className="size-7 text-primary" />
      a8
    </span>
  );
}
