import { ConvexError } from "convex/values";

/** The most attachments one prompt can carry. */
export const MAX_ATTACHMENTS_PER_PROMPT = 5;

const BYTES_PER_MB = 1024 * 1024;

export type AttachmentKind = "image" | "pdf";

/**
 * The file types a8 takes, by media type. The browser checks a file against
 * this before uploading it, and the server checks the upload again.
 */
const SUPPORTED_FILE_TYPES: Record<
  string,
  { kind: AttachmentKind; label: string; maxSizeInBytes: number }
> = {
  "image/png": { kind: "image", label: "PNG", maxSizeInBytes: 10 * BYTES_PER_MB },
  "image/jpeg": { kind: "image", label: "JPEG", maxSizeInBytes: 10 * BYTES_PER_MB },
  "image/gif": { kind: "image", label: "GIF", maxSizeInBytes: 10 * BYTES_PER_MB },
  "image/webp": { kind: "image", label: "WebP", maxSizeInBytes: 10 * BYTES_PER_MB },
  "application/pdf": { kind: "pdf", label: "PDF", maxSizeInBytes: 32 * BYTES_PER_MB },
};

/**
 * What each model accepts, by provider. Anthropic models read images and
 * PDFs, and every other model reads nothing. Stage 9's models table
 * replaces this list.
 */
const ATTACHMENT_KINDS_BY_PROVIDER: Record<string, AttachmentKind[]> = {
  anthropic: ["image", "pdf"],
};

/**
 * The media types a model accepts as attachments, out of the ones a8 takes.
 * `providerId` is the AI SDK's provider id, such as "anthropic.messages".
 */
export function getAcceptedMediaTypes(providerId: string): string[] {
  const providerName = providerId.split(".")[0];
  const acceptedKinds = ATTACHMENT_KINDS_BY_PROVIDER[providerName] ?? [];
  return Object.entries(SUPPORTED_FILE_TYPES)
    .filter(([, fileType]) => acceptedKinds.includes(fileType.kind))
    .map(([mediaType]) => mediaType);
}

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
    const maxSizeInMb = fileType.maxSizeInBytes / BYTES_PER_MB;
    return `${file.name} is over the ${maxSizeInMb} MB limit.`;
  }
  return null;
}

/** How many bytes from the start of a file detectMediaType needs. */
export const FILE_SIGNATURE_LENGTH = 12;

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
    throw new ConvexError({
      code: "TOO_MANY_ATTACHMENTS",
      message: `You can attach at most ${MAX_ATTACHMENTS_PER_PROMPT} files.`,
    });
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
