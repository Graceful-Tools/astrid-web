import { NextRequest, NextResponse } from "next/server"
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client"
import { getServerSession } from "next-auth"
import { authConfig } from "@/lib/auth-config"
import { prisma } from "@/lib/prisma"
import type { RouteContextParams } from "@/types/next"
import { createLogger } from '@/lib/logger'

const log = createLogger('secure-files.[fileId].upload-url')


// Helper to get session from either JWT (web) or database (mobile)
async function getSession(request: NextRequest) {
  const jwtSession = await getServerSession(authConfig)
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

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      log.error("BLOB_READ_WRITE_TOKEN not configured")
      return NextResponse.json({ error: "Storage not configured" }, { status: 500 })
    }

    // SECURITY: never hand out the store-wide read/write token — mint a
    // client token scoped to this single pathname with size/type limits.
    // The previous implementation returned BLOB_READ_WRITE_TOKEN verbatim,
    // giving any authenticated user read/write/delete over every blob.
    const clientToken = await generateClientTokenFromReadWriteToken({
      token: process.env.BLOB_READ_WRITE_TOKEN,
      pathname,
      maximumSizeInBytes: 100 * 1024 * 1024,
      allowedContentTypes: [mimeType],
    })

    const uploadUrl = `https://blob.vercel-storage.com/${pathname}`

    return NextResponse.json({
      uploadUrl,
      pathname,
      headers: {
        "Authorization": `Bearer ${clientToken}`,
        "x-api-version": "7",
        "Content-Type": mimeType,
        "x-content-type": mimeType,
      },
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
