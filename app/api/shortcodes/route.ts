import { BRAND } from '@/lib/brand/config'
import { NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { createShortcode, getShortcodesForTarget, buildShortcodeUrl } from "@/lib/shortcode"
import { prisma } from "@/lib/prisma"
import { createLogger } from '@/lib/logger'

const log = createLogger('shortcodes')


/**
 * POST /api/shortcodes
 * Create a new shortcode for a task or list
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getUnifiedSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Get base URL from request for localhost support
    const host = request.headers.get("host") || `${BRAND.domain}`
    const protocol = host.includes("localhost") ? "http" : "https"
    const baseUrl = `${protocol}://${host}`

    const body = await request.json()
    const { targetType, targetId, expiresAt } = body

    // Validate input
    if (!targetType || !targetId) {
      return NextResponse.json(
        { error: "targetType and targetId are required" },
        { status: 400 }
      )
    }

    if (targetType !== "task" && targetType !== "list") {
      return NextResponse.json(
        { error: "targetType must be 'task' or 'list'" },
        { status: 400 }
      )
    }

    // Verify access to target resource
    if (targetType === "task") {
      // Find task with its lists
      const task = await prisma.task.findUnique({
        where: { id: targetId },
        include: {
          lists: true
        }
      })

      if (!task) {
        return NextResponse.json({ error: "Task not found" }, { status: 404 })
      }

      // Check if user has access to this task
      // User has access if:
      // 1. They created the task
      // 2. They own any list containing the task
      // 3. They are a member of any list containing the task
      const isTaskCreator = task.creatorId === session.user.id

      if (!isTaskCreator) {
        const listIds = task.lists.map(list => list.id)

        const hasAccess = await prisma.taskList.findFirst({
          where: {
            id: { in: listIds },
            OR: [
              { ownerId: session.user.id },
              { listMembers: { some: { userId: session.user.id } } }
            ]
          }
        })

        if (!hasAccess) {
          return NextResponse.json(
            { error: "You don't have access to this task" },
            { status: 403 }
          )
        }
      }
    } else if (targetType === "list") {
      const list = await prisma.taskList.findFirst({
        where: {
          id: targetId,
          OR: [
            { ownerId: session.user.id },
            { listMembers: { some: { userId: session.user.id } } }
          ]
        }
      })

      if (!list) {
        return NextResponse.json({ error: "List not found or access denied" }, { status: 404 })
      }
    }

    // Create shortcode
    const shortcode = await createShortcode({
      targetType,
      targetId,
      userId: session.user.id,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined
    })

    return NextResponse.json({
      shortcode,
      url: buildShortcodeUrl(shortcode.code, baseUrl)
    })
  } catch (error) {
    log.error({ err: error }, "Error creating shortcode:")
    return NextResponse.json(
      { error: "Failed to create shortcode" },
      { status: 500 }
    )
  }
}

/**
 * GET /api/shortcodes?targetType=task&targetId=xxx
 * Get all shortcodes for a target
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getUnifiedSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Get base URL from request for localhost support
    const host = request.headers.get("host") || `${BRAND.domain}`
    const protocol = host.includes("localhost") ? "http" : "https"
    const baseUrl = `${protocol}://${host}`

    const { searchParams } = new URL(request.url)
    const targetType = searchParams.get("targetType")
    const targetId = searchParams.get("targetId")

    if (!targetType || !targetId) {
      return NextResponse.json(
        { error: "targetType and targetId are required" },
        { status: 400 }
      )
    }

    if (targetType !== "task" && targetType !== "list") {
      return NextResponse.json(
        { error: "targetType must be 'task' or 'list'" },
        { status: 400 }
      )
    }

    // Verify access to target resource
    if (targetType === "task") {
      // Find task with its lists
      const task = await prisma.task.findUnique({
        where: { id: targetId },
        include: {
          lists: true
        }
      })

      if (!task) {
        return NextResponse.json({ error: "Task not found" }, { status: 404 })
      }

      // Check if user has access to this task
      // User has access if:
      // 1. They created the task
      // 2. They own any list containing the task
      // 3. They are a member of any list containing the task
      const isTaskCreator = task.creatorId === session.user.id

      if (!isTaskCreator) {
        const listIds = task.lists.map(list => list.id)

        const hasAccess = await prisma.taskList.findFirst({
          where: {
            id: { in: listIds },
            OR: [
              { ownerId: session.user.id },
              { listMembers: { some: { userId: session.user.id } } }
            ]
          }
        })

        if (!hasAccess) {
          return NextResponse.json(
            { error: "You don't have access to this task" },
            { status: 403 }
          )
        }
      }
    } else if (targetType === "list") {
      const list = await prisma.taskList.findFirst({
        where: {
          id: targetId,
          OR: [
            { ownerId: session.user.id },
            { listMembers: { some: { userId: session.user.id } } }
          ]
        }
      })

      if (!list) {
        return NextResponse.json({ error: "List not found or access denied" }, { status: 404 })
      }
    }

    const shortcodes = await getShortcodesForTarget(
      targetType as "task" | "list",
      targetId
    )

    return NextResponse.json({
      shortcodes: shortcodes.map((sc) => ({
        ...sc,
        url: buildShortcodeUrl(sc.code, baseUrl)
      }))
    })
  } catch (error) {
    log.error({ err: error }, "Error fetching shortcodes:")
    return NextResponse.json(
      { error: "Failed to fetch shortcodes" },
      { status: 500 }
    )
  }
}
