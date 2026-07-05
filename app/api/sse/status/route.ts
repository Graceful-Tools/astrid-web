import { getServerSession } from "next-auth"
import { isAdmin } from "@/lib/admin-auth"
import { NextRequest, NextResponse } from "next/server"
import { authConfig } from "@/lib/auth-config"
import { createLogger } from '@/lib/logger'

const log = createLogger('sse.status')


export const dynamic = 'force-dynamic'

// Get connections from SSE utils
async function getConnections() {
  const sseUtils = await import("@/lib/sse-utils")
  // Access the connections map via a new export
  return sseUtils.getConnectionsStatus()
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authConfig)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const connectionsStatus = await getConnections()
    
    const admin = await isAdmin(session.user.id)
    return NextResponse.json({
      status: "SSE service running",
      timestamp: new Date().toISOString(),
      userId: session.user.id,
      // Full active-user list is admin-only (info-disclosure otherwise).
      ...(admin ? { activeConnections: connectionsStatus?.activeUserIds || [] } : {}),
      totalConnections: connectionsStatus?.total || 0
    })
  } catch (error) {
    log.error({ err: error }, "Error getting SSE status:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}