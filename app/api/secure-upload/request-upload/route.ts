import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authConfig } from "@/lib/auth-config"
import { uploadFileToBlob } from "@/lib/secure-storage"
import { prisma } from "@/lib/prisma"
import { createLogger } from '@/lib/logger'

const log = createLogger('secure-upload.request-upload')


// Allowed MIME types for file uploads
const ALLOWED_MIME_TYPES = new Set([
  // Images
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/heic',
  'image/heif',
  // Videos
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-msvideo',
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
  'text/markdown',
  // Archives
  'application/zip',
  'application/x-zip-compressed',
  // Audio
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
])

// Maximum file size: 100MB
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
 * Validate file type on the server side
 * Checks both MIME type and extension match
 */
function validateFileType(file: File): { valid: boolean; error?: string } {
  // Check MIME type is allowed
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return {
      valid: false,
      error: `File type '${file.type}' is not allowed. Allowed types: images, videos, documents, and archives.`
    }
  }

  // Get file extension
  const fileName = file.name.toLowerCase()
  const lastDotIndex = fileName.lastIndexOf('.')
  if (lastDotIndex === -1) {
    return {
      valid: false,
      error: 'File must have an extension'
    }
  }

  const extension = fileName.slice(lastDotIndex)
  const allowedMimes = EXTENSION_MIME_MAP[extension]

  // If we have a mapping, validate MIME matches extension
  if (allowedMimes && !allowedMimes.includes(file.type)) {
    return {
      valid: false,
      error: `File extension '${extension}' does not match MIME type '${file.type}'`
    }
  }

  return { valid: true }
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
    const secureFile = await prisma.secureFile.create({
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
      }
    })

    return NextResponse.json({
      fileId: secureFile.id,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      success: true
    })

  } catch (error) {
    log.error({ err: error }, "Error generating upload URL:")
    return NextResponse.json({
      error: "Failed to generate upload URL"
    }, { status: 500 })
  }
}