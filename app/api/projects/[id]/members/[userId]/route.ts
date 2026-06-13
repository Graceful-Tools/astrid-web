import { type NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { RedisCache } from "@/lib/redis"
import type { RouteContextParams } from "@/types/next"
import { createLogger } from "@/lib/logger"
import { removeProjectMember, updateProjectMemberRole } from "@/lib/projects-service"

const log = createLogger("api.projects.id.members.userId")

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
 * PATCH /api/projects/:id/members/:userId — change a member's role. Owner-only
 * (promoting/demoting touches the admin grant). Body: { role: 'admin'|'member' }.
 */
export async function PATCH(
  request: NextRequest,
  context: RouteContextParams<{ id: string; userId: string }>,
) {
  try {
    const session = await getUnifiedSession(request)
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: projectId, userId: targetUserId } = await context.params
    const body = await request.json().catch(() => ({}))

    const result = await updateProjectMemberRole(projectId, session.user.id, targetUserId, body.role)

    if ("error" in result) {
      switch (result.error) {
        case "not_found":
          return NextResponse.json({ error: "Project not found" }, { status: 404 })
        case "forbidden":
          return NextResponse.json(
            { error: "Only the project owner can change member roles" },
            { status: 403 },
          )
        case "member_not_found":
          return NextResponse.json({ error: "Member not found" }, { status: 404 })
        default:
          return NextResponse.json({ error: result.message }, { status: 400 })
      }
    }

    await invalidateUserLists(result.userIdsToInvalidate)
    return NextResponse.json({ member: result.member })
  } catch (error) {
    log.error({ err: error }, "Error updating project member role:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * DELETE /api/projects/:id/members/:userId — remove a member. Owner + admins;
 * the owner can't be removed and admins can't remove other admins.
 */
export async function DELETE(
  request: NextRequest,
  context: RouteContextParams<{ id: string; userId: string }>,
) {
  try {
    const session = await getUnifiedSession(request)
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: projectId, userId: targetUserId } = await context.params

    const result = await removeProjectMember(projectId, session.user.id, targetUserId)

    if ("error" in result) {
      switch (result.error) {
        case "not_found":
          return NextResponse.json({ error: "Project not found" }, { status: 404 })
        case "forbidden":
          return NextResponse.json(
            { error: "You don't have permission to remove this member" },
            { status: 403 },
          )
        case "member_not_found":
          return NextResponse.json({ error: "Member not found" }, { status: 404 })
        default:
          return NextResponse.json({ error: result.message }, { status: 400 })
      }
    }

    await invalidateUserLists(result.userIdsToInvalidate)
    return NextResponse.json({ success: true, removedUserId: result.removedUserId })
  } catch (error) {
    log.error({ err: error }, "Error removing project member:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
