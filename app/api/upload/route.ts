import { type NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { put } from "@vercel/blob"
import { prisma } from "@/lib/prisma"
import { randomUUID } from "crypto"
import { createLogger } from '@/lib/logger'

const log = createLogger('upload')


// Allowed file extensions and their corresponding MIME types
const ALLOWED_FILE_TYPES: Record<string, string[]> = {
  // Images
  'jpg': ['image/jpeg'],
  'jpeg': ['image/jpeg'],
  'png': ['image/png'],
  'gif': ['image/gif'],
  'webp': ['image/webp'],
  // Documents
  'pdf': ['application/pdf'],
  'txt': ['text/plain'],
  'docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  'xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  'pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
}

const ALLOWED_EXTENSIONS = Object.keys(ALLOWED_FILE_TYPES)

function validateUploadFile(file: File): { valid: boolean; extension: string; error?: string } {
  // Get extension from filename (lowercase, no dots)
  const filenameParts = file.name.toLowerCase().split('.')
  const extension = filenameParts.length > 1 ? filenameParts.pop() || '' : ''

  // Check if extension is in whitelist
  if (!extension || !ALLOWED_EXTENSIONS.includes(extension)) {
    return {
      valid: false,
      extension: '',
      error: `File extension not allowed. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`
    }
  }

  // Check if MIME type matches the extension
  const allowedMimeTypes = ALLOWED_FILE_TYPES[extension]
  if (!allowedMimeTypes.includes(file.type)) {
    return {
      valid: false,
      extension: '',
      error: `File type mismatch. Expected ${allowedMimeTypes.join(' or ')} for .${extension} file`
    }
  }

  return { valid: true, extension }
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

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 })
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 400 })
    }

    // Validate file extension and MIME type
    const validation = validateUploadFile(file)
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    // Generate unique filename using validated extension
    const fileId = randomUUID()
    const pathname = `uploads/${session.user.id}/${fileId}.${validation.extension}`

    // Upload to Vercel Blob
    const blob = await put(pathname, file, {
      access: 'public',
      contentType: file.type,
    })

    return NextResponse.json({
      url: blob.url,
      name: file.name,
      size: file.size,
      type: file.type
    })

  } catch (error) {
    log.error({ err: error }, "Error uploading file:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
