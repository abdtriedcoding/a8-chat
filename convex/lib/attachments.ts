import type { ModelMessage } from "ai";
import { appError, ERROR_CODES } from "./errors";
import { MODELS } from "./models";

/** The most attachments one prompt can carry. */
export const MAX_ATTACHMENTS_PER_PROMPT = 5;

export const BYTES_PER_MB = 1024 * 1024;

/** The largest file a8 takes, a PDF. */
export const MAX_ATTACHMENT_SIZE_IN_BYTES = 32 * BYTES_PER_MB;

/** The image size limit. Anthropic refuses images over 5 MB. */
const MAX_IMAGE_SIZE_IN_BYTES = 5 * BYTES_PER_MB;

export type AttachmentKind = "image" | "pdf";

/**
 * The file types a8 takes, by media type. The browser checks a file against
 * this before uploading it, and the server checks the upload again.
 */
const SUPPORTED_FILE_TYPES: Record<
  string,
  { kind: AttachmentKind; label: string; maxSizeInBytes: number }
> = {
  "image/png": { kind: "image", label: "PNG", maxSizeInBytes: MAX_IMAGE_SIZE_IN_BYTES },
  "image/jpeg": { kind: "image", label: "JPEG", maxSizeInBytes: MAX_IMAGE_SIZE_IN_BYTES },
  "image/gif": { kind: "image", label: "GIF", maxSizeInBytes: MAX_IMAGE_SIZE_IN_BYTES },
  "image/webp": { kind: "image", label: "WebP", maxSizeInBytes: MAX_IMAGE_SIZE_IN_BYTES },
  "application/pdf": { kind: "pdf", label: "PDF", maxSizeInBytes: MAX_ATTACHMENT_SIZE_IN_BYTES },
};

/**
 * The media types a model reads as attachments, out of the ones a8 takes.
 * `reads` is from the model's entry in the model list (lib/models.ts).
 */
export function getAcceptedMediaTypes(
  reads: readonly AttachmentKind[],
): string[] {
  return Object.entries(SUPPORTED_FILE_TYPES)
    .filter(([, fileType]) => reads.includes(fileType.kind))
    .map(([mediaType]) => mediaType);
}

/**
 * The media types a8 takes as uploads, which are the ones any listed model
 * reads. A
 * Send checks its files again against the reply's model
 * (loadPromptAttachments).
 */
export const UPLOAD_MEDIA_TYPES = getAcceptedMediaTypes([
  ...new Set(MODELS.flatMap((model) => model.reads)),
]);

/** Whether a8 takes a media type as an image or a PDF. Null for neither. */
export function getAttachmentKind(mediaType: string): AttachmentKind | null {
  return SUPPORTED_FILE_TYPES[mediaType]?.kind ?? null;
}

/**
 * Why a file can't be attached, or null if it can. `acceptedMediaTypes` is
 * the list from getAcceptedMediaTypes.
 */
export function getAttachmentRejectionReason(
  file: { name: string; type: string; size: number },
  acceptedMediaTypes: readonly string[],
): string | null {
  const fileType = SUPPORTED_FILE_TYPES[file.type];
  if (!fileType || !acceptedMediaTypes.includes(file.type)) {
    const acceptedLabels = acceptedMediaTypes.map(
      (mediaType) => SUPPORTED_FILE_TYPES[mediaType].label,
    );
    return acceptedLabels.length === 0
      ? "This model can't read attachments."
      : `${file.name} isn't a ${joinWithOr(acceptedLabels)} file.`;
  }
  if (file.size > fileType.maxSizeInBytes) {
    return describeOversize(file.name, fileType.maxSizeInBytes);
  }
  return null;
}

/**
 * Why a file is too big for every type a model accepts, or null if it fits
 * one of them. It needs no media type, so the server can check an upload's
 * size before reading its bytes.
 */
export function getOversizeReason(
  file: { name: string; size: number },
  acceptedMediaTypes: readonly string[],
): string | null {
  if (acceptedMediaTypes.length === 0) return null;
  const maxSizeInBytes = Math.max(
    ...acceptedMediaTypes.map(
      (mediaType) => SUPPORTED_FILE_TYPES[mediaType].maxSizeInBytes,
    ),
  );
  return file.size > maxSizeInBytes
    ? describeOversize(file.name, maxSizeInBytes)
    : null;
}

