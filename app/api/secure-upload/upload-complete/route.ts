import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { createLogger } from '@/lib/logger'
import { verifyBlobCallbackSignature } from "@/lib/blob-callback-signature"
import {
  findSecureFileByClientRequestId,
  isUniqueConstraintError,
} from "@/lib/secure-file-idempotency"

const log = createLogger('secure-upload.upload-complete')


/**
 * Upload Complete Callback
 *
 * This endpoint is called by Vercel Blob after a successful direct upload.
 * It stores the file metadata in the database.
 *
 * The request contains:
 * - type: "blob.upload-completed"
 * - payload.blob: { url, pathname, contentType, contentDisposition }
 * - payload.tokenPayload: JSON string with our custom data
 */
export async function POST(request: NextRequest) {
  try {
    // SECURITY: verify the Vercel Blob callback signature over the RAW body
    // before trusting anything in it. Without this, anyone could POST a forged
    // tokenPayload and attach an arbitrary blob URL onto any victim's
    // task/comment/list. The tokenPayload itself is trustworthy only because
    // get-upload-url validated the caller's access to the target at mint time.
    const rawBody = await request.text()
    const signature = request.headers.get('x-vercel-signature')
    if (!verifyBlobCallbackSignature(rawBody, signature, process.env.BLOB_READ_WRITE_TOKEN)) {
      log.error('❌ [UploadComplete] Invalid or missing callback signature')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    const body = JSON.parse(rawBody)

    log.info({ body }, '📦 [UploadComplete] Received callback')

    // Validate request type
    if (body.type !== 'blob.upload-completed') {
      log.error(body.type, '❌ [UploadComplete] Invalid request type:')
      return NextResponse.json({ error: 'Invalid request type' }, { status: 400 })
    }

    const { blob, tokenPayload } = body.payload

    if (!blob || !tokenPayload) {
      log.error('❌ [UploadComplete] Missing blob or tokenPayload')
      return NextResponse.json({ error: 'Missing required data' }, { status: 400 })
    }

    // Parse the token payload we sent when generating the upload URL
    const payload = JSON.parse(tokenPayload)
    const { userId, fileId, fileName, fileType, fileSize, taskId, listId, commentId, clientRequestId } = payload

    log.info({
      fileId,
      fileName,
      userId,
      blobUrl: blob.url,
    }, '📦 [UploadComplete] Storing file metadata:')

    // Idempotency: an Outbox retry of a large upload re-runs this callback with
    // the same clientRequestId — don't create a second SecureFile record.
    const existing = await findSecureFileByClientRequestId(
      userId,
      typeof clientRequestId === 'string' ? clientRequestId : null
    )
    if (existing) {
      log.info({ fileId: existing.id }, '📦 [UploadComplete] Idempotent hit — file already stored')
      return NextResponse.json({ success: true })
    }

    // Store metadata in database
    try {
      await prisma.secureFile.create({
        data: {
          id: fileId,
          blobUrl: blob.url,
          originalName: fileName,
          mimeType: fileType || blob.contentType || 'application/octet-stream',
          fileSize: fileSize || blob.size || 0,
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

    return NextResponse.json({ success: true })
  } catch (error) {
    log.error({ err: error }, '❌ [UploadComplete] Error:')
    return NextResponse.json({
      error: 'Failed to process upload completion'
    }, { status: 500 })
  }
}
