import { Skeleton } from "@/components/ui/skeleton";

/** A prompt and a reply in outline, while a chat's messages load. */
export function ConversationSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-6">
      <span role="status" className="sr-only">
        Loading chat…
      </span>
      <Skeleton aria-hidden="true" className="h-10 w-2/5 self-end rounded-xl" />
      <div aria-hidden="true" className="flex gap-2">
        <Skeleton className="size-8 shrink-0 rounded-full" />
        <div className="flex flex-1 flex-col gap-2 pt-1.5">
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    </div>
  );
}