function describeOversize(filename: string, maxSizeInBytes: number) {
  return `${filename} is over the ${maxSizeInBytes / BYTES_PER_MB} MB limit.`;
}

/**
 * The messages with each image or PDF the model can't read replaced by a
 * text note that names it, so the model knows the file is there. A thread
 * can switch to a model that can't read a file from an earlier turn. This
 * changes what's sent to the model, not what's saved. `reads` is from the
 * model's entry in the model list.
 */
export function replaceUnreadableAttachments(
  messages: ModelMessage[],
  reads: readonly AttachmentKind[],
): ModelMessage[] {
  return messages.map((message) => {
    if (message.role !== "user" || typeof message.content === "string") {
      return message;
    }
    if (!message.content.some((part) => !canRead(part, reads))) {
      return message;
    }
    return {
      ...message,
      content: message.content.map((part) =>
        canRead(part, reads)
          ? part
          : { type: "text" as const, text: unreadableNote(part) },
      ),
    };
  });
}

type UserPart = Exclude<
  Extract<ModelMessage, { role: "user" }>["content"],
  string
>[number];

function canRead(part: UserPart, reads: readonly AttachmentKind[]) {
  const kind = partKind(part);
  return kind === null || reads.includes(kind);
}

/** The attachment kind of an image or file part, or null for any other. */
function partKind(part: UserPart): AttachmentKind | null {
  if (part.type === "image") return "image";
  if (part.type === "file") return getAttachmentKind(part.mediaType);
  return null;
}

/** "[A PDF the current model can't read: report.pdf]" */
function unreadableNote(part: UserPart): string {
  const filename = part.type === "file" ? part.filename : undefined;
  const what = partKind(part) === "pdf" ? "A PDF" : "An image";
  return `[${what} the current model can't read${filename ? `: ${filename}` : ""}]`;
}

/** How many bytes from the start of a file detectMediaType needs. */
const FILE_SIGNATURE_LENGTH = 12;

/**
 * The media type a file's first bytes show (detectMediaType), or "" if they
 * match no type a8 takes. getAttachmentRejectionReason refuses "".
 */
export async function readMediaType(file: Blob): Promise<string> {
  const firstBytes = await file.slice(0, FILE_SIGNATURE_LENGTH).arrayBuffer();
  return detectMediaType(new Uint8Array(firstBytes)) ?? "";
}

/**
 * The media type a file's first bytes show, or null if they don't match a
 * type a8 takes. The browser sets an upload's Content-Type from the file
 * name, so only the bytes can be trusted.
 */
export function detectMediaType(firstBytes: Uint8Array): string | null {
  const hasBytesAt = (offset: number, signature: number[]) =>
    signature.every((byte, i) => firstBytes[offset + i] === byte);

  if (hasBytesAt(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (hasBytesAt(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  // "GIF8"
  if (hasBytesAt(0, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  // "RIFF", then the chunk size, then "WEBP"
  if (
    hasBytesAt(0, [0x52, 0x49, 0x46, 0x46]) &&
    hasBytesAt(8, [0x57, 0x45, 0x42, 0x50])
  ) {
    return "image/webp";
  }
  // "%PDF-"
  if (hasBytesAt(0, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  return null;
}

/** Throws unless `attachmentCount` attachments fit on one prompt. */
export function checkAttachmentCount(attachmentCount: number) {
  if (attachmentCount > MAX_ATTACHMENTS_PER_PROMPT) {
    throw appError(
      ERROR_CODES.TOO_MANY_ATTACHMENTS,
      `You can attach at most ${MAX_ATTACHMENTS_PER_PROMPT} files.`,
    );
  }
}

const MAX_FILENAME_LENGTH = 255;

/** The name a file gets when it has none. */
export const UNNAMED_FILE = "attachment";

/**
 * A file name from the browser, with whitespace collapsed and cut to 255
 * characters. UNNAMED_FILE when nothing is left.
 */
export function cleanFilename(filename: string): string {
  const collapsedFilename = filename.replace(/\s+/g, " ").trim();
  // Count code points, so the cut never splits an emoji.
  const cutFilename = Array.from(collapsedFilename)
    .slice(0, MAX_FILENAME_LENGTH)
    .join("");
  return cutFilename || UNNAMED_FILE;
}

/** "a", "a or b", "a, b or c". */
function joinWithOr(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} or ${words.at(-1)}`;
}
