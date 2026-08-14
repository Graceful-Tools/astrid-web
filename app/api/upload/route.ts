import { type NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { put } from "@vercel/blob"
import { prisma } from "@/lib/prisma"
import { randomUUID } from "crypto"
import { validateUploadFile, MAX_DIRECT_UPLOAD_BYTES } from "@/lib/upload-validation"
import { createLogger } from '@/lib/logger'

const log = createLogger('upload')


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
    if (file.size > MAX_DIRECT_UPLOAD_BYTES) {
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
