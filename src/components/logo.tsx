import { cn } from "cn";
import { AppIcon } from "@/components/icons/app-icon";

export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-xl font-bold tracking-tight",
        className,
      )}
    >
      <AppIcon className="size-[1.4em]" />
      a8
    </span>
  );
}
