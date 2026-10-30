import { NextResponse } from "next/server"
import { withAuth } from "@/lib/api-auth-wrapper"
import { prisma } from "@/lib/prisma"
import { createLogger } from '@/lib/logger'
import { validateSecureUpload } from '@/lib/upload-validation'
import { clientRequestIdFromContext } from "@/lib/secure-file-idempotency"
import { storeSecureUpload } from "@/services/secure-upload.service"

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

// The extension/MIME policy is shared — see lib/upload-validation.ts. This
// file used to carry its own map, which was the widest of the three secure
// surfaces but still missed mkv, pptx and json that the other two allowed.
// (Task c09f3eb1.)

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

function validateFileType(file: { name: string; type: string }): { valid: boolean; error?: string } {
  const result = validateSecureUpload(file.name, file.type)
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

/**
 * Authenticated through withAuth with attachments:write, like POST
 * /api/v1/upload (AWTD-1402). The JWT-then-database-session cookie fallback
 * this file used to carry is authenticateAPI's own cookie path, so web and
 * native sessions are admitted exactly as before.
 */
export const POST = withAuth(
  { scopes: ['attachments:write'], tag: 'v1.secure-upload.request-upload' },
  async (request, auth) => {
    try {
      const userId = auth.userId
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
              { creatorId: userId },
              { assigneeId: userId },
              {
                lists: {
                  some: {
                    OR: [
                      { ownerId: userId },
                      { listMembers: { some: { userId } } }
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
              { ownerId: userId },
              { listMembers: { some: { userId } } }
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
                            { listMembers: { some: { userId } } }
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
        const hasAccess = await canAccessChatChannel(context.channelId, userId)
        if (!hasAccess) {
          return NextResponse.json({
            error: "Chat channel not found or access denied"
          }, { status: 404 })
        }
      }

      // Idempotent on clientRequestId: an iOS Outbox retry of the same file gets
      // the already-created SecureFile back instead of a duplicate blob.
      const { file: secureFile } = await storeSecureUpload({
        userId,
        file,
        context,
        attachTarget,
        clientRequestId: clientRequestIdFromContext(context),
      })

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
)
