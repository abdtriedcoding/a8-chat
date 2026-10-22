"use client";

import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { CopyIcon, Share2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { useIsMobile } from "@/hooks/use-mobile";
import { errorMessage } from "@/lib/errors";
import { threadTitle } from "@/lib/thread-title";
import { api } from "../../convex/_generated/api";

const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * The chat header's Share button, with its dialog. It shows once the thread
 * has a finished turn, or a link.
 */
export function ShareButton({
  threadId,
  title,
}: {
  threadId: string;
  title?: string;
}) {
  const status = useQuery(api.sharedSnapshots.getShareStatus, { threadId });
  const [open, setOpen] = useState(false);
  if (!status?.hasFinishedTurns && !status?.link) return null;
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Share2Icon data-icon="inline-start" />
        Share
      </Button>
      <ShareDialog
        threadId={threadId}
        title={title}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

/**
 * The share dialog for a thread: creates its shared link, copies it,
 * updates it to the thread's latest finished turns, and unshares it.
 */
export function ShareDialog({
  threadId,
  title,
  open,
  onOpenChange,
}: {
  threadId: string;
  title?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share chat</DialogTitle>
          <DialogDescription>
            Anyone with the link can see this chat up to now. Messages you
            send later stay private until you update the link.
          </DialogDescription>
        </DialogHeader>
        {open && <ShareDialogBody threadId={threadId} title={title} />}
      </DialogContent>
    </Dialog>
  );
}

function ShareDialogBody({
  threadId,
  title,
}: {
  threadId: string;
  title?: string;
}) {
  const status = useQuery(api.sharedSnapshots.getShareStatus, { threadId });
  const share = useMutation(api.sharedSnapshots.share);
  const unshare = useMutation(api.sharedSnapshots.unshare);
  const [pending, setPending] = useState<"share" | "unshare">();

  async function run(action: "share" | "unshare") {
    if (pending) return;
    setPending(action);
    try {
      await (action === "share" ? share : unshare)({ threadId });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(undefined);
    }
  }

  if (status === undefined) {
    return <Spinner className="mx-auto" />;
  }
  if (status === null) {
    return <p className="text-muted-foreground">Chat not found.</p>;
  }

  const { link } = status;
  // The first copy is still running, so the link doesn't open yet.
  if (link?.copying && link.updatedAt === undefined) {
    return (
      <p role="status" className="flex items-center gap-2 text-muted-foreground">
        <Spinner />
        Creating link…
      </p>
    );
  }

  if (!link) {
    return (
      <DialogFooter className="items-center">
        {!status.hasFinishedTurns && (
          <p className="mr-auto text-muted-foreground">
            Nothing to share yet.
          </p>
        )}
        <Button
          disabled={!status.hasFinishedTurns || pending !== undefined}
          onClick={() => void run("share")}
        >
          {pending === "share" && <Spinner data-icon="inline-start" />}
          Create link
        </Button>
      </DialogFooter>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <SharedLinkField
          url={`${window.location.origin}/s/${link.publicId}`}
          title={threadTitle({ title })}
        />
        <p className="text-xs text-muted-foreground">
          {link.copying ? (
            <span role="status" className="flex items-center gap-1.5">
              <Spinner className="size-3" />
              Updating link…
            </span>
          ) : (
            link.updatedAt !== undefined &&
            `Last updated ${dateFormat.format(link.updatedAt)}`
          )}
        </p>
      </div>
      <DialogFooter>
        <Button
          variant="ghost"
          className="text-destructive hover:text-destructive"
          disabled={pending !== undefined}
          onClick={() => void run("unshare")}
        >
          {pending === "unshare" && <Spinner data-icon="inline-start" />}
          Unshare
        </Button>
        {link.hasNewerTurns && !link.copying && (
          <Button
            disabled={pending !== undefined}
            onClick={() => void run("share")}
          >
            {pending === "share" && <Spinner data-icon="inline-start" />}
            Update link
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

/**
 * The link in a read-only field, with Copy. On a phone with a share sheet,
 * the button opens the share sheet instead.
 */
function SharedLinkField({ url, title }: { url: string; title: string }) {
  const isMobile = useIsMobile();
  const canShare = isMobile && typeof navigator.share === "function";

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Copied the link.");
    } catch {
      toast.error("Couldn't copy the link.");
    }
  }

  async function openShareSheet() {
    try {
      await navigator.share({ title, url });
    } catch (error) {
      // The user closed the share sheet.
      if (error instanceof DOMException && error.name === "AbortError") return;
      await copy();
    }
  }

  return (
    <InputGroup>
      <InputGroupInput
        readOnly
        value={url}
        aria-label="Shared link"
        onFocus={(event) => event.currentTarget.select()}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          onClick={() => void (canShare ? openShareSheet() : copy())}
        >
          {canShare ? <Share2Icon /> : <CopyIcon />}
          {canShare ? "Share" : "Copy"}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
