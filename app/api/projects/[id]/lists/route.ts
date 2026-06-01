import { type NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { RedisCache } from "@/lib/redis"
import type { RouteContextParams } from "@/types/next"
import { createLogger } from "@/lib/logger"
import { attachListToProject } from "@/lib/projects-service"

const log = createLogger("api.projects.id.lists")

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Attach an existing regular list to this project (board sub-task #2).
 * Body: { listId }. Validated both ways in attachListToProject (user can see
 * the project AND owns the list).
 */
export async function POST(request: NextRequest, context: RouteContextParams<{ id: string }>) {
  try {
    const session = await getUnifiedSession(request)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: projectId } = await context.params
    const body = await request.json().catch(() => ({}))
    const listId = typeof body.listId === "string" ? body.listId : ""

    if (!listId) {
      return NextResponse.json({ error: "listId is required" }, { status: 400 })
    }

    const result = await attachListToProject(projectId, listId, session.user.id)

    if ("error" in result) {
      if (result.error === "project_not_found" || result.error === "list_not_found") {
        return NextResponse.json({ error: "Not found" }, { status: 404 })
      }
      if (result.error === "forbidden") {
        return NextResponse.json({ error: "You can only attach lists you own" }, { status: 403 })
      }
      return NextResponse.json({ error: result.message }, { status: 400 })
    }

    await Promise.all(
      Array.from(result.userIdsToInvalidate).map(async (userId) => {
        try {
          await RedisCache.del(RedisCache.keys.userLists(userId))
        } catch (error) {
          log.error({ err: error }, `Failed to invalidate cache for user ${userId}:`)
        }
      }),
    )

    return NextResponse.json({ list: result.list })
  } catch (error) {
    log.error({ err: error }, "Error attaching list to project:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
