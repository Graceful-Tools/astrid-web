import { type NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { RedisCache } from "@/lib/redis"
import { createLogger } from "@/lib/logger"
import { addUserStatus } from "@/lib/projects-service"

const log = createLogger("api.statuses")

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Add a custom board status column (board sub-task #5). Status lists are
 * per-user globals, so the new column appears on every board the user has.
 * Body: { name }. Rename/reorder of existing statuses use PUT /api/lists/[id].
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getUnifiedSession(request)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const name = typeof body.name === "string" ? body.name : ""

    const result = await addUserStatus(session.user.id, name)

    if ("error" in result) {
      return NextResponse.json({ error: result.message }, { status: result.error === "duplicate" ? 409 : 400 })
    }

    try {
      await RedisCache.del(RedisCache.keys.userLists(session.user.id))
    } catch (error) {
      log.error({ err: error }, "Failed to invalidate user lists cache")
    }

    return NextResponse.json({ list: result.list })
  } catch (error) {
    log.error({ err: error }, "Error adding custom status:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
