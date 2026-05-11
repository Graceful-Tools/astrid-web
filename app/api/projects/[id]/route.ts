import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getUnifiedSession } from "@/lib/session-utils"
import { RedisCache } from "@/lib/redis"
import type { RouteContextParams } from "@/types/next"
import { createLogger } from "@/lib/logger"

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
      include: {
        members: true,
        lists: { select: { id: true, listType: true, ownerId: true } },
      },
    })

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 })
    }

    const isOwner = project.ownerId === session.user.id
    if (!isOwner) {
      return NextResponse.json({ error: "Only the owner can delete a project" }, { status: 403 })
    }

    const domainListIds = project.lists
      .filter(list => list.listType !== "status")
      .map(list => list.id)
    const statusListIds = project.lists
      .filter(list => list.listType === "status")
      .map(list => list.id)
    const userIdsToInvalidate = new Set<string>([
      project.ownerId,
      ...project.members.map(member => member.userId),
    ])

    await prisma.$transaction(async (tx) => {
      // Detach domain lists so they survive the project deletion (cascade).
      if (domainListIds.length > 0) {
        await tx.taskList.updateMany({
          where: { id: { in: domainListIds } },
          data: { projectId: null },
        })
      }
      // Drop status-list memberships from any tasks before the cascade.
      if (statusListIds.length > 0) {
        await tx.task.updateMany({
          where: { lists: { some: { id: { in: statusListIds } } } },
          data: {},
        })
      }
      await tx.project.delete({ where: { id: projectId } })
    })

    await Promise.all(
      Array.from(userIdsToInvalidate).map(async (userId) => {
        try {
          await RedisCache.del(RedisCache.keys.userLists(userId))
        } catch (error) {
          log.error({ err: error }, `Failed to invalidate cache for user ${userId}:`)
        }
      })
    )

    return NextResponse.json({ success: true, detachedListIds: domainListIds })
  } catch (error) {
    log.error({ err: error }, "Error deleting project:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
