import { NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { createLogger } from '@/lib/logger'
import { RemoteImageError } from '@/lib/security/remote-image'
import { storeRemoteImageForUser } from '@/lib/images/store-remote-image'

const log = createLogger('images.store')


export async function POST(request: NextRequest) {
  try {
    const session = await getUnifiedSession()
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body: unknown = await request.json()
    const imageUrl =
      typeof body === 'object' && body !== null && 'imageUrl' in body
        ? (body as { imageUrl?: unknown }).imageUrl
        : undefined
    
    if (typeof imageUrl !== 'string' || !imageUrl.trim()) {
      return NextResponse.json({ error: "Image URL is required" }, { status: 400 })
    }

    const storedImage = await storeRemoteImageForUser(imageUrl, session.user.id)
    
    return NextResponse.json(storedImage)
    
  } catch (error) {
    if (error instanceof RemoteImageError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    log.error({ err: error }, "Error storing image:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}