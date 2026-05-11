import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getUnifiedSession } from "@/lib/session-utils"
import { DEFAULT_PROJECT_STATUSES } from "@/lib/project-status"
import { RedisCache } from "@/lib/redis"
import { createLogger } from "@/lib/logger"

const log = createLogger("api.projects")

const safeUserSelect = {
  id: true,
  name: true,
  email: true,
  image: true,
  isAIAgent: true,
} as const

export async function GET(request: NextRequest) {
  try {
    const session = await getUnifiedSession(request)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const projects = await prisma.project.findMany({
      where: {
        OR: [
          { ownerId: session.user.id },
          { members: { some: { userId: session.user.id } } },
        ],
      },
      include: {
        owner: { select: safeUserSelect },
        members: { include: { user: { select: safeUserSelect } } },
        lists: {
          include: {
            owner: { select: safeUserSelect },
            listMembers: { include: { user: { select: safeUserSelect } } },
          },
          orderBy: [
            { listType: "asc" },
            { statusOrder: "asc" },
            { createdAt: "asc" },
          ],
        },
      },
      orderBy: { createdAt: "desc" },
    })

    return NextResponse.json({ projects })
  } catch (error) {
    log.error({ err: error }, "Error fetching projects:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getUnifiedSession(request)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const data = await request.json()
    const name = typeof data.name === "string" ? data.name.trim() : ""

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 })
    }

    const project = await prisma.$transaction(async (tx) => {
      const createdProject = await tx.project.create({
        data: {
          name,
          description: data.description || null,
          color: data.color || "#3b82f6",
          imageUrl: data.imageUrl || null,
          ownerId: session.user.id,
          members: {
            create: {
              userId: session.user.id,
              role: "admin",
            },
          },
        },
      })

      await tx.taskList.createMany({
        data: DEFAULT_PROJECT_STATUSES.map((status) => ({
          name: status.name,
          description: status.description,
          color: data.color || "#3b82f6",
          privacy: "SHARED",
          ownerId: session.user.id,
          projectId: createdProject.id,
          listType: "status",
          statusRole: status.role,
          statusOrder: status.order,
          statusDescription: status.description,
          statusCompleted: false,
          imageUrl: null,
        })),
      })

      const statusLists = await tx.taskList.findMany({
        where: {
          projectId: createdProject.id,
          listType: "status",
        },
        select: { id: true },
      })

      await tx.listMember.createMany({
        data: statusLists.map((list) => ({
          listId: list.id,
          userId: session.user.id,
          role: "admin",
        })),
        skipDuplicates: true,
      })

      return tx.project.findUniqueOrThrow({
        where: { id: createdProject.id },
        include: {
          owner: { select: safeUserSelect },
          members: { include: { user: { select: safeUserSelect } } },
          lists: {
            include: {
              owner: { select: safeUserSelect },
              listMembers: { include: { user: { select: safeUserSelect } } },
            },
            orderBy: { statusOrder: "asc" },
          },
        },
      })
    })

    await RedisCache.del(RedisCache.keys.userLists(session.user.id)).catch((error) => {
      log.error({ err: error }, "Failed to invalidate list cache after project creation:")
    })

    return NextResponse.json(project)
  } catch (error) {
    log.error({ err: error }, "Error creating project:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
