import { useQuery } from "convex/react";
import {
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from "react";
import { toast } from "sonner";
import { useDictationShortcut } from "@/components/keyboard-shortcuts";
import { useDictation } from "@/hooks/use-dictation";
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
 * the last words. Ctrl/Cmd+Shift+Space starts and stops dictation while the
 * box is mounted.
 *
 * `available` is false when the deployment has no Deepgram key or the
 * browser can't record, and the box shows no mic then.
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
  const configured = useQuery(api.dictation.available) === true;
  const canRecord = useSyncExternalStore(
    subscribeToNothing,
    browserCanRecord,
    () => false,
  );
  const draftRef = useRef<Draft | null>(null);
  // Where the caret goes once the box shows the last update.
  const caretRef = useRef<number | null>(null);
  const finishingRef = useRef(false);
  // The box's text as of the last render, for finish() to read after its
  // await.
  const latestTextRef = useRef(text);

  function show(draft: Draft) {
    const { text: nextText, caret } = composeDraft(draft);
    caretRef.current = caret;
    setText(nextText);
  }

  const dictation = useDictation({
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
  const active =
    dictation.state === "connecting" || dictation.state === "listening";

  // Setting the box's value moves its caret to the end, so put it back after
  // the dictated words.
  useLayoutEffect(() => {
    latestTextRef.current = text;
    const caret = caretRef.current;
    if (caret === null) return;
    caretRef.current = null;
    getTextarea()?.setSelectionRange(caret, caret);
  }, [text, getTextarea]);

  function start() {
    const textarea = getTextarea();
    const selectionStart = textarea?.selectionStart ?? text.length;
    const selectionEnd = textarea?.selectionEnd ?? text.length;
    draftRef.current = {
      before: text.slice(0, selectionStart),
      after: text.slice(selectionEnd),
      confirmed: "",
      unconfirmed: "",
    };
    dictation.start();
  }

  function toggle() {
    if (active) void dictation.stop();
    else start();
  }

  const available = configured && canRecord;
  useDictationShortcut(available ? toggle : undefined);

  return {
    available,
    active,
    state: dictation.state,
    level: dictation.level,
    toggle,
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
      try {
        await dictation.stop();
      } finally {
        finishingRef.current = false;
      }
      const draft = draftRef.current;
      draftRef.current = null;
      // Typing while it waited dropped the draft, and the box has the text.
      return draft ? composeDraft(draft).text : latestTextRef.current;
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
