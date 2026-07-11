import { type NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { prisma } from "@/lib/prisma"
import type { CopyTaskData } from "@/types/api"
import { createLogger } from '@/lib/logger'

const log = createLogger('tasks.copy')


export async function POST(request: NextRequest) {
  try {
    const session = await getUnifiedSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const data: CopyTaskData = await request.json()

    // Validate required fields
    if (!data.taskId || !data.targetListIds?.length) {
      return NextResponse.json({ error: "Task ID and target list IDs are required" }, { status: 400 })
    }

    // Get the original task
    const originalTask = await prisma.task.findUnique({
      where: { id: data.taskId },
      include: {
        lists: true,
      },
    })

    if (!originalTask) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }

    // Check if the task is from a public list or user has access
    const isPublic = originalTask.lists.some((list) => list.privacy === "PUBLIC") && !originalTask.isPrivate

    if (!isPublic) {
      // Check if user has access to the original task
      const hasAccess =
        originalTask.assigneeId === session.user.id ||
        originalTask.creatorId === session.user.id ||
        originalTask.lists.some((list: any) =>
          list.ownerId === session.user.id ||
          list.listMembers?.some((lm: any) => lm.userId === session.user.id)
        )

      if (!hasAccess) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
    }

    // Verify user has access to target lists and get full list details
    const targetLists = await prisma.taskList.findMany({
      where: {
        id: { in: data.targetListIds },
        OR: [
          { ownerId: session.user.id },
          { listMembers: { some: { userId: session.user.id } } },
        ],
      },
      select: {
        id: true,
        name: true,
        ownerId: true,
        defaultAssigneeId: true,
      }
    })

    if (targetLists.length !== data.targetListIds.length) {
      return NextResponse.json({ error: "Access denied to one or more target lists" }, { status: 403 })
    }

    // Determine final assignee based on explicit assigneeId or target list default
    let finalAssigneeId: string | null = session.user.id // default fallback

    if (data.assigneeId !== undefined) {
      // Explicit assigneeId provided in request
      finalAssigneeId = data.assigneeId
    } else if (targetLists.length > 0) {
      // Check first target list's default assignee setting
      const firstList = targetLists[0]

      if (firstList.defaultAssigneeId !== undefined) {
        if (firstList.defaultAssigneeId === null) {
          // null = "task creator" (current user)
          finalAssigneeId = session.user.id
        } else if (firstList.defaultAssigneeId === "unassigned") {
          // "unassigned" = no assignee
          finalAssigneeId = null
        } else {
          // Specific user ID
          finalAssigneeId = firstList.defaultAssigneeId
        }
      }
      // If defaultAssigneeId is undefined (never set), leave as null (unassigned)
      else {
        finalAssigneeId = null
      }
    }

    // Create the copied task
    const copiedTask = await prisma.task.create({
      data: {
        title: originalTask.title,
        description: originalTask.description,
        priority: originalTask.priority,
        repeating: originalTask.repeating,
        isPrivate: originalTask.isPrivate,
        dueDateTime: originalTask.dueDateTime,
        isAllDay: originalTask.isAllDay,
        assigneeId: finalAssigneeId,
        creatorId: session.user.id,
        originalTaskId: originalTask.id,
        sourceListId: originalTask.lists[0]?.id,
        lists: {
          connect: data.targetListIds.map((id) => ({ id })),
        },
      },
      include: {
        assignee: true,
        creator: true,
        lists: {
          include: {
            owner: true,
          },
        },
        comments: {
          include: {
            author: true,
          },
        },
      },
    })

    return NextResponse.json(copiedTask)
  } catch (error) {
    log.error({ err: error }, "Error copying task:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
