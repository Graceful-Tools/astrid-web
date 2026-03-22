import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authConfig } from "@/lib/auth-config"
import { generateSignedDownloadUrl, uploadFileToBlob, deleteFile } from "@/lib/secure-storage"
import { prisma } from "@/lib/prisma"
import { hasListAccess } from "@/lib/list-member-utils"
import type { RouteContextParams } from "@/types/next"

// Helper function to safely check list access with any list-like object
function canAccessList(list: any, userId: string): boolean {
  try {
    return hasListAccess(list as any, userId)
  } catch {
    // Fallback to manual check if type casting fails
    if (list.ownerId === userId) return true
    if (list.listMembers?.some((member: any) => member.userId === userId)) return true
    return false
  }
}

// Helper to get session from either JWT (web) or database (mobile)
async function getSession(request: NextRequest) {
  // Try JWT session first (web app)
  const jwtSession = await getServerSession(authConfig)
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

export async function GET(request: NextRequest, context: RouteContextParams<{ fileId: string }>) {
  try {
    const session = await getSession(request)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

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
        task.lists.some((list) => canAccessList(list, session.user.id)) ||
        // Allow viewing files on public lists (both copy-only and collaborative)
        task.lists.some((list) => list.privacy === 'PUBLIC')

      if (canView) {
        hasAccess = true
      }
    }

    if (!hasAccess && secureFile.listId && secureFile.list) {
      // Check list access using standard hasListAccess function
      if (canAccessList(secureFile.list, session.user.id) || secureFile.list.privacy === 'PUBLIC') {
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
          task.lists.some((list) => canAccessList(list, session.user.id)) ||
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
        if (list.ownerId === session.user.id) {
          hasAccess = true
        } else if (list.listMembers?.some((m: any) => m.userId === session.user.id)) {
          hasAccess = true
        } else if (list.privacy === 'PUBLIC') {
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
    console.error("Error serving secure file:", error)
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
    const session = await getSession(request)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

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
      console.log(`🗑️ [SecureFiles] Deleted old blob: ${oldBlobUrl}`)
    } catch (deleteError) {
      console.warn(`⚠️ [SecureFiles] Failed to delete old blob: ${oldBlobUrl}`, deleteError)
    }

    console.log(`✅ [SecureFiles] Updated file ${fileId}: ${oldBlobUrl} -> ${newBlobUrl}`)

    return NextResponse.json({
      id: updatedFile.id,
      originalName: updatedFile.originalName,
      mimeType: updatedFile.mimeType,
      fileSize: updatedFile.fileSize,
      updatedAt: updatedFile.updatedAt,
      success: true
    })

  } catch (error) {
    console.error("Error updating secure file:", error)
    return NextResponse.json({
      error: "Failed to update file"
    }, { status: 500 })
  }
}
