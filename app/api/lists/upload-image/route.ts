import { type NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { writeFile } from "fs/promises"
import { join } from "path"
import { randomBytes } from "crypto"
import { createLogger } from '@/lib/logger'
import { validateUploadFile, IMAGE_FILE_TYPES } from '@/lib/upload-validation'

const log = createLogger('lists.upload-image')


export async function POST(request: NextRequest) {
  try {
    const session = await getUnifiedSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get("file") as File | null

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    // Validate file extension and MIME type
    const validation = validateUploadFile(file, IMAGE_FILE_TYPES)
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