import { NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { generateSignedDownloadUrl, uploadFileToBlob, deleteFile } from "@/lib/secure-storage"
import { prisma } from "@/lib/prisma"
import { hasListAccess } from "@/lib/list-member-utils"
import type { RouteContextParams } from "@/types/next"
import { createLogger } from '@/lib/logger'
import { hasExplicitListRole } from "@/lib/list-permissions"
import { authenticateAPI, hasApiTokenCredential } from "@/lib/api-auth-middleware"
import { hasRequiredScopes } from "@/lib/oauth/oauth-scopes"

const log = createLogger('secure-files.[fileId]')


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

type RequesterResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse }

/**
 * Who is asking for this file — by cookie OR by API token (AWTD-982).
 *
 * This route is mounted at `/api/v1/secure-files/[fileId]` as well, and was
 * the one `/api/v1/*` surface that never looked at `X-OAuth-Token`. An OAuth
 * client has no cookie and cannot obtain one — client-credentials issues a
 * token, not a session — so every attachment 401'd for every API client, and
 * an agent told to read a task's screenshots could see that they existed and
 * never open one.
 *
 * The scope gate applies to tokens only. `AuthContext.scopes` is empty on the
 * session path, so gating a browser request on it would lock the web app out
 * of its own attachments; the cookie path keeps the authorization it has
 * always had, which is the per-file check below.
 *
 * Attachments are user photos, so the token path is deliberately NOT opened to
 * every credential that authenticates: it requires the `attachments:*` scope
 * matching the method. Per-file authorization is unchanged either way — the
 * caller still has to be able to see the task, list, comment or chat message
 * the file hangs off.
 */
async function resolveRequester(
  request: NextRequest,
  requiredScope: string,
): Promise<RequesterResult> {
  if (hasApiTokenCredential(request)) {
    try {
      const auth = await authenticateAPI(request)

      if (!hasRequiredScopes(auth.scopes, [requiredScope])) {
        // 403, not 401: the credential was fine and the grant was not, and a
        // client that cannot tell those apart retries forever with a token
        // that will never work. Scope names stay in the log rather than in the
        // body, matching the SSE route (task 17fea642).
        log.warn(
          { scopes: auth.scopes, requiredScope, source: auth.source },
          'Token missing required scope for secure file'
        )
        return {
          ok: false,
          response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
        }
      }

      return { ok: true, userId: auth.userId }
    } catch (authError) {
      log.warn({ err: authError }, 'API token authentication failed for secure file')
      return {
        ok: false,
        response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      }
    }
  }

  const session = await getSession(request)
  if (!session?.user?.id) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    }
  }

  return { ok: true, userId: session.user.id }
}

