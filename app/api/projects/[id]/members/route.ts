import { type NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { RedisCache } from "@/lib/redis"
import type { RouteContextParams } from "@/types/next"
import { createLogger } from "@/lib/logger"
import { addProjectMember } from "@/lib/projects-service"

const log = createLogger("api.projects.id.members")

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Evict the cached list set for every user whose access just changed. */
async function invalidateUserLists(userIds: Iterable<string>) {
  await Promise.all(
    Array.from(userIds).map((userId) =>
      RedisCache.del(RedisCache.keys.userLists(userId)).catch((error) =>
        log.error({ err: error }, `Failed to invalidate cache for user ${userId}:`),
      ),
    ),
  )
}

/**
 * POST /api/projects/:id/members — add an existing user to the project (board
 * #3 write side). Owner + project admins may add members; only the owner may
 * grant the `admin` role. Body: { userId? , email? , role? }.
 */
export async function POST(request: NextRequest, context: RouteContextParams<{ id: string }>) {
  try {
    const session = await getUnifiedSession(request)
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: projectId } = await context.params
    const body = await request.json().catch(() => ({}))

    const result = await addProjectMember(projectId, session.user.id, {
      userId: typeof body.userId === "string" ? body.userId : undefined,
      email: typeof body.email === "string" ? body.email : undefined,
      role: body.role,
    })

    if ("error" in result) {
      switch (result.error) {
        case "not_found":
          return NextResponse.json({ error: "Project not found" }, { status: 404 })
        case "forbidden":
          return NextResponse.json(
            { error: "You don't have permission to add members with this role" },
            { status: 403 },
          )
        case "user_not_found":
          return NextResponse.json({ error: "No account found for that user" }, { status: 404 })
        default:
          return NextResponse.json({ error: result.message }, { status: 400 })
      }
    }

    await invalidateUserLists(result.userIdsToInvalidate)
    return NextResponse.json({ member: result.member }, { status: 201 })
  } catch (error) {
    log.error({ err: error }, "Error adding project member:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
