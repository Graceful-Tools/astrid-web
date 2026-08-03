/**
 * Posting a comment (or a reply) that may carry several attachments. (Task 9f325964)
 *
 * The comments API takes a single `fileId`, so multi-select fans out to one comment
 * per file — see lib/comment-attachments. That fan-out was about to be written three
 * times: the task-detail input bar, the view-only comment input, and the reply input.
 * iOS got exactly two of its three inputs right the first time, so the third one
 * silently dropped files; the arithmetic lives in one place here instead.
 *
 * Where the three genuinely differ is how a comment lands in the tree — top-level
 * append vs. nesting under a parent — so callers pass those writes in.
 */

import type { User } from "@/types/task"
import type { FileAttachment } from "@/hooks/task-detail/useTaskDetailState"
import { commentDrafts, type CommentDraft } from "@/lib/comment-attachments"

export interface PendingComment {
  tempId: string
  /** The request body — `{ content, type, fileId, parentCommentId? }`. */
  commentData: CommentDraft & { parentCommentId?: string }
  /** The comment to show before the server answers. */
  optimistic: Record<string, unknown>
}

export interface CommentPostHandlers {
  /** Swap one optimistic comment for the server's version. */
  replace: (tempId: string, serverComment: any) => void
  /** Drop optimistic comments that never reached the server. */
  remove: (tempIds: string[]) => void
  /**
   * Put the input back after a failure: `text` is null when the caption already
   * posted successfully, and `files` are only the ones that never made it.
   */
  restore: (text: string | null, files: FileAttachment[]) => void
}

/**
 * Turn typed text plus staged files into the comments to post, each with the
 * optimistic row that stands in for it until the server replies.
 */
export async function buildPendingComments(opts: {
  taskId: string
  currentUser: User
  text: string
  files: FileAttachment[]
  parentCommentId?: string
  /** `temp-` for comments, `temp-reply-` for replies — kept so existing ids read the same. */
  idPrefix?: string
}): Promise<PendingComment[]> {
  const { taskId, currentUser, text, files, parentCommentId, idPrefix = "temp" } = opts

  const drafts = commentDrafts(text, files)
  if (drafts.length === 0) return []

  const { nanoid } = await import("nanoid")

  return drafts.map((draft, index) => {
    const tempId = `${idPrefix}-${nanoid()}`
    const file = files[index]
    const commentData = parentCommentId ? { ...draft, parentCommentId } : draft

    return {
      tempId,
      commentData,
      optimistic: {
        id: tempId,
        content: draft.content,
        type: draft.type,
        author: currentUser,
        authorId: currentUser.id,
        taskId,
        createdAt: new Date(),
        updatedAt: new Date(),
        parentCommentId,
        replies: [],
        secureFiles: file
          ? [
              {
                id: draft.fileId || `${idPrefix}-file`,
                originalName: file.name,
                mimeType: file.type || "application/octet-stream",
                fileSize: file.size || 0,
                uploadedBy: currentUser.id,
                uploadedAt: new Date(),
                commentId: tempId,
              },
            ]
          : [],
      },
    }
  })
}

/**
 * Post the pending comments in pick order, so the thread reads the way the files
 * were chosen. A failure part-way rolls back only what never went out — comments
 * already accepted by the server stay posted rather than vanishing from the UI.
 *
 * Assumes the caller has already inserted the optimistic comments and cleared the input.
 */
export async function postPendingComments(
  taskId: string,
  pending: PendingComment[],
  files: FileAttachment[],
  originalText: string,
  handlers: CommentPostHandlers,
): Promise<void> {
  const { OfflineSyncManager, isOfflineMode } = await import("@/lib/offline-sync")
  const { OfflineCommentOperations } = await import("@/lib/offline-db")

  let sent = 0

  try {
    if (isOfflineMode()) {
      for (const { optimistic, tempId, commentData } of pending) {
        await OfflineCommentOperations.saveComment(optimistic as any)
        await OfflineSyncManager.queueMutation(
          "create",
          "comment",
          tempId,
          `/api/tasks/${taskId}/comments`,
          "POST",
          commentData,
          taskId, // parentId for dependency tracking
        )
        sent += 1
      }
      return
    }

    for (const { commentData, tempId } of pending) {
      const response = await fetch(`/api/tasks/${taskId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(commentData),
      })

      if (!response.ok) throw new Error("Failed to add comment")

      const serverComment = await response.json()
      await OfflineCommentOperations.saveComment(serverComment)
      sent += 1
      handlers.replace(tempId, serverComment)
    }
  } catch (error) {
    console.error("Error adding comment:", error)
    handlers.remove(pending.slice(sent).map(p => p.tempId))
    // The caption rides only the first comment, so it is lost only if that one failed.
    handlers.restore(sent === 0 ? originalText : null, files.slice(sent))
  }
}
