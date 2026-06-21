import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authConfig } from "@/lib/auth-config"
import { prisma } from "@/lib/prisma"
import { randomUUID } from "crypto"
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client"
import { createLogger } from '@/lib/logger'

const log = createLogger('secure-upload.get-upload-url')


// Helper to get session from either JWT (web) or database (mobile)
async function getSession(request: NextRequest) {
  // Try JWT session first (web app)
  const jwtSession = await getServerSession(authConfig)
  if (jwtSession?.user?.id) {
    return { user: { id: jwtSession.user.id } }
  }

  // Try database session (mobile app)
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

// Allowed file types for upload
const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/webm',
  'video/x-matroska',
  'application/pdf',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip'
]

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
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { fileName, fileType, fileSize, context } = body

    // Validate required fields
    if (!fileName || !fileType || !fileSize || !context) {
      return NextResponse.json({
        error: "Missing required fields: fileName, fileType, fileSize, context"
      }, { status: 400 })
    }

    // Validate file type
    if (!ALLOWED_TYPES.includes(fileType)) {
      return NextResponse.json({
        error: `File type ${fileType} is not allowed`
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
      const { canAccessChatChannel } = await import('@/lib/chat-access')
      const hasAccess = await canAccessChatChannel(context.channelId, session.user.id)
      if (!hasAccess) {
        return NextResponse.json({
          error: "Chat channel not found or access denied"
        }, { status: 404 })
      }
    }

    // Generate file ID and path
    const fileId = randomUUID()
    const fileExtension = fileName.split('.').pop() || ''
    const pathname = `files/${session.user.id}/${fileId}.${fileExtension}`

    // Determine callback URL for upload completion
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXTAUTH_URL || 'https://astrid.cc'
    const callbackUrl = `${baseUrl}/api/secure-upload/upload-complete`

    // Generate client token for direct upload to Vercel Blob
    const clientToken = await generateClientTokenFromReadWriteToken({
      token: process.env.BLOB_READ_WRITE_TOKEN!,
      pathname,
      onUploadCompleted: {
        callbackUrl,
        tokenPayload: JSON.stringify({
          userId: session.user.id,
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
      allowedContentTypes: ALLOWED_TYPES,
    })

    return NextResponse.json({
      uploadToken: clientToken,
      pathname,
      fileId,
      // For iOS: use PUT to https://blob.vercel-storage.com/{pathname}
      // with header "x-vercel-blob-client-token: {uploadToken}"
      uploadUrl: `https://blob.vercel-storage.com/${pathname}`,
    })

  } catch (error) {
    log.error({ err: error }, "Error generating upload URL:")
    return NextResponse.json({
      error: "Failed to generate upload URL"
    }, { status: 500 })
  }
}
