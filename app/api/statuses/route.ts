import { type NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { RedisCache } from "@/lib/redis"
import { createLogger } from "@/lib/logger"
import { addUserStatus } from "@/lib/projects-service"
import { prisma } from "@/lib/prisma"

const log = createLogger("api.statuses")

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Add a custom board status column (board sub-task #5).
 *
 * Custom statuses belong to ONE board (task 109d8a91) — the reader,
 * `statusListsForUser`, keeps a custom role only when its `projectId` matches
 * the board being rendered. Only the three default roles are per-user
 * singletons that appear everywhere.
 *
 * The state is stored on `Project.customStates` (AWTD-562); the
 * `listType: 'status'` row is written alongside it only while the board still
 * renders columns from list rows. `state` is the durable half of the response
 * and `list` is the transitional one — new clients should read `state`.
 *
 * Body: { name, projectId }. Rename/reorder use PUT /api/lists/[id].
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getUnifiedSession(request)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const name = typeof body.name === "string" ? body.name : ""
    const projectId = typeof body.projectId === "string" ? body.projectId : ""

    if (!projectId) {
      return NextResponse.json({ error: "A status must belong to a board" }, { status: 400 })
    }

    // Authorize against the board the status is being added to, not merely
    // against being signed in: projectId arrives from the client. Mirrors the
    // owner check in app/api/projects/[id]/route.ts.
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true },
    })
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 })
    }
    if (project.ownerId !== session.user.id) {
      return NextResponse.json({ error: "Only the board owner can add a status" }, { status: 403 })
    }

    const result = await addUserStatus(session.user.id, name, projectId)

    if ("error" in result) {
      return NextResponse.json({ error: result.message }, { status: result.error === "duplicate" ? 409 : 400 })
    }

    try {
      await RedisCache.invalidate.userListsAllVersions(session.user.id)
    } catch (error) {
      log.error({ err: error }, "Failed to invalidate user lists cache")
    }

    return NextResponse.json({ list: result.list, state: result.state })
  } catch (error) {
    log.error({ err: error }, "Error adding custom status:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
