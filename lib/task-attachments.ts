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
 */

import type { Task, SecureFile } from "@/types/task"

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
}

function toView(file: SecureFile, isTaskLevel: boolean, createdAt?: Date): TaskAttachmentView {
  return {
    id: file.id,
    fileId: file.id,
    name: file.originalName,
    url: `/api/secure-files/${file.id}`,
    type: file.mimeType,
    size: file.fileSize,
    createdAt: createdAt ?? file.createdAt,
    isTaskLevel,
  }
}

/** Files attached to the task itself — what the task form owns and can remove. */
export function taskLevelAttachments(task: Pick<Task, 'secureFiles'>): TaskAttachmentView[] {
  return (task.secureFiles || [])
    .filter(file => !file.commentId)
    .map(file => toView(file, true))
}

/**
 * Everything the task has attached, task-level first and then whatever its
 * comments carry, in comment order — so adding task-level files doesn't
 * reshuffle a strip the user already knows.
 */
export function collectTaskAttachments(task: Partial<Task>): TaskAttachmentView[] {
  const seen = new Set<string>()
  const result: TaskAttachmentView[] = []

  const push = (view: TaskAttachmentView) => {
    if (seen.has(view.fileId)) return
    seen.add(view.fileId)
    result.push(view)
  }

  taskLevelAttachments(task as Pick<Task, 'secureFiles'>).forEach(push)

  for (const comment of task.comments || []) {
    for (const file of comment.secureFiles || []) {
      // The comment's own timestamp is what the strip has always shown here.
      push(toView(file, false, comment.createdAt))
    }
  }

  return result
}
