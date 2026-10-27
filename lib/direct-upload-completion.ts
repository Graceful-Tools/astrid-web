/**
 * Record a direct upload once its bytes have landed.
 *
 * Two callers, one rule (AWTD-1286): Vercel Blob's signed callback
 * (`/api/secure-upload/upload-complete`), and the self-hosted upload route
 * (`/api/v1/storage/uploads/[token]`), which stores the bytes itself. Both
 * trust `tokenPayload` only because get-upload-url checked the caller's access
 * to the target when it signed the grant.
 */

import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import {
  findSecureFileByClientRequestId,
  isUniqueConstraintError,
} from '@/lib/secure-file-idempotency'

const log = createLogger('direct-upload-completion')

export interface LandedObject {
  url: string
  contentType?: string
  size?: number
}

export async function recordDirectUpload(object: LandedObject, tokenPayload: string): Promise<void> {
  const payload = JSON.parse(tokenPayload)
  const { userId, fileId, fileName, fileType, fileSize, taskId, listId, commentId, clientRequestId } = payload

  log.info({ fileId, fileName, userId, blobUrl: object.url }, '📦 [UploadComplete] Storing file metadata:')

  // Idempotency: an Outbox retry of a large upload re-runs completion with
  // the same clientRequestId — don't create a second SecureFile record.
  const existing = await findSecureFileByClientRequestId(
    userId,
    typeof clientRequestId === 'string' ? clientRequestId : null
  )
  if (existing) {
    log.info({ fileId: existing.id }, '📦 [UploadComplete] Idempotent hit — file already stored')
    return
  }

  try {
    await prisma.secureFile.create({
      data: {
        id: fileId,
        blobUrl: object.url,
        originalName: fileName,
        mimeType: fileType || object.contentType || 'application/octet-stream',
        fileSize: fileSize || object.size || 0,
        uploadedBy: userId,
        taskId: taskId || null,
        listId: listId || null,
        commentId: commentId || null,
        clientRequestId: (typeof clientRequestId === 'string' ? clientRequestId : null),
      }
    })
  } catch (createError) {
    // Concurrent retry race — fine if the other one already stored it.
    if (!isUniqueConstraintError(createError)) throw createError
    log.info({ fileId }, '📦 [UploadComplete] Idempotent race — file already stored')
  }

  log.info({ fileId }, '✅ [UploadComplete] File metadata stored successfully:')
}
