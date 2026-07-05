import { getServerSession } from "next-auth"
import { NextRequest, NextResponse } from "next/server"
import { authConfig } from "@/lib/auth-config"
import { getConnectionsStatus } from "@/lib/sse-utils"
import { isAdmin } from "@/lib/admin-auth"
import { createLogger } from '@/lib/logger'

const log = createLogger('sse.health')


export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authConfig)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const connectionsStatus = getConnectionsStatus()
    const userConnection = connectionsStatus.connections.find(conn => conn.userId === session.user.id)
    // Only expose OTHER users' ids/connections to admins — leaking the full
    // active-user list to any authenticated caller is an info-disclosure.
    const admin = await isAdmin(session.user.id)

    return NextResponse.json({
      status: "SSE health check",
      timestamp: new Date().toISOString(),
      userId: session.user.id,
      userConnected: !!userConnection,
      userConnection: userConnection || null,
      totalConnections: connectionsStatus.total,
      ...(admin ? {
        activeUserIds: connectionsStatus.activeUserIds,
        allConnections: connectionsStatus.connections,
      } : {}),
    })
  } catch (error) {
    log.error({ err: error }, "Error getting SSE health status:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}