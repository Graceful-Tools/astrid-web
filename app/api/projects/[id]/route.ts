import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getUnifiedSession } from "@/lib/session-utils"
import { RedisCache } from "@/lib/redis"
import type { RouteContextParams } from "@/types/next"
import { createLogger } from "@/lib/logger"
import { deleteProjectAndDetachLists } from "@/lib/projects-service"

const log = createLogger("api.projects.id")

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function DELETE(request: NextRequest, context: RouteContextParams<{ id: string }>) {
  try {
    const session = await getUnifiedSession(request)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: projectId } = await context.params

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true },
    })

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 })
    }

    if (project.ownerId !== session.user.id) {
      return NextResponse.json({ error: "Only the owner can delete a project" }, { status: 403 })
    }

    const result = await deleteProjectAndDetachLists(projectId)
    if (!result) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 })
    }

    await Promise.all(
      Array.from(result.userIdsToInvalidate).map(async (userId) => {
        try {
          await RedisCache.invalidate.userListsAllVersions(userId)
        } catch (error) {
          log.error({ err: error }, `Failed to invalidate cache for user ${userId}:`)
        }
      }),
    )

    return NextResponse.json({ success: true, detachedListIds: result.detachedListIds })
  } catch (error) {
    log.error({ err: error }, "Error deleting project:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
