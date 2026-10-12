/**
 * Persist an uploaded file as a SecureFile — the write half of the secure
 * upload chain, after the caller has authenticated and authorised it.
 *
 * Lived inline in POST /api/secure-upload/request-upload. Extracted so the
 * task-attachment ticket route stores bytes through the SAME path rather than
 * a second copy of it: replay-by-clientRequestId, the object-store write (which
 * applies the shared type policy), the metadata row, and the race where two
 * retries both miss the lookup and one loses the unique constraint.
 */

import type { SecureFile } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { uploadFileToBlob } from '@/lib/secure-storage'
import {
  findSecureFileByClientRequestId,
  isUniqueConstraintError,
} from '@/lib/secure-file-idempotency'

export interface SecureUploadContext {
  taskId?: string | null
  listId?: string | null
  commentId?: string | null
  [key: string]: unknown
}

export interface StoreSecureUploadArgs {
  userId: string
  file: File
  context: SecureUploadContext
  attachTarget: string | null
  clientRequestId: string | null
}

export async function storeSecureUpload(
  args: StoreSecureUploadArgs,
): Promise<{ file: SecureFile; reused: boolean }> {
  const { userId, file, context, attachTarget, clientRequestId } = args

  const alreadyUploaded = await findSecureFileByClientRequestId(userId, clientRequestId)
  if (alreadyUploaded) return { file: alreadyUploaded, reused: true }

  const { blobUrl, fileId } = await uploadFileToBlob(file, {
    fileName: file.name,
    fileType: file.type,
    fileSize: file.size,
    uploadContext: { ...context, userId } as never,
  })

  try {
    const created = await prisma.secureFile.create({
      data: {
        id: fileId,
        blobUrl,
        originalName: file.name,
        mimeType: file.type,
        fileSize: file.size,
        uploadedBy: userId,
        taskId: context.taskId || null,
        listId: context.listId || null,
        commentId: context.commentId || null,
        attachTarget,
        clientRequestId,
      },
    })
    return { file: created, reused: false }
  } catch (createError) {
    // A concurrent retry won the race — return the file it created.
    const winner = isUniqueConstraintError(createError)
      ? await findSecureFileByClientRequestId(userId, clientRequestId)
      : null
    if (!winner) throw createError
    return { file: winner, reused: true }
  }
}
