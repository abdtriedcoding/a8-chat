import { useConvexAuth, useQuery } from "convex/react";
import {
  useRef,
  useState,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react";
import { flushSync } from "react-dom";
import { api } from "../../convex/_generated/api";
import type { ConnectorStatus } from "../../convex/connectors";
import { findMentions, MENTION_START } from "../../convex/lib/connectors";

/** The @ word the caret is in: where it starts and ends, and what follows @. */
type MentionQuery = { start: number; end: number; query: string };

/**
 * The composer's @ mentions. Typing @ opens a menu of every connector,
 * connected ones first, filtered by what follows the @. ↑ and ↓ move
 * through it, Enter or Tab picks, and Esc closes it. Picking a connector
 * puts its handle in the text.
 *
 * `blockedMentions` lists the mentioned connectors that aren't connected.
 * `canSend` is false while there are any, or while the user's connections
 * are still loading and the text mentions a connector. The composer doesn't
 * send until each is connected or its mention is removed.
 */
export function useComposerMentions({
  text,
  setText,
}: {
  text: string;
  setText: (text: string) => void;
}) {
  const { isLoading } = useConvexAuth();
  const connectors = useQuery(api.connectors.list, isLoading ? "skip" : {});
  const [mention, setMention] = useState<MentionQuery>();
  // The start of a mention Esc closed, so its menu stays closed while the
  // user keeps typing it.
  const [dismissedAt, setDismissedAt] = useState<number>();
  const [selectedId, setSelectedId] = useState("");
  // syncCaret keeps this pointing at the message box. The menu only opens
  // from syncCaret, so pick always has it.
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const options =
    mention && mention.start !== dismissedAt
      ? menuOptions(connectors ?? [], mention.query)
      : [];
  const selected =
    options.find((connector) => connector.id === selectedId) ?? options[0];

  const mentioned = findMentions(text);
  const blockedMentions = mentioned.flatMap((connector) => {
    const status = connectors?.find(({ id }) => id === connector.id);
    return status && status.status !== "connected" ? [status] : [];
  });
  const canSend =
    blockedMentions.length === 0 &&
    (connectors !== undefined || mentioned.length === 0);

  /**
   * Opens the menu when the caret is in an @ word, and closes it otherwise.
   * Leaving the word also forgets an Esc on it and the selected connector.
   */
  function syncCaret(textarea: HTMLTextAreaElement) {
    textareaRef.current = textarea;
    const { value, selectionStart, selectionEnd } = textarea;
    const next =
      selectionStart === selectionEnd
        ? mentionQueryAt(value, selectionStart)
        : undefined;
    setMention(next);
    if (!next) {
      setDismissedAt(undefined);
      setSelectedId("");
    }
  }

  function followCaret(event: SyntheticEvent<HTMLTextAreaElement>) {
    syncCaret(event.currentTarget);
  }

  function pick(connector: ConnectorStatus) {
    if (!mention) return;
    const before = text.slice(0, mention.start);
    const after = text.slice(mention.end);
    const handle = `@${connector.handle}`;
    // One space after the handle, so the user can type on.
    const spaced = /^\s/.test(after) ? handle : `${handle} `;
    const caret = before.length + handle.length + 1;
    // Renders the new text now, so the caret can go after the handle.
    // Putting new text in the box moves the caret to its end.
    flushSync(() => {
      setText(before + spaced + after);
      setMention(undefined);
      setSelectedId("");
    });
    textareaRef.current?.focus();
    textareaRef.current?.setSelectionRange(caret, caret);
  }

  /** Handles the menu's keys. Returns whether it used the key. */
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (!selected || event.nativeEvent.isComposing) return false;
    const index = options.indexOf(selected);
    switch (event.key) {
      case "ArrowDown":
        setSelectedId(options[(index + 1) % options.length].id);
        break;
      case "ArrowUp":
        setSelectedId(
          options[(index - 1 + options.length) % options.length].id,
        );
        break;
      case "Enter":
      case "Tab":
        if (event.shiftKey) return false;
        pick(selected);
        break;
      case "Escape":
        // The preventDefault below keeps Esc from also stopping the reply.
        setDismissedAt(mention?.start);
        break;
      default:
        return false;
    }
    event.preventDefault();
    return true;
  }

  return {
    /** The menu's connectors, or none while it's closed. */
    options,
    selectedId: selected?.id ?? "",
    setSelectedId,
    pick,
    blockedMentions,
    canSend,
    syncCaret,
    /**
     * For the message box, so the menu follows the caret. In testing,
     * React's onSelect alone missed caret moves made with the arrow keys.
     */
    caretHandlers: {
      onSelect: followCaret,
      onKeyUp: followCaret,
      onMouseUp: followCaret,
      onFocus: followCaret,
      onBlur: () => setMention(undefined),
    },
    onKeyDown,
  };
}

/**
 * The @ word the caret is in, if any. Its @ follows MENTION_START, as a
 * mention's does, and it runs through letters, digits, - and _.
 */
function mentionQueryAt(text: string, caret: number): MentionQuery | undefined {
  const typed = new RegExp(String.raw`${MENTION_START}@([\w-]*)$`).exec(
    text.slice(0, caret),
  );
  if (!typed) return undefined;
  const rest = /^[\w-]*/.exec(text.slice(caret))?.[0] ?? "";
  return {
    start: caret - typed[1].length - 1,
    end: caret + rest.length,
    query: typed[1],
  };
}

/**
 * The connectors whose handle or name contains the query, connected ones
 * first, each group in catalog order.
 */
function menuOptions(
  connectors: ConnectorStatus[],
  query: string,
): ConnectorStatus[] {
  const lowered = query.toLowerCase();
  const matches = connectors.filter(
    ({ handle, name }) =>
      handle.includes(lowered) || name.toLowerCase().includes(lowered),
  );
  return [
    ...matches.filter(({ status }) => status === "connected"),
    ...matches.filter(({ status }) => status !== "connected"),
  ];
}
