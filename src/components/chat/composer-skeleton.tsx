import { InputGroup, InputGroupAddon } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The Composer in outline, the same height as an empty one. It takes no
 * input, so nothing typed is lost when the Composer replaces it.
 */
export function ComposerSkeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={className}>
      <InputGroup>
        <div className="min-h-11 w-full px-3 pt-3 pb-2 text-base text-muted-foreground md:text-sm">
          Ask a8 anything…
        </div>
        <InputGroupAddon align="block-end">
          <Skeleton className="size-8" />
          {/* The model picker, taller than the icon buttons. */}
          <Skeleton className="h-9 w-28" />
          <Skeleton className="ml-auto size-8" />
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}
