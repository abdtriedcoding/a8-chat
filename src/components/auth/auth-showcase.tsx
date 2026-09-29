import { ApprovalCard, UserMessage } from "@/components/landing/chat-demo";
import { Highlight, Mention } from "@/components/landing/highlight";

/** The right half of the sign-in and sign-up pages, on large screens. */
export function AuthShowcase() {
  return (
    <aside className="hidden flex-col justify-center border-l bg-muted bg-dots px-12 py-16 lg:flex xl:px-20">
      <div className="mx-auto flex w-full max-w-lg flex-col">
        <p className="text-3xl font-bold tracking-tight text-balance">
          Nothing gets sent until <Highlight>you say so.</Highlight>
        </p>
        <p className="mt-4 text-lg text-pretty text-muted-foreground">
          a8 reads and drafts across your apps. Anything that sends, changes
          or deletes waits for your tap.
        </p>
        {/* A static picture, like the one on the landing page. */}
        <div aria-hidden="true" inert className="mt-10 flex flex-col gap-4 text-sm">
          <UserMessage>
            <Mention>@gmail</Mention> send the client a quick launch update
          </UserMessage>
          <ApprovalCard />
        </div>
      </div>
    </aside>
  );
}
