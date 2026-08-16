import { NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { uploadFileToBlob } from "@/lib/secure-storage"
import { prisma } from "@/lib/prisma"
import { createLogger } from '@/lib/logger'
import { validateUploadFile, type FileTypeAllowlist } from '@/lib/upload-validation'
import {
  clientRequestIdFromContext,
  findSecureFileByClientRequestId,
  isUniqueConstraintError,
} from "@/lib/secure-file-idempotency"

const log = createLogger('secure-upload.request-upload')


// The MIME allowlist that used to live here was the value-set of
// EXTENSION_MIME_MAP written out a second time — 24 entries in each, agreeing
// exactly. The extension map is now the single statement of this route's
// policy, so a type can no longer be permitted in one list and forgotten in
// the other. (Task c09f3eb1.)

// Maximum file size: 100MB
/** Recognized values for the upload-intent discriminator (task ded31696). */
const ATTACH_TARGETS = ['message', 'task']

const MAX_FILE_SIZE = 100 * 1024 * 1024

// File extension to MIME type mapping for validation
const EXTENSION_MIME_MAP: Record<string, string[]> = {
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.gif': ['image/gif'],
  '.webp': ['image/webp'],
  '.svg': ['image/svg+xml'],
  '.heic': ['image/heic'],
  '.heif': ['image/heif'],
  '.mp4': ['video/mp4'],
  '.mov': ['video/quicktime'],
  '.webm': ['video/webm'],
  '.avi': ['video/x-msvideo'],
  '.pdf': ['application/pdf'],
  '.doc': ['application/msword'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.xls': ['application/vnd.ms-excel'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.txt': ['text/plain'],
  '.csv': ['text/csv', 'text/plain'],
  '.md': ['text/markdown', 'text/plain'],
  '.zip': ['application/zip', 'application/x-zip-compressed'],
  '.mp3': ['audio/mpeg'],
  '.wav': ['audio/wav'],
  '.ogg': ['audio/ogg'],
}

/**
 * Validate file type against this route's own allowlist.
 *
 * The ALGORITHM is shared (lib/upload-validation.ts); the POLICY is not, and
 * should not be — this surface accepts video and audio that a list image must
 * never accept. The helper takes the allowlist as a parameter precisely so the
 * four upload paths can agree on the check without merging what they permit.
 * (Task c09f3eb1.)
 *
 * EXTENSION_MIME_MAP keys carry a leading dot for readability at the call
 * sites below; the shared helper keys on the bare extension, so they are
 * stripped once here rather than at every lookup.
 */
const SECURE_UPLOAD_FILE_TYPES: FileTypeAllowlist = Object.fromEntries(
  Object.entries(EXTENSION_MIME_MAP).map(([ext, mimes]) => [ext.replace(/^\./, ''), mimes]),
)

function validateFileType(file: { name: string; type: string }): { valid: boolean; error?: string } {
  const result = validateUploadFile(file, SECURE_UPLOAD_FILE_TYPES)
  return result.valid ? { valid: true } : { valid: false, error: result.error }
}

/**
 * Validate file size
 */
function validateFileSize(file: File): { valid: boolean; error?: string } {
  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File size ${(file.size / 1024 / 1024).toFixed(1)}MB exceeds maximum allowed size of 100MB`
    }
  }
  return { valid: true }
}

// Helper to get session from either JWT (web) or database (mobile)
async function getSession(request: NextRequest) {
  // Try JWT session first (web app)
  const jwtSession = await getUnifiedSession()
  if (jwtSession?.user?.id) {
    return { user: { id: jwtSession.user.id } }
  }

  // Try database session (mobile app)
  // Check both cookie names - production uses __Secure- prefix for HTTPS
  const sessionCookie = request.cookies.get("next-auth.session-token")
    || request.cookies.get("__Secure-next-auth.session-token")
  if (!sessionCookie) {
    return null
  }

  const dbSession = await prisma.session.findUnique({
    where: { sessionToken: sessionCookie.value },
    include: { user: true },
  })

  if (!dbSession || dbSession.expires < new Date()) {
    return null
  }

  return { user: { id: dbSession.user.id } }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const contextData = formData.get("context") as string | null

    // Validate required fields
    if (!file || !contextData) {
      return NextResponse.json({
        error: "Missing required fields: file, context"
      }, { status: 400 })
    }

    // Server-side file validation
    const typeValidation = validateFileType(file)
    if (!typeValidation.valid) {
      return NextResponse.json({
        error: typeValidation.error
      }, { status: 400 })
    }

    const sizeValidation = validateFileSize(file)
    if (!sizeValidation.valid) {
      return NextResponse.json({
        error: sizeValidation.error
      }, { status: 400 })
    }

    const context = JSON.parse(contextData)

    // Validate context has at least one target
    if (!context.taskId && !context.listId && !context.commentId && !context.channelId) {
      return NextResponse.json({
        error: "Upload context must specify taskId, listId, commentId, or channelId"
      }, { status: 400 })
    }

    // What the file is being uploaded FOR, as opposed to what authorizes the
    // write (task ded31696). A composer uploads against a taskId but the file
    // belongs to the message, not the task; without this the two are
    // indistinguishable until the message is sent. An unrecognized value is
    // dropped rather than rejected — it only ever narrows a read.
    const attachTarget = ATTACH_TARGETS.includes(context.attachTarget)
      ? context.attachTarget
      : null

    // Permission checks based on context
    if (context.taskId) {
      // Check if user has access to the task
      const task = await prisma.task.findFirst({
        where: {
          id: context.taskId,
          OR: [
            { creatorId: session.user.id },
            { assigneeId: session.user.id },
            {
              lists: {
                some: {
                  OR: [
                    { ownerId: session.user.id },
                    { listMembers: { some: { userId: session.user.id } } }
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
      // Check if user has access to the list
      const list = await prisma.taskList.findFirst({
        where: {
          id: context.listId,
          OR: [
            { ownerId: session.user.id },
            { listMembers: { some: { userId: session.user.id } } }
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
      // Check if user has access to the comment's task
      const comment = await prisma.comment.findFirst({
        where: {
          id: context.commentId,
          OR: [
            { authorId: session.user.id },
            {
              task: {
                OR: [
                  { creatorId: session.user.id },
                  { assigneeId: session.user.id },
                  {
                    lists: {
                      some: {
                        OR: [
                          { ownerId: session.user.id },
                          { listMembers: { some: { userId: session.user.id } } }
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
      // Check if user has access to the chat channel
      const { canAccessChatChannel } = await import('@/lib/chat-access')
      const hasAccess = await canAccessChatChannel(context.channelId, session.user.id)
      if (!hasAccess) {
        return NextResponse.json({
          error: "Chat channel not found or access denied"
        }, { status: 404 })
      }
    }

    // Idempotency: if the iOS Outbox already uploaded this file (same
    // clientRequestId), return it instead of re-uploading a duplicate blob.
    const clientRequestId = clientRequestIdFromContext(context)
    const alreadyUploaded = await findSecureFileByClientRequestId(session.user.id, clientRequestId)
    if (alreadyUploaded) {
      return NextResponse.json({
        fileId: alreadyUploaded.id,
        fileName: alreadyUploaded.originalName,
        fileSize: alreadyUploaded.fileSize,
        mimeType: alreadyUploaded.mimeType,
        success: true
      })
    }

    // Upload file directly to Vercel Blob
    const uploadRequest = {
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      uploadContext: {
        ...context,
        userId: session.user.id
      }
    }

    const { blobUrl, fileId } = await uploadFileToBlob(file, uploadRequest)

    // Store metadata in database
    let secureFile
    try {
      secureFile = await prisma.secureFile.create({
        data: {
          id: fileId,
          blobUrl,
          originalName: file.name,
          mimeType: file.type,
          fileSize: file.size,
          uploadedBy: session.user.id,
          taskId: context.taskId || null,
          listId: context.listId || null,
          commentId: context.commentId || null,
          attachTarget,
          clientRequestId,
        }
      })
    } catch (createError) {
      // A concurrent retry won the race — return the file it created.
      const winner = isUniqueConstraintError(createError)
        ? await findSecureFileByClientRequestId(session.user.id, clientRequestId)
        : null
      if (!winner) throw createError
      secureFile = winner
    }

    return NextResponse.json({
      fileId: secureFile.id,
      fileName: secureFile.originalName,
      fileSize: secureFile.fileSize,
      mimeType: secureFile.mimeType,
      success: true
    })

  } catch (error) {
    log.error({ err: error }, "Error generating upload URL:")
    return NextResponse.json({
      error: "Failed to generate upload URL"
    }, { status: 500 })
  }
}