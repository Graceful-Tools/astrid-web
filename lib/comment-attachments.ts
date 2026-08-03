/**
 * The files staged on a comment before it is sent, and the comments they become.
 * (Task 9f325964 — the web twin of iOS `AttachmentQueue` + `CommentAttachmentBatch`.)
 *
 * Web previously held a single `attachedFile`, so picking a second file silently
 * discarded the first — invisible to the user, who had already watched the first
 * chip appear. iOS hit the same bug in three separate inputs; the fix there was to
 * put the "what happens when you pick a second file" decision in one place that
 * every input calls. Same reasoning here.
 *
 * `POST /api/tasks/[id]/comments` (and its v1 twin) accept a single `fileId` per
 * comment. Letting one comment carry many files would be a breaking cross-platform
 * API change, so multi-select fans out to one comment per file instead — what iOS
 * does, and what iMessage does with a multi-photo send.
 */

import type { FileAttachment } from "@/hooks/task-detail/useTaskDetailState"

/**
 * Ceiling on staged files. Matches iOS `CommentAttachmentBatch.maxSelection`, so a
 * thread looks the same whichever client posted it. A ceiling exists because each
 * pick becomes its own comment; twenty at a time is a wall of thumbnails, not a message.
 */
export const MAX_COMMENT_ATTACHMENTS = 10

export interface CommentDraft {
  content: string
  type: "TEXT" | "ATTACHMENT"
  fileId: string | undefined
}

/**
 * Pull the secure-file id out of an attachment url.
 *
 * Was `url.split('/').pop()` copy-pasted across three comment components, which
 * returns '' for a trailing slash and keeps any query string attached.
 */
export function fileIdFromUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined
  const id = url.split("?")[0].split("#")[0].split("/").pop()
  return id || undefined
}

export function isAttachmentQueueFull(queue: FileAttachment[]): boolean {
  return queue.length >= MAX_COMMENT_ATTACHMENTS
}

/**
 * Queue a file behind the ones already staged.
 *
 * At the cap this drops the NEW file rather than evicting an old one: the user can
 * see what is already staged and can remove one deliberately, whereas silently
 * discarding an earlier pick is exactly the failure this module exists to prevent.
 */
export function addAttachment(queue: FileAttachment[], file: FileAttachment): FileAttachment[] {
  if (isAttachmentQueueFull(queue)) return queue
  // A re-fired change event or a double click must not stage the same file twice.
  const id = fileIdFromUrl(file.url)
  if (queue.some(f => fileIdFromUrl(f.url) === id)) return queue
  return [...queue, file]
}

export function removeAttachment(queue: FileAttachment[], fileId: string): FileAttachment[] {
  return queue.filter(f => fileIdFromUrl(f.url) !== fileId)
}

/**
 * Split typed text and staged files into the comments to post, in pick order.
 *
 * The caption rides the first comment and is not repeated — four photos with the
 * caption echoed four times reads as a stutter in the thread. Every comment that
 * has no caption of its own falls back to `Attached: <filename>`, which is what the
 * single-file path always sent, so a lone attachment posts exactly as it did before.
 */
export function commentDrafts(text: string, files: FileAttachment[]): CommentDraft[] {
  const trimmed = text.trim()

  if (files.length === 0) {
    // No file: nothing to say means nothing to send.
    if (!trimmed) return []
    return [{ content: trimmed, type: "TEXT", fileId: undefined }]
  }

  return files.map((file, index) => ({
    content: index === 0 && trimmed ? trimmed : `Attached: ${file.name}`,
    type: "ATTACHMENT" as const,
    fileId: fileIdFromUrl(file.url),
  }))
}
