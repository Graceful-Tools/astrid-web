import { type NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authConfig } from "@/lib/auth-config"
import { writeFile } from "fs/promises"
import { join } from "path"
import { randomBytes } from "crypto"
import { createLogger } from '@/lib/logger'

const log = createLogger('lists.upload-image')


// Allowed image extensions and their corresponding MIME types
const ALLOWED_IMAGE_TYPES: Record<string, string[]> = {
  'jpg': ['image/jpeg'],
  'jpeg': ['image/jpeg'],
  'png': ['image/png'],
  'gif': ['image/gif'],
  'webp': ['image/webp'],
}

const ALLOWED_EXTENSIONS = Object.keys(ALLOWED_IMAGE_TYPES)

function validateImageFile(file: File): { valid: boolean; extension: string; error?: string } {
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
  const allowedMimeTypes = ALLOWED_IMAGE_TYPES[extension]
  if (!allowedMimeTypes.includes(file.type)) {
    return {
      valid: false,
      extension: '',
      error: `File type mismatch. Expected ${allowedMimeTypes.join(' or ')} for .${extension} file`
    }
  }

  return { valid: true, extension }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authConfig)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get("file") as File | null

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    // Validate file extension and MIME type
    const validation = validateImageFile(file)
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    // Validate file size (max 5MB)
    const MAX_SIZE = 5 * 1024 * 1024
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "File size must be less than 5MB" }, { status: 400 })
    }

    // Generate unique filename using validated extension
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    const timestamp = Date.now()
    const randomSuffix = randomBytes(8).toString('hex')
    const filename = `${timestamp}-${randomSuffix}.${validation.extension}`
    
    // Save to public/uploads directory
    const uploadDir = join(process.cwd(), "public", "uploads")
    const filepath = join(uploadDir, filename)
    
    await writeFile(filepath, buffer)
    
    // Return the public URL
    const imageUrl = `/uploads/${filename}`
    
    return NextResponse.json({ 
      imageUrl,
      filename,
      originalName: file.name,
      size: file.size,
      type: file.type
    })
  } catch (error) {
    log.error({ err: error }, "Error uploading image:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}