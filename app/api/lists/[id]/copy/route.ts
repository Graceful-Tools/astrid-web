import { NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { copyListWithTasks } from "@/lib/copy-utils"
import type { RouteContextParams } from "@/types/next"
import { createLogger } from '@/lib/logger'

const log = createLogger('lists.[id].copy')


export async function POST(
  request: NextRequest,
  context: RouteContextParams<{ id: string }>
) {
  try {
    const session = await getUnifiedSession()

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      )
    }

    const { id: listId } = await context.params
    const body = await request.json()

    const {
      includeTasks = true,
      preserveTaskAssignees = false,
      assignToUser = true, // Default to assigning to user for backward compatibility
      newName
    } = body

    log.info(`📋 Copying list ${listId} for user ${session.user.id}, assignToUser: ${assignToUser}`)

    const result = await copyListWithTasks(listId, {
      newOwnerId: session.user.id,
      includeTasks,
      preserveTaskAssignees,
      assignToUser,
      newName,
      newOwnerName: session.user.name || session.user.email || undefined
    })

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Failed to copy list" },
        { status: 400 }
      )
    }

    log.info(`✅ List copied successfully: ${result.copiedList?.id}`)
    log.info(`📝 Copied ${result.copiedTasksCount} tasks`)

    return NextResponse.json({
      success: true,
      list: result.copiedList,
      copiedTasksCount: result.copiedTasksCount,
      message: `Successfully copied list${result.copiedTasksCount ? ` with ${result.copiedTasksCount} tasks` : ""}`
    })

  } catch (error) {
    log.error({ err: error }, "Error in copy list API:")
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
