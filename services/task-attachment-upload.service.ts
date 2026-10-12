/**
 * Put an image on a task as a comment attachment, for clients that hold an
 * API token but cannot send multipart through their own transport — chiefly
 * the MCP server, whose tool arguments are model context, not a byte channel.
 *
 *   mint     POST /api/v1/tasks/:id/attachment-uploads   (authenticated)
 *   complete PUT  /api/v1/attachment-uploads             (ticket only)
 *
 * The result is an ordinary SecureFile linked to an ordinary ATTACHMENT
 * comment, created through the same services every other surface uses, so
 * the image appears wherever a comment attachment already appears.
 */

import { prisma } from '@/lib/prisma'
import { userCanAccessTask } from '@/services/task.service'
import { createCommentWithSideEffects } from '@/services/comment.service'
import { storeSecureUpload } from '@/services/secure-upload.service'
import { IMAGE_FILE_TYPES, sniffImageMimeType, validateUploadFile } from '@/lib/upload-validation'
import {
  ATTACHMENT_UPLOAD_TICKET_TTL_MS,
  signAttachmentUploadTicket,
  type AttachmentUploadTicket,
} from '@/lib/attachment-upload-ticket'
import { randomUUID } from 'crypto'

/** Below Vercel's 4.5 MB request-body ceiling, which this route's bytes cross. */
export const TASK_ATTACHMENT_MAX_BYTES = 4 * 1024 * 1024
export const TASK_ATTACHMENT_CAPTION_MAX = 1000
const FILE_NAME_MAX = 200
const CLIENT_REQUEST_ID_MAX = 200

/** The task, with what access and the comment side effects both read. */
async function loadTask(taskId: string) {
  return prisma.task.findUnique({
    where: { id: taskId },
    include: {
      lists: {
        select: {
          id: true,
          name: true,
          ownerId: true,
          privacy: true,
          githubRepositoryId: true,
          aiAgentConfiguredBy: true,
          listMembers: { select: { userId: true, role: true } },
        },
      },
      assignee: {
        select: { id: true, email: true, name: true, isAIAgent: true, aiAgentType: true },
      },
    },
  })
}

/**
 * Standard access only — creator, assignee, or a list role. Deliberately not
 * the collaborative-public allowance a text comment gets: storing bytes is the
 * secure-upload chain's rule, and that chain has never admitted strangers.
 */
async function loadAccessibleTask(taskId: string, userId: string) {
  const task = await loadTask(taskId)
  if (!task || !userCanAccessTask(task as never, userId)) return null
  return task
}

export type MintResult =
  | { ok: true; ticket: string; claims: AttachmentUploadTicket }
  | { ok: false; status: 400 | 404; error: string }

export async function mintTaskAttachmentUpload(args: {
  taskId: string
  userId: string
  authorId: string
  fileName: unknown
  mimeType?: unknown
  caption?: unknown
  clientRequestId?: unknown
}): Promise<MintResult> {
  const { fileName, caption, clientRequestId } = args
  if (typeof fileName !== 'string' || !fileName.trim()) {
    return { ok: false, status: 400, error: 'fileName is required' }
  }
  if (fileName.length > FILE_NAME_MAX || /[\\/\u0000-\u001f]/.test(fileName)) {
    return { ok: false, status: 400, error: 'fileName must be a plain file name, not a path' }
  }

  const extension = fileName.toLowerCase().split('.').pop() ?? ''
  const mimeType = args.mimeType ?? IMAGE_FILE_TYPES[extension]?.[0]
  const typeCheck = validateUploadFile(
    { name: fileName, type: typeof mimeType === 'string' ? mimeType : '' },
    IMAGE_FILE_TYPES,
  )
  if (!typeCheck.valid) return { ok: false, status: 400, error: typeCheck.error }

  if (caption !== undefined && caption !== null && typeof caption !== 'string') {
    return { ok: false, status: 400, error: 'caption must be a string' }
  }
  if (typeof caption === 'string' && caption.length > TASK_ATTACHMENT_CAPTION_MAX) {
    return { ok: false, status: 400, error: `caption must be at most ${TASK_ATTACHMENT_CAPTION_MAX} characters` }
  }
  if (
    clientRequestId !== undefined &&
    (typeof clientRequestId !== 'string' || !clientRequestId || clientRequestId.length > CLIENT_REQUEST_ID_MAX)
  ) {
    return { ok: false, status: 400, error: `clientRequestId must be a non-empty string of at most ${CLIENT_REQUEST_ID_MAX} characters` }
  }

  if (!(await loadAccessibleTask(args.taskId, args.userId))) {
    return { ok: false, status: 404, error: 'Task not found or access denied' }
  }

  const claims: AttachmentUploadTicket = {
    userId: args.userId,
    authorId: args.authorId,
    taskId: args.taskId,
    fileName: fileName.trim(),
    mimeType: mimeType as string,
    caption: typeof caption === 'string' && caption.trim() ? caption.trim() : null,
    // Always present, so a retried PUT of the same ticket is a replay, not a duplicate.
    clientRequestId: (clientRequestId as string | undefined) ?? randomUUID(),
    expiresAt: Date.now() + ATTACHMENT_UPLOAD_TICKET_TTL_MS,
  }
  return { ok: true, ticket: signAttachmentUploadTicket(claims), claims }
}

export type CompleteResult =
  | { ok: true; created: boolean; comment: unknown; fileId: string }
  | { ok: false; status: 400 | 404 | 409 | 413; error: string }

export async function completeTaskAttachmentUpload(
  claims: AttachmentUploadTicket,
  bytes: Uint8Array,
): Promise<CompleteResult> {
  if (bytes.length === 0) return { ok: false, status: 400, error: 'Request body is empty' }
  if (bytes.length > TASK_ATTACHMENT_MAX_BYTES) {
    return { ok: false, status: 413, error: `File exceeds ${TASK_ATTACHMENT_MAX_BYTES} bytes` }
  }
  if (sniffImageMimeType(bytes) !== claims.mimeType) {
    return { ok: false, status: 400, error: `Body is not a ${claims.mimeType} image` }
  }

  // Re-checked: access can be revoked inside the ticket's lifetime.
  const task = await loadAccessibleTask(claims.taskId, claims.userId)
  if (!task) return { ok: false, status: 404, error: 'Task not found or access denied' }

  // One key, namespaced per task: comment keys are globally unique, file keys per uploader.
  const key = `task-attachment:${claims.taskId}:${claims.clientRequestId}`

  const { file } = await storeSecureUpload({
    userId: claims.userId,
    file: new File([bytes as BlobPart], claims.fileName, { type: claims.mimeType }),
    context: { taskId: claims.taskId },
    attachTarget: 'task',
    clientRequestId: key,
  })

  const outcome = await createCommentWithSideEffects({
    task: {
      id: task.id,
      title: task.title,
      creatorId: task.creatorId,
      assigneeId: task.assigneeId,
      assignee: task.assignee,
      lists: task.lists,
    } as never,
    authorId: claims.authorId,
    // The web composer's caption fallback (lib/comment-attachments.ts).
    content: claims.caption ?? `Attached: ${claims.fileName}`,
    type: 'ATTACHMENT',
    clientRequestId: key,
    file: { id: file.id, linkerUserId: claims.userId },
  })

  if (outcome.kind === 'invalid') return { ok: false, status: 400, error: outcome.error }
  if (outcome.kind === 'conflict') return { ok: false, status: 409, error: outcome.error }
  return { ok: true, created: outcome.kind === 'created', comment: outcome.comment, fileId: file.id }
}
