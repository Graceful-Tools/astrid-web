import { brandListCaption } from './brand/copy'
import { prisma } from "./prisma"
import { getConsistentDefaultImage } from "./default-images"
import { toggleFavorite } from "./favorites"
import { createLogger } from '@/lib/logger'

const log = createLogger('default-lists')


/**
 * Creates default filter lists for a new user
 * Used by both OAuth signup (auth-config.ts) and credentials signup (signup/route.ts)
 */
export async function createDefaultListsForUser(userId: string) {
  try {
    log.info({ userId }, "[DefaultLists] Creating default lists for new user:")

    // Define the default lists with consistent images
    const defaultLists = [
      {
        name: "Today",
        description: "tasks due today",
        ownerId: userId,
        isVirtual: true,
        virtualListType: "today",
        defaultAssigneeId: userId,
        defaultDueDate: "today",
        filterCompletion: "default",
        filterDueDate: "today",
        filterAssignee: "current_user",
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
        defaultAssigneeId: userId,
        defaultDueDate: "none",
        filterCompletion: "default",
        filterDueDate: "all",
        filterAssignee: "current_user",
        filterPriority: "all",
        filterInLists: "not_in_list",
        sortBy: "auto",
        color: "#6b7280"
      },
      {
        name: "I've Assigned",
        description: "tasks you've assigned to others",
        ownerId: userId,
        isVirtual: true,
        virtualListType: "assigned",
        defaultAssigneeId: null,
        defaultDueDate: "none",
        filterCompletion: "default",
        filterDueDate: "all",
        filterAssignee: "not_current_user",
        filterAssignedBy: "current_user",
        filterPriority: "all",
        filterInLists: "dont_filter",
        sortBy: "auto",
        color: "#f59e0b"
      }
    ]

    // Create the lists and assign consistent images
    const createdLists = []
    for (const listData of defaultLists) {
      // A brand may caption its starter lists in its own voice. Applied here rather
      // than in the literals above so an override is per-field: a partner can rename
      // "I've Assigned" without also having to restate its description.
      // Task 97208a72.
      const caption = brandListCaption(listData.virtualListType)
      const list = await prisma.taskList.create({
        data: {
          ...listData,
          name: caption?.name?.trim() || listData.name,
          description: caption?.description?.trim() || listData.description,
        }
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
      log.info(`[DefaultLists] Created default list "${list.name}" with image ${consistentImage.filename}`)
    }

    log.info(`[DefaultLists] Successfully created ${createdLists.length} default lists for user ${userId}`)
    return createdLists

  } catch (error) {
    log.error({ userId: userId, error }, '[DefaultLists] Error creating default lists for user')
    // Don't fail the user creation process if default lists fail
    throw error
  }
}