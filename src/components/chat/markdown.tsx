"use client";

import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import "katex/dist/katex.min.css";
import { cn } from "cn";
import { ImageIcon } from "lucide-react";
import { useState, type ComponentProps } from "react";
import {
  defaultRehypePlugins,
  Streamdown,
  type Components,
  type ControlsConfig,
  type ExtraProps,
  type LinkSafetyConfig,
  type PluginConfig,
  type StreamdownProps,
  type StreamdownTranslations,
} from "streamdown";
import { Button } from "@/components/ui/button";

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

// Streamdown's harden step allows any URL and protocol by default. Ours keeps
// http(s), mailto and the other safe protocols, plus Streamdown's own
// placeholders for a link or image still streaming in. A blocked link or
// image shows its text. Remote images still get through here so
// RemoteImage knows their URL, but none loads until the reader clicks.
type RehypePlugins = NonNullable<StreamdownProps["rehypePlugins"]>;
const [hardenPlugin] = defaultRehypePlugins.harden as Extract<
  RehypePlugins[number],
  unknown[]
>;
const rehypePlugins: RehypePlugins = [
  defaultRehypePlugins.raw,
  defaultRehypePlugins.sanitize,
  [
    hardenPlugin,
    {
      allowedLinkPrefixes: ["*"],
      allowedImagePrefixes: ["*"],
      allowDataImages: false,
      allowedProtocols: ["streamdown:"],
      linkBlockPolicy: "text-only",
      imageBlockPolicy: "text-only",
    },
  ],
];

const components: Components = { img: RemoteImage };

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
      rehypePlugins={rehypePlugins}
      components={components}
      remend={streaming ? streamingRemendOptions : undefined}
      isAnimating={streaming}
      lineNumbers={false}
      className={cn(
        // Scaled to the chat's text-sm, which Streamdown's defaults aren't.
        "[&_[data-streamdown=heading-1]]:text-xl [&_[data-streamdown=heading-2]]:text-lg [&_[data-streamdown=heading-3]]:text-base",
        "*:first:mt-0 *:last:mb-0",
        "[&_[data-streamdown=link]]:text-link",
        // A long block equation scrolls instead of being cut off.
        "[&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden",
      )}
    >
      {streaming ? withoutUnfinishedTable(children) : children}
    </Streamdown>
  );
}

const INCOMPLETE_IMAGE = "streamdown:incomplete-image";

/**
 * An image in a reply, held back until the reader clicks. A prompt injection
 * can ask the model for an image whose URL carries chat or connector data,
 * and loading it would send that data to the URL's host. Until the click it
 * shows the alt text and the host. Spans only, since an image sits in a <p>.
 */
function RemoteImage({ src, alt }: ComponentProps<"img"> & ExtraProps) {
  const [loaded, setLoaded] = useState(false);
  if (typeof src !== "string" || !src) return null;
  if (src === INCOMPLETE_IMAGE) {
    return (
      <span className="my-2 inline-block h-24 w-48 animate-pulse rounded-lg bg-muted" />
    );
  }
  if (loaded) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- Any host, so no next/image.
      <img src={src} alt={alt} className="max-w-full rounded-lg" />
    );
  }
  return (
    <span className="my-2 inline-flex max-w-full items-center gap-2 rounded-lg border bg-card p-2 pl-3 text-sm align-middle">
      <ImageIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0">
        {alt ? <span className="block truncate">{alt}</span> : null}
        <span className="block truncate text-muted-foreground text-xs">
          {hostOf(src)}
        </span>
      </span>
      <Button
        type="button"
        variant="outline"
        size="xs"
        onClick={() => setLoaded(true)}
      >
        Load image
      </Button>
    </span>
  );
}

/** The host an image would load from, or the URL itself if it's relative. */
function hostOf(src: string): string {
  try {
    return new URL(src).host;
  } catch {
    return src;
  }
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
