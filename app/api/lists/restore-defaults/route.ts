import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authConfig } from "@/lib/auth-config"
import { prisma } from "@/lib/prisma"
import { getConsistentDefaultImage } from "@/lib/default-images"
import { toggleFavorite } from "@/lib/favorites"
import { createLogger } from '@/lib/logger'

const log = createLogger('lists.restore-defaults')


export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authConfig)
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      )
    }

    const userId = session.user.id

    // First, remove existing default saved filters for this user
    // Delete by virtualListType AND by name to prevent duplicates
    const defaultNames = ["Today", "Not in a List", "I've Assigned"]
    await prisma.taskList.deleteMany({
      where: {
        ownerId: userId,
        isVirtual: true,
        OR: [
          { virtualListType: { in: ["today", "not-in-list", "assigned"] } },
          { name: { in: defaultNames } }
        ]
      }
    })

    // Create the default saved filter lists based on README specs
    const defaultLists = [
      {
        name: "Today",
        description: "tasks due today",
        ownerId: userId,
        isVirtual: true,
        virtualListType: "today",
        defaultAssigneeId: userId, // Task Creator = current user
        defaultDueDate: "today",
        filterCompletion: "default",
        filterDueDate: "today",
        filterAssignee: "current_user", // Show tasks assigned to me
        filterPriority: "all",
        filterInLists: "dont_filter",
        sortBy: "auto",
        color: "#3b82f6"
      },
      {
        name: "Not in a List",
        description: "tasks without a list",
        ownerId: userId,
        isVirtual: true,
        virtualListType: "not-in-list",
        defaultAssigneeId: userId, // current user
        defaultDueDate: "none",
        filterCompletion: "default",
        filterDueDate: "all",
        filterAssignee: "current_user",
        filterPriority: "all",
        filterInLists: "not_in_list", // Show tasks that are NOT in any list
        sortBy: "auto",
        color: "#6b7280"
      },
      {
        name: "I've Assigned",
        description: "tasks you've assigned to others",
        ownerId: userId,
        isVirtual: true,
        virtualListType: "assigned",
        defaultAssigneeId: null, // unassigned
        defaultDueDate: "none",
        filterCompletion: "default",
        filterDueDate: "all",
        filterAssignee: "not_current_user", // Show tasks NOT assigned to me
        filterAssignedBy: "current_user", // Show tasks assigned BY me
        filterPriority: "all",
        filterInLists: "dont_filter",
        sortBy: "auto",
        color: "#f59e0b"
      }
      // Note: "Public Lists" filter removed - it showed ALL public tasks on the platform
      // which wasn't useful for personal task management
    ]

    // Create the default lists, assign images, and favorite them for the user
    const createdLists = []
    for (const listData of defaultLists) {
      const list = await prisma.taskList.create({
        data: listData
      })

      // Assign consistent default image based on list ID
      const consistentImage = getConsistentDefaultImage(list.id)
      await prisma.taskList.update({
        where: { id: list.id },
        data: { imageUrl: consistentImage.filename }
      })

      // Favorite this default list for the user
      await toggleFavorite(userId, list.id, true)

      createdLists.push(list)
      log.info(`[RestoreDefaults] Created list "${list.name}" with image ${consistentImage.filename}`)
    }

    return NextResponse.json({
      success: true,
      message: "Default saved filters restored successfully",
      count: createdLists.length
    })

  } catch (error) {
    log.error({ err: error }, "Error restoring default lists:")
    return NextResponse.json(
      { error: "Failed to restore default saved filters" },
      { status: 500 }
    )
  }
}