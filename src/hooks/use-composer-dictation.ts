import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from "react";
import { toast } from "sonner";
import { useDictationShortcuts } from "@/components/keyboard-shortcuts";
import { useDictation } from "@/hooks/use-dictation";
import { useQueryWithLocalCopy } from "@/hooks/use-query-with-local-copy";
import { api } from "../../convex/_generated/api";

/**
 * The message box's text around a dictation: what was before and after the
 * caret when it started, and the words dictated so far. The unconfirmed
 * words sit after the confirmed ones and change with each update.
 */
type Draft = {
  before: string;
  after: string;
  confirmed: string;
  unconfirmed: string;
};

/**
 * Dictation into the message box (useDictation). The words go where the
 * caret was when dictation started, replacing any selected text, and the
 * text around them stays. It's all plain text in the box.
 *
 * Call stopForTyping from the box's onChange, since typing stops dictation.
 * The words shown so far stay. A Send while dictating awaits finish() for
 * the last words. While the box is mounted, Ctrl/Cmd+Shift+Space starts and
 * stops dictation, and Esc anywhere on the page stops it.
 *
 * `available` is false when the deployment has no Deepgram key or the
 * browser can't record, and the box shows no mic then. Call prewarm when
 * the user may be about to dictate, such as when the box gets focus, so the
 * mic doesn't wait to connect. Pass `likely` when the pointer or focus
 * reaches the mic.
 */
export function useComposerDictation({
  text,
  setText,
  getTextarea,
}: {
  text: string;
  setText: Dispatch<SetStateAction<string>>;
  getTextarea: () => HTMLTextAreaElement | null;
}) {
  const configured =
    useQueryWithLocalCopy(api.dictation.available, {}).data === true;
  const canRecord = useSyncExternalStore(
    subscribeToNothing,
    browserCanRecord,
    () => false,
  );
  const draftRef = useRef<Draft | null>(null);
  // Where the caret goes once the box shows the last update.
  const caretRef = useRef<number | null>(null);
  const finishingRef = useRef(false);
  // The box's text as of the last render or the last dictated words, for
  // code that runs after an await.
  const latestTextRef = useRef(text);

  function show(draft: Draft) {
    const { text: nextText, caret } = composeDraft(draft);
    caretRef.current = caret;
    latestTextRef.current = nextText;
    setText(nextText);
  }

  const dictation = useDictation({
    // A tap while the last dictation's words were still coming starts after
    // they're in, so this reads the text and caret they left, rendered or not.
    onStart: () => {
      const current = latestTextRef.current;
      const textarea = getTextarea();
      const selectionStart =
        caretRef.current ?? textarea?.selectionStart ?? current.length;
      const selectionEnd =
        caretRef.current ?? textarea?.selectionEnd ?? current.length;
      draftRef.current = {
        before: current.slice(0, selectionStart),
        after: current.slice(selectionEnd),
        confirmed: "",
        unconfirmed: "",
      };
    },
    onInterim: (words) => {
      const draft = draftRef.current;
      if (!draft) return;
      draft.unconfirmed = words;
      show(draft);
    },
    onFinal: (words) => {
      const draft = draftRef.current;
      if (!draft) return;
      draft.confirmed = joinWords(draft.confirmed, words);
      show(draft);
    },
    onError: (message) => toast.error(message),
  });
  const recording =
    dictation.state === "connecting" || dictation.state === "listening";
  // Typing or a Send while stopping still has to deal with the last words.
  const active = recording || dictation.state === "stopping";

  // Setting the box's value moves its caret to the end, so put it back after
  // the dictated words.
  useLayoutEffect(() => {
    latestTextRef.current = text;
    const caret = caretRef.current;
    if (caret === null) return;
    caretRef.current = null;
    getTextarea()?.setSelectionRange(caret, caret);
  }, [text, getTextarea]);

  function toggle() {
    if (recording) void dictation.stop();
    else dictation.start();
  }

  const available = configured && canRecord;
  useDictationShortcuts(
    available
      ? { toggle, stop: recording ? () => void dictation.stop() : undefined }
      : {},
  );

  // Warms a socket for a box that already has focus: when dictation turns
  // out to be set up after the box got focus, as on the new-chat page, and
  // when a dictation ends, so the next one in a row starts warm too.
  const prewarmIfFocused = useEffectEvent(() => {
    if (getTextarea() === document.activeElement) dictation.prewarm();
  });
  useEffect(() => {
    if (available && !active) prewarmIfFocused();
  }, [available, active]);

  return {
    available,
    active,
    state: dictation.state,
    level: dictation.level,
    toggle,
    prewarm: (options?: { likely?: boolean }) => {
      if (available) dictation.prewarm(options);
    },
    stop: dictation.stop,
    stopForTyping: () => {
      if (!active) return;
      dictation.cancel();
      draftRef.current = null;
    },
    /**
     * Stops dictating for a Send, and resolves with the box's text once the
     * last words are in. Resolves with null when another Send is already
     * waiting, so the prompt goes once.
     */
    finish: async (): Promise<string | null> => {
      if (finishingRef.current) return null;
      finishingRef.current = true;
      const draft = draftRef.current;
      try {
        await dictation.stop();
      } finally {
        finishingRef.current = false;
      }
      // Typing while it waited dropped the draft, and a tap while it waited
      // started a new one. Either way the box has the text.
      if (!draft || draftRef.current !== draft) return latestTextRef.current;
      draftRef.current = null;
      return composeDraft(draft).text;
    },
  };
}

/**
 * The box's text for a draft, and the caret position after the dictated
 * words. A space separates the words from the text on either side.
 */
function composeDraft({ before, after, confirmed, unconfirmed }: Draft) {
  const words = joinWords(confirmed, unconfirmed);
  if (words === "") return { text: before + after, caret: before.length };
  const head = before === "" || /\s$/.test(before) ? before : `${before} `;
  const tail = after === "" || /^\s/.test(after) ? after : ` ${after}`;
  return { text: head + words + tail, caret: head.length + words.length };
}

function joinWords(first: string, second: string) {
  if (first === "") return second;
  if (second === "") return first;
  return `${first} ${second}`;
}

function subscribeToNothing() {
  return () => {};
}

function browserCanRecord() {
  return (
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof AudioWorkletNode === "function"
  );
}