export async function GET(request: NextRequest, context: RouteContextParams<{ fileId: string }>) {
  try {
    const requester = await resolveRequester(request, 'attachments:read')
    if (!requester.ok) return requester.response
    const session = { user: { id: requester.userId } }

    const { fileId } = await context.params
    const { searchParams } = new URL(request.url)
    const info = searchParams.get('info') === 'true' // ?info=true for JSON metadata

    // Get file metadata from database
    const secureFile = await prisma.secureFile.findUnique({
      where: { id: fileId },
      include: {
        uploader: {
          select: { id: true, name: true, email: true }
        },
        task: {
          include: {
            lists: {
              include: {
                owner: true,
                listMembers: {
                  include: {
                    user: true
                  }
                }
              }
            }
          }
        },
        list: {
          include: {
            owner: true,
            listMembers: {
              include: {
                user: true
              }
            }
          }
        },
        comment: {
          include: {
            task: {
              include: {
                lists: {
                  include: {
                    owner: true,
                    listMembers: {
                      include: {
                        user: true
                      }
                    }
                  }
                }
              }
            }
          }
        },
        chatMessage: {
          include: {
            channel: {
              include: {
                list: {
                  include: {
                    listMembers: true
                  }
                }
              }
            }
          }
        }
      }
    })

    if (!secureFile) {
      return NextResponse.json({ error: "File not found" }, { status: 404 })
    }

    // Permission checks - use same logic as task details route
    let hasAccess = false

    // Check if user is the uploader
    if (secureFile.uploadedBy === session.user.id) {
      hasAccess = true
    }

    // Check access based on context
    if (!hasAccess && secureFile.taskId && secureFile.task) {
      // Check task access using same pattern as task details
      const task = secureFile.task
      const canView =
        task.assigneeId === session.user.id ||
        task.creatorId === session.user.id ||
        task.lists.some((list) => hasListAccess(list, session.user.id)) ||
        // Allow viewing files on public lists (both copy-only and collaborative)
        task.lists.some((list) => list.privacy === 'PUBLIC')

      if (canView) {
        hasAccess = true
      }
    }

    if (!hasAccess && secureFile.listId && secureFile.list) {
      // Check list access using standard hasListAccess function
      if (hasListAccess(secureFile.list, session.user.id) || secureFile.list.privacy === 'PUBLIC') {
        hasAccess = true
      }
    }

    if (!hasAccess && secureFile.commentId && secureFile.comment) {
      // Check comment access through task
      const comment = secureFile.comment
      if (comment.authorId === session.user.id) {
        hasAccess = true
      }

      if (!hasAccess && comment.task) {
        // Use same task access pattern as above
        const task = comment.task
        const canView =
          task.assigneeId === session.user.id ||
          task.creatorId === session.user.id ||
          task.lists.some((list) => hasListAccess(list, session.user.id)) ||
          // Allow viewing files on public lists (both copy-only and collaborative)
          task.lists.some((list) => list.privacy === 'PUBLIC')

        if (canView) {
          hasAccess = true
        }
      }
    }

    if (!hasAccess && secureFile.chatMessageId && (secureFile as any).chatMessage) {
      // Check chat message access through channel
      const chatMessage = (secureFile as any).chatMessage
      if (chatMessage.authorId === session.user.id) {
        hasAccess = true
      }

      if (!hasAccess && chatMessage.channel?.list) {
        const list = chatMessage.channel.list
        // Owner/admin/member, or any public list (task e2803305).
        if (hasExplicitListRole({ id: session.user.id }, list as never) || list.privacy === 'PUBLIC') {
          hasAccess = true
        }
      }
    }

    if (!hasAccess) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }

    // Generate signed download URL (5 minute expiry)
    const downloadUrl = await generateSignedDownloadUrl(secureFile.blobUrl, 300)

    // If info=true, return JSON metadata instead of redirecting
    if (info) {
      return NextResponse.json({
        url: downloadUrl,
        fileName: secureFile.originalName,
        mimeType: secureFile.mimeType,
        fileSize: secureFile.fileSize,
        expiresIn: 300 // 5 minutes
      })
    }

    // For all files, redirect directly to the signed URL
    // This allows <img> tags to work properly for images
    return NextResponse.redirect(downloadUrl)

  } catch (error) {
    log.error({ err: error }, "Error serving secure file:")
    return NextResponse.json({
      error: "Failed to serve file"
    }, { status: 500 })
  }
}

/**
 * PUT /api/secure-files/[fileId]
 * Update an existing secure file with new content (e.g., after editing in iOS markup)
 * Only the file uploader can update the file
 */
