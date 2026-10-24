"use client";

import { useEffect, useRef, useState } from "react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { useErrorToast } from "@/hooks/use-error-toast";
import { checkPrompt } from "../../../convex/lib/prompt";
import { PromptLengthCount } from "./prompt-length";

/**
 * Edits a prompt's text, the last prompt's or a queued one's. Enter saves,
 * Shift+Enter adds a line, and Esc cancels. Saving the same text cancels
 * too, so an unchanged last prompt doesn't ask for a new reply. Near
 * MAX_PROMPT_LENGTH, a count says how many characters are left.
 */
export function PromptEditor({
  text,
  attachmentCount,
  onSave,
  onCancel,
}: {
  text: string;
  attachmentCount: number;
  onSave: (prompt: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(text);
  const [saving, setSaving] = useState(false);
  const showError = useErrorToast();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Opens with the cursor after the text.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, []);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      // The server runs the same check. Running it here first refuses a
      // blank edit without a failed call, which the Convex client would log
      // as a console error.
      const prompt = checkPrompt(draft, attachmentCount);
      if (prompt === text) onCancel();
      else await onSave(prompt);
    } catch (error) {
      showError(error);
    } finally {
      setSaving(false);
    }
  }

  return (
    // The padding makes room for the focus ring. The list item paints
    // nothing outside itself (content-visibility: auto).
    <form
      className="w-full p-1"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <InputGroup>
        <InputGroupTextarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            } else if (
              // Skip while an IME is composing: its Enter confirms a word.
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void save();
            }
          }}
          rows={1}
          aria-label="Edit message"
          className="max-h-52 min-h-11 px-3 pt-3"
        />
        <InputGroupAddon align="block-end" className="justify-end">
          <PromptLengthCount text={draft} />
          <InputGroupButton size="sm" onClick={onCancel}>
            Cancel
          </InputGroupButton>
          <InputGroupButton type="submit" variant="default" size="sm">
            {saving && <Spinner data-icon="inline-start" />}
            Save
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
