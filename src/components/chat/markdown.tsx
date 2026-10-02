"use client";

import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import "katex/dist/katex.min.css";
import { cn } from "cn";
import {
  Streamdown,
  type ControlsConfig,
  type LinkSafetyConfig,
  type PluginConfig,
  type StreamdownProps,
  type StreamdownTranslations,
} from "streamdown";

// Module constants, since Streamdown re-renders when these change identity.
// Shiki uses github-light and github-dark. No Mermaid plugin, so Mermaid
// blocks render as plain code. Math takes $$ only, so a single $ stays a
// dollar sign; the reply instructions say so (convex/lib/instructions.ts).
const plugins: PluginConfig = { code, math };

const controls: ControlsConfig = {
  code: { copy: true, download: false },
  table: false,
};

const translations: Partial<StreamdownTranslations> = {
  copyCode: "Copy code",
};

// Real links that open in a new tab, rather than buttons behind a confirm
// dialog, so they can be middle-clicked, copied and hovered for their URL.
const linkSafety: LinkSafetyConfig = { enabled: false };

// Remend closes unfinished markdown. Ours runs before its KaTeX handler (70).
const streamingRemendOptions: StreamdownProps["remend"] = {
  handlers: [
    { name: "tableCellMath", priority: 65, handle: closeTableCellMath },
  ],
};

/**
 * A reply's markdown: GFM, highlighted code with a copy button, and KaTeX
 * math. While it streams, unfinished markdown renders as if closed and an
 * unfinished table waits, so raw symbols never flash. Code follows the
 * `.dark` class on <html>.
 */
export function Markdown({
  children,
  streaming = false,
}: {
  children: string;
  /** The text is still arriving. Code copy waits until it's done. */
  streaming?: boolean;
}) {
  return (
    <Streamdown
      plugins={plugins}
      controls={controls}
      translations={translations}
      linkSafety={linkSafety}
      remend={streaming ? streamingRemendOptions : undefined}
      isAnimating={streaming}
      lineNumbers={false}
      className={cn(
        // Scaled to the chat's text-sm, which Streamdown's defaults aren't.
        "[&_[data-streamdown=heading-1]]:text-xl [&_[data-streamdown=heading-2]]:text-lg [&_[data-streamdown=heading-3]]:text-base",
        "*:first:mt-0 *:last:mb-0",
        // A long block equation scrolls instead of being cut off.
        "[&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden",
      )}
    >
      {streaming ? withoutUnfinishedTable(children) : children}
    </Streamdown>
  );
}

// Up to 3 spaces in; 4 or more makes an indented code line instead.
const TABLE_ROW = /^ {0,3}\|/;
const CODE_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const DELIMITER_CELL = /^\s*:?-+:?\s*$/;

/**
 * Drops a table at the end of the text until the row of dashes under its
 * header is in. Before that it's no table yet, so its rows would show as
 * raw pipes.
 */
function withoutUnfinishedTable(text: string): string {
  const lines = text.split("\n");
  // A row that has just ended leaves an empty last line.
  const end = lines.at(-1) === "" ? lines.length - 1 : lines.length;
  const rows = tableRowsAtEnd(lines.slice(0, end));
  if (rows === 0) return text;

  const start = end - rows;
  const [header, delimiter] = lines.slice(start, end);
  const delimiterCells = delimiter === undefined ? [] : cells(delimiter);
  const isTable =
    delimiterCells.length === cells(header).length &&
    delimiterCells.every((cell) => DELIMITER_CELL.test(cell));
  return isTable ? text : lines.slice(0, start).join("\n");
}

/**
 * Closes inline math left open in a table row at the end of the text.
 * Remend's own handler can close it on a new line instead, which ends the
 * row and leaves the math as raw text.
 */
function closeTableCellMath(text: string): string {
  const lines = text.split("\n");
  if (tableRowsAtEnd(lines) === 0) return text;
  const delimiters = (lines.at(-1) ?? "").split("$$").length - 1;
  if (delimiters % 2 === 0) return text;
  // Math that hasn't started yet waits, and half a closing $$ gets the rest.
  if (text.endsWith("$$")) return text.slice(0, -2);
  return text.endsWith("$") ? `${text}$` : `${text}$$`;
}

/** How many of the last lines are table rows. None inside a code fence. */
function tableRowsAtEnd(lines: string[]): number {
  let start = lines.length;
  while (start > 0 && TABLE_ROW.test(lines[start - 1])) start--;
  if (start === lines.length || inCodeFence(lines.slice(0, start))) return 0;
  return lines.length - start;
}

/** Whether these lines leave a code fence open. */
function inCodeFence(lines: string[]): boolean {
  let open: string | undefined;
  for (const line of lines) {
    const match = CODE_FENCE.exec(line);
    if (!match) continue;
    const [, fence, rest] = match;
    // Only a bare run of the same character, at least as long, closes a
    // fence. A language tag after it makes the line code.
    if (open === undefined) open = fence;
    else if (
      fence[0] === open[0] &&
      fence.length >= open.length &&
      rest.trim() === ""
    ) {
      open = undefined;
    }
  }
  return open !== undefined;
}

/** A table row's cells, without the pipes at either end. \| isn't one. */
function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/);
}