export async function PUT(request: NextRequest, context: RouteContextParams<{ fileId: string }>) {
  try {
    const requester = await resolveRequester(request, 'attachments:write')
    if (!requester.ok) return requester.response
    const session = { user: { id: requester.userId } }

    const { fileId } = await context.params

    // Get existing file metadata
    const existingFile = await prisma.secureFile.findUnique({
      where: { id: fileId },
    })

    if (!existingFile) {
      return NextResponse.json({ error: "File not found" }, { status: 404 })
    }

    // Only the uploader can update the file
    if (existingFile.uploadedBy !== session.user.id) {
      return NextResponse.json({ error: "Only the file uploader can update this file" }, { status: 403 })
    }

    if (existingFile.attachTarget === 'list-image') {
      return NextResponse.json({
        error: "List images must be replaced through list settings."
      }, { status: 409 })
    }

    // Parse the multipart form data
    const formData = await request.formData()
    const file = formData.get("file") as File | null

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    // Validate file size (max 100MB)
    if (file.size > 100 * 1024 * 1024) {
      return NextResponse.json({ error: "File size cannot exceed 100MB" }, { status: 400 })
    }

    // Upload new file to blob storage
    const uploadRequest = {
      fileName: existingFile.originalName, // Keep original name
      fileType: file.type || existingFile.mimeType,
      fileSize: file.size,
      uploadContext: {
        taskId: existingFile.taskId || undefined,
        listId: existingFile.listId || undefined,
        commentId: existingFile.commentId || undefined,
        userId: session.user.id
      }
    }

    const { blobUrl: newBlobUrl } = await uploadFileToBlob(file, uploadRequest)

    // Store old blob URL for cleanup
    const oldBlobUrl = existingFile.blobUrl

    // Update database record with new blob URL
    const updatedFile = await prisma.secureFile.update({
      where: { id: fileId },
      data: {
        blobUrl: newBlobUrl,
        fileSize: file.size,
        mimeType: file.type || existingFile.mimeType,
        updatedAt: new Date(),
      }
    })

    // Delete old blob (best effort, don't fail if this fails)
    try {
      await deleteFile(oldBlobUrl)
      log.info(`🗑️ [SecureFiles] Deleted old blob: ${oldBlobUrl}`)
    } catch (deleteError) {
      log.warn({ deleteError }, `⚠️ [SecureFiles] Failed to delete old blob: ${oldBlobUrl}`)
    }

    log.info(`✅ [SecureFiles] Updated file ${fileId}: ${oldBlobUrl} -> ${newBlobUrl}`)

    return NextResponse.json({
      id: updatedFile.id,
      originalName: updatedFile.originalName,
      mimeType: updatedFile.mimeType,
      fileSize: updatedFile.fileSize,
      updatedAt: updatedFile.updatedAt,
      success: true
    })

  } catch (error) {
    log.error({ err: error }, "Error updating secure file:")
    return NextResponse.json({
      error: "Failed to update file"
    }, { status: 500 })
  }
}

/**
 * Delete a secure file — the row and the blob. (Task b4a362f1)
 *
 * There was no delete path at all, so the task form's remove button only
 * filtered local state: the row and the blob outlived every "removal", and the
 * file reappeared the next time anything read the task back.
 *
 * Uploader-only, matching PUT. A file already attached to a comment is refused
 * — removing it would leave that comment pointing at nothing, and the comment
 * is the thing the user would need to delete instead.
 */
export async function DELETE(request: NextRequest, context: RouteContextParams<{ fileId: string }>) {
  try {
    const requester = await resolveRequester(request, 'attachments:delete')
    if (!requester.ok) return requester.response
    const session = { user: { id: requester.userId } }

    const { fileId } = await context.params

    const existingFile = await prisma.secureFile.findUnique({
      where: { id: fileId },
    })

    if (!existingFile) {
      return NextResponse.json({ error: "File not found" }, { status: 404 })
    }

    if (existingFile.uploadedBy !== session.user.id) {
      return NextResponse.json({ error: "Only the file uploader can delete this file" }, { status: 403 })
    }

    if (existingFile.commentId) {
      return NextResponse.json({
        error: "This file is attached to a comment. Delete the comment instead."
      }, { status: 409 })
    }

    if (existingFile.attachTarget === 'list-image') {
      return NextResponse.json({
        error: "List images must be removed or replaced through list settings."
      }, { status: 409 })
    }

    // Drop the row first: an orphaned blob is a storage cost, whereas a row
    // pointing at a deleted blob is a broken attachment the user can see.
    const deleted = await prisma.secureFile.deleteMany({
      where: { id: fileId, listId: null, commentId: null },
    })
    if (deleted.count === 0) {
      return NextResponse.json({
        error: "This file became attached and can no longer be deleted."
      }, { status: 409 })
    }

    try {
      await deleteFile(existingFile.blobUrl)
    } catch (deleteError) {
      log.warn({ deleteError }, `⚠️ [SecureFiles] Row deleted but blob remains: ${existingFile.blobUrl}`)
    }

    log.info(`🗑️ [SecureFiles] Deleted file ${fileId}`)

    return NextResponse.json({ success: true })

  } catch (error) {
    log.error({ err: error }, "Error deleting secure file:")
    return NextResponse.json({ error: "Failed to delete file" }, { status: 500 })
  }
}
