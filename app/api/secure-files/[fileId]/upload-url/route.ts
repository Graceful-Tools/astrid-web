import { NextRequest, NextResponse } from "next/server"
import { issuePresignedUpload, presignedUploadsEnabled } from "@/lib/secure-storage"
import { getUnifiedSession } from "@/lib/session-utils"
import { prisma } from "@/lib/prisma"
import type { RouteContextParams } from "@/types/next"
import { createLogger } from '@/lib/logger'

const log = createLogger('secure-files.[fileId].upload-url')


// Helper to get session from either JWT (web) or database (mobile)
async function getSession(request: NextRequest) {
  const jwtSession = await getUnifiedSession()
  if (jwtSession?.user?.id) {
    return { user: { id: jwtSession.user.id } }
  }

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

/**
 * POST /api/secure-files/[fileId]/upload-url
 * Get a pre-signed URL for direct upload to Vercel Blob
 * This bypasses the serverless function payload limit
 */
export async function POST(request: NextRequest, context: RouteContextParams<{ fileId: string }>) {
  try {
    const session = await getSession(request)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { fileId } = await context.params
    const body = await request.json()
    const { mimeType, fileSize } = body

    if (!mimeType) {
      return NextResponse.json({ error: "mimeType is required" }, { status: 400 })
    }

    // Validate file size (max 100MB)
    if (fileSize && fileSize > 100 * 1024 * 1024) {
      return NextResponse.json({ error: "File size cannot exceed 100MB" }, { status: 400 })
    }

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

    // Generate a unique pathname for the new blob
    const fileExtension = existingFile.originalName.split('.').pop() || 'bin'
    const timestamp = Date.now()
    const pathname = `files/${session.user.id}/${fileId}-${timestamp}.${fileExtension}`

    // Presigned only (AWTD-1368). The bearer client token went with the
    // Blob store's OIDC upgrade (AWTD-1386). Clients send `headers` as given.
    if (!presignedUploadsEnabled()) {
      log.error("Direct uploads need BLOB_WEBHOOK_PUBLIC_KEY (the Blob store's OIDC upgrade) or STORAGE_DRIVER")
      return NextResponse.json({ error: "Storage not configured" }, { status: 500 })
    }

    const presigned = await issuePresignedUpload({
      pathname,
      contentType: mimeType,
      maximumSizeInBytes: 100 * 1024 * 1024,
      allowedContentTypes: [mimeType],
    })

    return NextResponse.json({
      uploadUrl: presigned.uploadUrl,
      pathname,
      headers: { ...presigned.headers, "Content-Type": mimeType },
      method: "PUT",
      // Store these for the confirm step
      fileId,
      oldBlobUrl: existingFile.blobUrl,
    })

  } catch (error) {
    log.error({ err: error }, "Error generating upload URL:")
    return NextResponse.json({
      error: "Failed to generate upload URL"
    }, { status: 500 })
  }
}
