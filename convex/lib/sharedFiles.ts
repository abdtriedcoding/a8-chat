// Where a shared page loads its attachments (sharedSnapshots.serveSharedFile).
// The browser imports this, so it imports only types.
import type { SharedPart } from "./sharedMessages";

/** The path, on the deployment's site URL, that serves shared files. */
export const SHARED_FILES_PATH = "/shared-files/";

/** Where the shared page at `publicId` loads the file. */
export function sharedFilePath(publicId: string, fileId: string): string {
  return `${SHARED_FILES_PATH}${publicId}/${fileId}`;
}

export type SharedFilePart = Extract<SharedPart, { mediaType: string }>;

/**
 * Whether the part is an attachment. A tool part's `type` is any string, so
 * `type` alone can't tell.
 */
export function isSharedFilePart(part: SharedPart): part is SharedFilePart {
  return part.type === "file" && "mediaType" in part;
}
