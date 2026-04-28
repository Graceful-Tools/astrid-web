import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { createLogger } from '@/lib/logger'

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
    const body = await request.json()

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
    const { userId, fileId, fileName, fileType, fileSize, taskId, listId, commentId } = payload

    log.info({
      fileId,
      fileName,
      userId,
      blobUrl: blob.url,
    }, '📦 [UploadComplete] Storing file metadata:')

    // Store metadata in database
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
      }
    })

    log.info({ fileId }, '✅ [UploadComplete] File metadata stored successfully:')

    return NextResponse.json({ success: true })
  } catch (error) {
    log.error({ err: error }, '❌ [UploadComplete] Error:')
    return NextResponse.json({
      error: 'Failed to process upload completion'
    }, { status: 500 })
  }
}
