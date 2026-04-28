import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authConfig } from "@/lib/auth-config"
import fs from 'fs/promises'
import path from 'path'
import { createLogger } from '@/lib/logger'

const log = createLogger('images.store')


export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authConfig)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { imageUrl } = await request.json()
    
    if (!imageUrl) {
      return NextResponse.json({ error: "Image URL is required" }, { status: 400 })
    }

    // Download the image
    log.info({ imageUrl }, 'Downloading image from:')
    const imageResponse = await fetch(imageUrl)
    if (!imageResponse.ok) {
      log.error({ statusText: imageResponse.statusText }, 'Failed to download image')
      return NextResponse.json({ error: "Failed to download image" }, { status: 500 })
    }

    const imageBuffer = await imageResponse.arrayBuffer()
    
    // Create a unique filename
    const timestamp = Date.now()
    const filename = `generated-${timestamp}.png`
    const uploadDir = path.join(process.cwd(), 'public', 'uploads')
    const filePath = path.join(uploadDir, filename)
    
    // Ensure upload directory exists
    await fs.mkdir(uploadDir, { recursive: true })
    
    // Write the file
    await fs.writeFile(filePath, Buffer.from(imageBuffer))
    
    const localUrl = `/uploads/${filename}`
    log.info({ localUrl }, 'Image stored locally at:')
    
    return NextResponse.json({ url: localUrl })
    
  } catch (error) {
    log.error({ err: error }, "Error storing image:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}