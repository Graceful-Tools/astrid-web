/**
 * The attachments a task actually has. (Task b4a362f1)
 *
 * Files attached in the task form were written correctly — a `SecureFile` row
 * with `taskId` set — and then never read back: the form re-seeded itself from
 * the legacy `Attachment` model (whose only writers are the MCP handlers) and
 * the activity strip only walked comments. The file vanished from the product
 * the moment the form closed, which reads as data loss even though the row and
 * the blob were both still there.
 *
 * The subtlety worth stating: a comment attachment also carries `taskId`. The
 * composer uploads with `{ taskId }` context and `commentId` is stamped on
 * afterwards, so `task.secureFiles` contains the comment files too. "Attached
 * to the task itself" therefore means `commentId === null` — without that,
 * every comment attachment would be listed twice.
 *
 * That left one gap (task ded31696): between picking a file in the composer and
 * sending the message, `commentId` is still null, so an abandoned draft used to
 * graduate into a task attachment. Intent cannot be recovered after the fact, so
 * it is recorded at upload time as `attachTarget`. Legacy rows have it null and
 * stay classified exactly as they were.
 *
 * The third model (task AWTD-803): `Attachment`. Its only writers are the two
 * MCP handlers, and until now it had no reader in the product — the routes load
 * it (`include: { attachments: true }`) and shipped it to a client that walked
 * `secureFiles` only. A file attached through MCP was in the database and in the
 * account export, and invisible everywhere a user could look.
 *
 * The two kinds are read back differently, which is why the view carries
 * `source`: a `SecureFile` resolves through `/api/v1/secure-files/{id}`, while
 * an `Attachment` row carries a plain `url` and has no such record. Only the
 * *read* path unions them. `taskLevelAttachments` — what the task form owns and
 * can remove — stays secure-file-only, because removal goes through the
 * secure-files endpoint, which knows nothing about a legacy row.
 */

import type { Task, SecureFile, Attachment } from "@/types/task"

/** One attachment as the task views render it. */
export interface TaskAttachmentView {
  /** Stable key for lists — the file id. */
  id: string
  fileId: string
  name: string
  url: string
  type: string
  size: number
  createdAt: Date
  /** True when the file hangs off the task itself rather than off a comment. */
  isTaskLevel: boolean
  /**
   * Which model the row came from, and therefore how `url` is served:
   * `secure-file` needs the secure-files route, `legacy` is already a fetchable
   * url. Consumers must not hand a `legacy` id to SecureAttachmentViewer.
   */
  source: 'secure-file' | 'legacy'
}

function toView(file: SecureFile, isTaskLevel: boolean, createdAt?: Date): TaskAttachmentView {
  return {
    id: file.id,
    fileId: file.id,
    name: file.originalName,
    url: `/api/v1/secure-files/${file.id}`,
    type: file.mimeType,
    size: file.fileSize,
    createdAt: createdAt ?? file.createdAt,
    isTaskLevel,
    source: 'secure-file',
  }
}

/** A legacy `Attachment` row, which already carries the url it is served from. */
function legacyToView(row: Attachment): TaskAttachmentView {
  return {
    id: row.id,
    fileId: row.id,
    name: row.name,
    url: row.url,
    type: row.type,
    size: row.size,
    createdAt: row.createdAt,
    isTaskLevel: true,
    source: 'legacy',
  }
}

/**
 * Files attached to the task itself — what the task form owns and can remove.
 *
 * Excludes anything a composer uploaded, sent or not: a message's file belongs
 * to the message, and one still staged in a draft belongs to nothing yet.
 */
export function taskLevelAttachments(task: Pick<Task, 'secureFiles'>): TaskAttachmentView[] {
  return (task.secureFiles || [])
    .filter(file => !file.commentId && file.attachTarget !== 'message')
    .map(file => toView(file, true))
}

/**
 * Everything the task has attached, task-level first and then whatever its
 * comments carry, in comment order — so adding task-level files doesn't
 * reshuffle a strip the user already knows.
 *
 * Task-level covers both models: the secure files the task form writes, then
 * the legacy rows MCP writes (task AWTD-803). MCP rows come second so adding
 * one does not reshuffle a strip somebody already knows.
 */
export function collectTaskAttachments(task: Partial<Task>): TaskAttachmentView[] {
  const seen = new Set<string>()
  const seenUrls = new Set<string>()
  const result: TaskAttachmentView[] = []

  const push = (view: TaskAttachmentView) => {
    // Ids come from two tables, so identity alone cannot rule out one file
    // being listed under both models. The url is what the user would see twice.
    if (seen.has(view.fileId) || seenUrls.has(view.url)) return
    seen.add(view.fileId)
    seenUrls.add(view.url)
    result.push(view)
  }

  taskLevelAttachments(task as Pick<Task, 'secureFiles'>).forEach(push)
  ;(task.attachments || []).map(legacyToView).forEach(push)

  for (const comment of task.comments || []) {
    for (const file of comment.secureFiles || []) {
      // The comment's own timestamp is what the strip has always shown here.
      push(toView(file, false, comment.createdAt))
    }
  }

  return result
}
