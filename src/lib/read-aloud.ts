// Reads replies aloud with the browser's speech synthesis. The browser has
// one speech queue, so one reply reads at a time, and starting another
// stops the first.

/**
 * The longest piece queued as one utterance. Chrome's online voices stop
 * after about 15 seconds of one utterance, so a reply goes in pieces.
 */
const MAX_PIECE_LENGTH = 200;

/** The id of the reply being read, or null. */
let readingId: string | null = null;
/** Bumped per reading, so a stopped reading's late events change nothing. */
let reading = 0;
const listeners = new Set<() => void>();

function setReadingId(id: string | null) {
  readingId = id;
  for (const listener of listeners) listener();
}

export function subscribeToReading(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getReadingId() {
  return readingId;
}

export function canReadAloud() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Reads `markdown` aloud as the reply `id`, stopping any other reading. */
export function readAloud(id: string, markdown: string) {
  speechSynthesis.cancel();
  const thisReading = ++reading;
  const pieces = speakablePieces(markdown);
  if (pieces.length === 0) {
    setReadingId(null);
    return;
  }
  pieces.forEach((piece, index) => {
    const utterance = new SpeechSynthesisUtterance(piece);
    if (index === pieces.length - 1) {
      utterance.onend = () => {
        if (reading === thisReading) setReadingId(null);
      };
    }
    // cancel() fires this too, after the next reading may have started.
    utterance.onerror = () => {
      if (reading === thisReading) setReadingId(null);
    };
    speechSynthesis.speak(utterance);
  });
  setReadingId(id);
}

export function stopReading() {
  reading++;
  speechSynthesis.cancel();
  setReadingId(null);
}

/** The reply as plain sentences, without code blocks or markdown syntax. */
function speakablePieces(markdown: string) {
  const text = markdown
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^[ \t]*(#{1,6}|>|[-*+]|\d+[.)])[ \t]+/gm, "")
    .replace(/^[ \t]*\|?[ \t:|-]+\|?[ \t]*$/gm, "")
    .replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, "$1")
    .replace(/[ \t]*\|[ \t]*/g, ", ")
    .replace(/[*_~]{1,3}(\S[^*_~]*?)[*_~]{1,3}/g, "$1");

  const pieces: string[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    // A line without its own punctuation, like a list item or table row,
    // ends with a pause instead of running into the next line.
    const sentences = block
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .map((line) => (/[.!?:;,]$/.test(line) ? line : `${line}.`))
      .join(" ")
      .match(/[^.!?]+[.!?]*/g);
    let piece = "";
    for (const sentence of sentences ?? []) {
      if (piece && piece.length + sentence.length > MAX_PIECE_LENGTH) {
        pieces.push(piece.trim());
        piece = "";
      }
      piece += sentence;
    }
    if (piece.trim()) pieces.push(piece.trim());
  }
  return pieces;
}
