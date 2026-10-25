import { NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { prisma } from "@/lib/prisma"
import { deleteFile } from "@/lib/secure-storage"
import type { RouteContextParams } from "@/types/next"
import { createLogger } from '@/lib/logger'

const log = createLogger('secure-files.[fileId].confirm-upload')


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
 * POST /api/secure-files/[fileId]/confirm-upload
 * Confirm that a direct upload to Vercel Blob completed
 * Updates the database with the new blob URL
 */
/** Whether `candidate` is a blob upload-url issued for this file (AWTD-1344). */
function isBlobIssuedFor(candidate: unknown, currentBlobUrl: string | null, uploaderId: string, fileId: string): boolean {
  if (typeof candidate !== 'string') return false
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  if (currentBlobUrl) {
    try {
      if (new URL(currentBlobUrl).host !== url.host) return false
    } catch {
      return false
    }
  }
  return url.pathname.startsWith(`/files/${uploaderId}/${fileId}-`)
}

export async function POST(request: NextRequest, context: RouteContextParams<{ fileId: string }>) {
  try {
    const session = await getSession(request)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { fileId } = await context.params
    const body = await request.json()
    const { blobUrl, mimeType, fileSize, oldBlobUrl } = body

    if (!blobUrl) {
      return NextResponse.json({ error: "blobUrl is required" }, { status: 400 })
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

    // The blob must be the one upload-url minted for THIS file: same store as
    // the file's current blob, pathname `files/<uploader>/<fileId>-…`
    // (upload-url/route.ts). Accepting any URL let an uploader point their
    // file at another user's blob and read it back through the signed
    // download (AWTD-1344).
    if (!isBlobIssuedFor(blobUrl, existingFile.blobUrl, session.user.id, fileId)) {
      return NextResponse.json({ error: "blobUrl is not the upload issued for this file" }, { status: 400 })
    }

    // Update database record with new blob URL
    const updatedFile = await prisma.secureFile.update({
      where: { id: fileId },
      data: {
        blobUrl: blobUrl,
        fileSize: fileSize || existingFile.fileSize,
        mimeType: mimeType || existingFile.mimeType,
        updatedAt: new Date(),
      }
    })

    // Delete the file's OWN previous blob (best effort). Never a URL from the
    // request: `oldBlobUrl` let the uploader of any file delete any blob
    // (AWTD-1344). It is still accepted from older clients, and ignored.
    void oldBlobUrl
    const urlToDelete = existingFile.blobUrl
    if (urlToDelete && urlToDelete !== blobUrl) {
      try {
        await deleteFile(urlToDelete)
        log.info(`🗑️ [SecureFiles] Deleted old blob: ${urlToDelete}`)
      } catch (deleteError) {
        log.warn({ deleteError }, `⚠️ [SecureFiles] Failed to delete old blob: ${urlToDelete}`)
      }
    }

    log.info(`✅ [SecureFiles] Confirmed upload for ${fileId}: ${blobUrl}`)

    return NextResponse.json({
      id: updatedFile.id,
      originalName: updatedFile.originalName,
      mimeType: updatedFile.mimeType,
      fileSize: updatedFile.fileSize,
      updatedAt: updatedFile.updatedAt,
      success: true
    })

  } catch (error) {
    log.error({ err: error }, "Error confirming upload:")
    return NextResponse.json({
      error: "Failed to confirm upload"
    }, { status: 500 })
  }
}
