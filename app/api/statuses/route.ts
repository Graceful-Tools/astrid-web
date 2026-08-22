import { type NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { RedisCache } from "@/lib/redis"
import { createLogger } from "@/lib/logger"
import { addUserStatus, renameUserStatus, reorderUserStatus, removeUserStatus } from "@/lib/projects-service"
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
 * The state is stored on `Project.customStates` (AWTD-562) and nowhere else.
 * Stage D (task b7b0c2f5) deleted the `listType: 'status'` rows this used to
 * write alongside it, so the response carries `state` only — the `list` half
 * is gone with the rows.
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

    return NextResponse.json({ state: result.state })
  } catch (error) {
    log.error({ err: error }, "Error adding custom status:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * Rename a board's custom status column.
 *
 * Body: { role, name, projectId }. The role is preserved across the rename —
 * tasks point at their column by `statusRole`, so minting a new one would
 * orphan every card in it.
 *
 * Only CUSTOM columns are renameable: the three defaults are config shared by
 * every board (task b7b0c2f5). `renameCustomState` reports those as not-found,
 * because they are not in `customStates` at all.
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await getUnifiedSession(request)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const role = typeof body.role === "string" ? body.role : ""
    const name = typeof body.name === "string" ? body.name : ""
    const projectId = typeof body.projectId === "string" ? body.projectId : ""

    if (!projectId) {
      return NextResponse.json({ error: "A status must belong to a board" }, { status: 400 })
    }
    if (!role) {
      return NextResponse.json({ error: "Which status to rename is required" }, { status: 400 })
    }

    // Same authorization as POST: projectId arrives from the client, so the
    // board is what gets checked, not merely being signed in.
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true },
    })
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 })
    }
    if (project.ownerId !== session.user.id) {
      return NextResponse.json({ error: "Only the board owner can rename a status" }, { status: 403 })
    }

    const result = await renameUserStatus(session.user.id, role, name, projectId)

    if ("error" in result) {
      const status = result.error === "duplicate" ? 409 : result.error === "not_found" ? 404 : 400
      return NextResponse.json({ error: result.message }, { status })
    }

    try {
      await RedisCache.invalidate.userListsAllVersions(session.user.id)
    } catch (error) {
      log.error({ err: error }, "Failed to invalidate user lists cache")
    }

    return NextResponse.json({ state: result.state })
  } catch (error) {
    log.error({ err: error }, "Error renaming custom status:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * Reorder a custom board-status column one slot up or down.
 *
 * Body: { role, direction: "up" | "down", projectId }
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await getUnifiedSession(request)
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const role = typeof body.role === "string" ? body.role : ""
    const direction = body.direction === "up" || body.direction === "down" ? body.direction : null
    const projectId = typeof body.projectId === "string" ? body.projectId : ""

    if (!projectId) {
      return NextResponse.json({ error: "A status must belong to a board" }, { status: 400 })
    }
    if (!role) {
      return NextResponse.json({ error: "Which status to move is required" }, { status: 400 })
    }
    if (!direction) {
      return NextResponse.json({ error: "direction must be 'up' or 'down'" }, { status: 400 })
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true },
    })
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 })
    }
    if (project.ownerId !== session.user.id) {
      return NextResponse.json({ error: "Only the board owner can reorder statuses" }, { status: 403 })
    }

    const result = await reorderUserStatus(session.user.id, role, direction, projectId)
    if ("error" in result) {
      const status = result.error === "not_found" ? 404 : 400
      return NextResponse.json({ error: result.message }, { status })
    }

    try {
      await RedisCache.invalidate.userListsAllVersions(session.user.id)
    } catch (error) {
      log.error({ err: error }, "Failed to invalidate user lists cache")
    }

    return NextResponse.json({ state: result.state })
  } catch (error) {
    log.error({ err: error }, "Error reordering status:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * Delete a custom board-status column.
 *
 * Body: { role, projectId }
 * Tasks in the column have their statusRole cleared (→ Inbox).
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await getUnifiedSession(request)
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const role = typeof body.role === "string" ? body.role : ""
    const projectId = typeof body.projectId === "string" ? body.projectId : ""

    if (!projectId) {
      return NextResponse.json({ error: "A status must belong to a board" }, { status: 400 })
    }
    if (!role) {
      return NextResponse.json({ error: "Which status to delete is required" }, { status: 400 })
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true },
    })
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 })
    }
    if (project.ownerId !== session.user.id) {
      return NextResponse.json({ error: "Only the board owner can delete a status" }, { status: 403 })
    }

    const result = await removeUserStatus(session.user.id, role, projectId)
    if ("error" in result) {
      const status = result.error === "not_found" ? 404 : 400
      return NextResponse.json({ error: result.message }, { status })
    }

    try {
      await RedisCache.invalidate.userListsAllVersions(session.user.id)
    } catch (error) {
      log.error({ err: error }, "Failed to invalidate user lists cache")
    }

    return NextResponse.json({ state: result.state })
  } catch (error) {
    log.error({ err: error }, "Error deleting status:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
