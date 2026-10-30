import { BRAND } from '@/lib/brand/config'
import { NextResponse } from "next/server"
import { withAuth } from "@/lib/api-auth-wrapper"
import { prisma } from "@/lib/prisma"
import { randomUUID } from "crypto"
import { issuePresignedUpload, presignedUploadsEnabled } from "@/lib/secure-storage"
import { createLogger } from '@/lib/logger'
import { findSecureFileByClientRequestId } from "@/lib/secure-file-idempotency"
import { validateSecureUpload, SECURE_UPLOAD_MIME_TYPES } from '@/lib/upload-validation'

const log = createLogger('secure-upload.get-upload-url')

// The policy lives in lib/upload-validation.ts and is shared with
// request-upload and secure-storage. This file used to carry its own flat
// MIME list with NO extension check, so an allowed MIME could arrive on any
// extension at all. (Task c09f3eb1.)

const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100MB

/**
 * Get Upload URL for Client-Side Uploads
 *
 * This endpoint generates a client token that iOS/web clients can use to upload
 * files directly to Vercel Blob, bypassing the 4.5MB serverless function limit.
 *
 * Flow:
 * 1. Client POSTs file metadata + context to this endpoint
 * 2. Server validates permissions and generates a client token
 * 3. Client uploads directly to Vercel Blob using the token
 * 4. Vercel Blob calls /api/secure-upload/upload-complete to store metadata
 *
 * Authenticated through withAuth with attachments:write, like POST
 * /api/v1/upload (AWTD-1402). The JWT-then-database-session cookie fallback
 * this file used to carry is authenticateAPI's own cookie path, so web and
 * native sessions are admitted exactly as before.
 */
export const POST = withAuth(
  { scopes: ['attachments:write'], tag: 'v1.secure-upload.get-upload-url' },
  async (request, auth) => {
    try {
      const userId = auth.userId
      const body = await request.json()
      const { fileName, fileType, fileSize, context } = body

      // Validate required fields
      if (!fileName || !fileType || !fileSize || !context) {
        return NextResponse.json({
          error: "Missing required fields: fileName, fileType, fileSize, context"
        }, { status: 400 })
      }

      // Validate file type
      const typeCheck = validateSecureUpload(fileName, fileType)
      if (!typeCheck.valid) {
        return NextResponse.json({
          error: typeCheck.valid ? '' : typeCheck.error
        }, { status: 400 })
      }

      // Validate file size
      if (fileSize > MAX_FILE_SIZE) {
        return NextResponse.json({
          error: "File size cannot exceed 100MB"
        }, { status: 400 })
      }

      // Validate context has at least one target
      if (!context.taskId && !context.listId && !context.commentId && !context.channelId) {
        return NextResponse.json({
          error: "Upload context must specify taskId, listId, commentId, or channelId"
        }, { status: 400 })
      }

      // Permission checks based on context
      if (context.taskId) {
        const task = await prisma.task.findFirst({
          where: {
            id: context.taskId,
            OR: [
              { creatorId: userId },
              { assigneeId: userId },
              {
                lists: {
                  some: {
                    OR: [
                      { ownerId: userId },
                      { listMembers: { some: { userId: userId } } }
                    ]
                  }
                }
              }
            ]
          }
        })

        if (!task) {
          return NextResponse.json({
            error: "Task not found or access denied"
          }, { status: 404 })
        }
      }

      if (context.listId) {
        const list = await prisma.taskList.findFirst({
          where: {
            id: context.listId,
            OR: [
              { ownerId: userId },
              { listMembers: { some: { userId: userId } } }
            ]
          }
        })

        if (!list) {
          return NextResponse.json({
            error: "List not found or access denied"
          }, { status: 404 })
        }
      }

      if (context.commentId) {
        const comment = await prisma.comment.findFirst({
          where: {
            id: context.commentId,
            OR: [
              { authorId: userId },
              {
                task: {
                  OR: [
                    { creatorId: userId },
                    { assigneeId: userId },
                    {
                      lists: {
                        some: {
                          OR: [
                            { ownerId: userId },
                            { listMembers: { some: { userId: userId } } }
                          ]
                        }
                      }
                    }
                  ]
                }
              }
            ]
          }
        })

        if (!comment) {
          return NextResponse.json({
            error: "Comment not found or access denied"
          }, { status: 404 })
        }
      }

      if (context.channelId) {
        const { canAccessChatChannel } = await import('@/lib/chat-access')
        const hasAccess = await canAccessChatChannel(context.channelId, userId)
        if (!hasAccess) {
          return NextResponse.json({
            error: "Chat channel not found or access denied"
          }, { status: 404 })
        }
      }

      // Generate file ID and path. On an Outbox retry (same clientRequestId), reuse
      // the canonical fileId of the already-created SecureFile so the client gets a
      // real fileId back instead of a fresh one that the dedup-on-complete would
      // orphan.
      const retryClientRequestId = typeof context.clientRequestId === 'string' ? context.clientRequestId : null
      const existingFile = await findSecureFileByClientRequestId(userId, retryClientRequestId)
      const fileId = existingFile?.id ?? randomUUID()
      const fileExtension = fileName.split('.').pop() || ''
      const pathname = `files/${userId}/${fileId}.${fileExtension}`

      // Determine callback URL for upload completion
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : process.env.NEXTAUTH_URL || `https://${BRAND.domain}`
      const callbackUrl = `${baseUrl}/api/secure-upload/upload-complete`

      const uploadRequest = {
        pathname,
        onUploadCompleted: {
          callbackUrl,
          tokenPayload: JSON.stringify({
            userId: userId,
            fileId,
            fileName,
            fileType,
            fileSize,
            taskId: context.taskId || null,
            listId: context.listId || null,
            commentId: context.commentId || null,
            // Carry the idempotency key through to upload-complete so an Outbox
            // retry of a large upload doesn't create a duplicate SecureFile.
            clientRequestId: (typeof context.clientRequestId === 'string' ? context.clientRequestId : null),
          }),
        },
        maximumSizeInBytes: MAX_FILE_SIZE,
        allowedContentTypes: SECURE_UPLOAD_MIME_TYPES as string[],
      }

      // Presigned only (AWTD-1368): PUT presigned.uploadUrl with
      // presigned.headers plus Content-Type, and no Authorization. The legacy
      // `uploadToken` went with the Blob store's OIDC upgrade (AWTD-1386), so
      // iOS/Mac builds before 1253/1254 can no longer upload.
      if (!presignedUploadsEnabled()) {
        log.error("Direct uploads need BLOB_WEBHOOK_PUBLIC_KEY (the Blob store's OIDC upgrade) or STORAGE_DRIVER")
        return NextResponse.json({ error: "Storage not configured" }, { status: 500 })
      }

      const presigned = await issuePresignedUpload({ ...uploadRequest, contentType: fileType })

      return NextResponse.json({ pathname, fileId, presigned })

    } catch (error) {
      log.error({ err: error }, "Error generating upload URL:")
      return NextResponse.json({
        error: "Failed to generate upload URL"
      }, { status: 500 })
    }
  }
)
