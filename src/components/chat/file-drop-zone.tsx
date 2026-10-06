"use client";

import { FileUpIcon } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Takes files dropped anywhere on the page, and covers the page with a drop
 * zone while files are dragged over it. Other drags, such as selected text,
 * are left alone.
 *
 * It listens on the whole window, so a file dropped a little off target
 * still attaches. Otherwise the browser would open the file in place of the
 * app.
 *
 * While `disabled`, it shows no drop zone and takes no files, but still
 * stops the browser from opening a dropped file. Disable it while the
 * accepted file types load, and when the model accepts none.
 */
export function FileDropZone({
  onDrop,
  disabled,
}: {
  onDrop: (files: File[]) => void;
  disabled: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const dropFiles = useEffectEvent(onDrop);
  const isDisabled = useEffectEvent(() => disabled);

  useEffect(() => {
    // dragenter and dragleave fire for each element the drag crosses, so
    // the drag is over the page while more have entered than left.
    let enteredCount = 0;

    function handleDragEnter(event: DragEvent) {
      if (!carriesFiles(event)) return;
      enteredCount += 1;
      setDragging(true);
    }
    function handleDragLeave(event: DragEvent) {
      if (!carriesFiles(event)) return;
      enteredCount = Math.max(0, enteredCount - 1);
      if (enteredCount === 0) setDragging(false);
    }
    function handleDragOver(event: DragEvent) {
      if (!carriesFiles(event)) return;
      // The browser only fires drop if dragover's default is prevented, and
      // opens the file itself if it isn't. "none" shows a not-allowed cursor
      // and ends the drag without a drop.
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = isDisabled() ? "none" : "copy";
      }
    }
    function handleDrop(event: DragEvent) {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      enteredCount = 0;
      setDragging(false);
      if (isDisabled()) return;
      dropFiles(Array.from(event.dataTransfer?.files ?? []));
    }

    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("drop", handleDrop);
    return () => {
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("drop", handleDrop);
    };
  }, []);

  if (!dragging || disabled) return null;
  // Rendered into the body, so no parent's overflow or stacking cuts it off.
  // It ignores the pointer, so the drag events keep coming from the page.
  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-50 bg-background/80 p-3 backdrop-blur-sm">
      <div className="flex size-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-primary/50 text-center">
        <FileUpIcon className="size-8 text-primary" />
        <p className="font-medium">Drop files to attach them</p>
      </div>
    </div>,
    document.body,
  );
}

/** Whether a drag carries files, rather than text or a link. */
function carriesFiles(event: DragEvent) {
  return event.dataTransfer?.types.includes("Files") ?? false;
}
