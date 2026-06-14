import { type NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { RedisCache } from "@/lib/redis"
import { createLogger } from "@/lib/logger"
import { createProjectFromList } from "@/lib/projects-service"
import { requireProjectsBeta } from "@/lib/feature-flags"

const log = createLogger("api.projects.from-list")

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/projects/from-list — atomically create a project board from a list
 * (create project + attach the list in one transaction). Replaces the old
 * two-request client flow that could leave orphan projects. Body: { listId }.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getUnifiedSession(request)
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Projects is an opt-in Beta — only enrolled users can create boards.
    if (!(await requireProjectsBeta(session.user.id))) {
      return NextResponse.json(
        { error: "Projects is in beta. Enable it in Settings to create boards." },
        { status: 403 },
      )
    }

    const body = await request.json().catch(() => ({}))
    const listId = typeof body.listId === "string" ? body.listId : ""
    if (!listId) {
      return NextResponse.json({ error: "listId is required" }, { status: 400 })
    }

    const result = await createProjectFromList(session.user.id, listId)

    if ("error" in result) {
      switch (result.error) {
        case "list_not_found":
          return NextResponse.json({ error: "List not found" }, { status: 404 })
        case "forbidden":
          return NextResponse.json({ error: "You can only create a board from a list you own" }, { status: 403 })
        default:
          return NextResponse.json({ error: result.message }, { status: 400 })
      }
    }

    // The owner gains the new board's lists; refresh their cached list set.
    await RedisCache.del(RedisCache.keys.userLists(session.user.id)).catch((error) => {
      log.error({ err: error }, "Failed to invalidate userLists cache after board creation")
    })

    return NextResponse.json({ project: result.project, list: result.list }, { status: 201 })
  } catch (error) {
    log.error({ err: error }, "Error creating board from list:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
