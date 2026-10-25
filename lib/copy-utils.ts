import type { Prisma, Task as TaskRow, Comment as CommentRow } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { createTasksInBulk, type BulkTaskInput } from "@/services/task-bulk-create"
import { getConsistentDefaultImage } from "@/lib/default-images"
import { getTaskCountInclude, getMultipleListTaskCounts } from "@/lib/task-count-utils"
import { canAccessList } from "@/lib/list-member-utils"
import type { TaskList, Task } from "@/types/task"
import { createLogger } from '@/lib/logger'

const log = createLogger('copy-utils')


export interface CopyTaskOptions {
  /** User ID who will own the copied task */
  newOwnerId: string
  /** List ID where the task should be copied to (optional) */
  targetListId?: string
  /** Whether to preserve the due date or clear it */
  preserveDueDate?: boolean
  /** Whether to preserve the assignee or assign to new owner */
  preserveAssignee?: boolean
  /** Whether to assign tasks to the new owner (false = unassigned) */
  assignToUser?: boolean
  /** Whether to copy comments from the original task */
  includeComments?: boolean
}

export interface CopyListOptions {
  /** User ID who will own the copied list */
  newOwnerId: string
  /** Whether to copy all tasks from the list */
  includeTasks?: boolean
  /** Whether to preserve task assignees or assign all to new owner */
  preserveTaskAssignees?: boolean
  /** Whether to assign tasks to the new owner (false = unassigned) */
  assignToUser?: boolean
  /** Custom name for the copied list (otherwise uses "Copy of [original name]") */
  newName?: string
  /** User name for creating proper naming format for public lists */
  newOwnerName?: string
}

type SourceTask = TaskRow & { comments: CommentRow[] }

export interface CopyTaskResult {
  success: boolean
  copiedTask?: Task
  error?: string
}

export interface CopyListResult {
  success: boolean
  copiedList?: TaskList & { tasks?: Task[] }
  copiedTasksCount?: number
  error?: string
}

/**
 * Copy a single task to a new owner/list
 */
export async function copyTask(
  taskId: string,
  options: CopyTaskOptions
): Promise<CopyTaskResult> {
  try {
    // Get the original task with all its data
    const originalTask = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        comments: true,
        attachments: true,
        lists: true
      }
    })

    if (!originalTask) {
      return {
        success: false,
        error: "Task not found"
      }
    }

    // Determine assignee based on whether copying to a list or My Tasks only
    let finalAssigneeId: string | null = null

    if (options.targetListId) {
      // Copying to a list: make task unassigned
      finalAssigneeId = null
    } else {
      // No target list specified (My Tasks only): assign to current user
      finalAssigneeId = options.newOwnerId
    }

    // Created through the bulk path (AWTD-1124) so the copy gets what a create
    // means — identifier, reminders, manual sort, live event — and history
    // goes in with it, original authors preserved.
    const { tasks, rejected } = await createTasksInBulk({
      actorId: options.newOwnerId,
      tasks: [copyInput(originalTask, {
        targetListId: options.targetListId,
        assigneeId: finalAssigneeId,
        preserveDueDate: options.preserveDueDate,
        includeComments: options.includeComments,
      })],
    })

    if (!tasks[0]) {
      return { success: false, error: rejected?.[0]?.error ?? "Failed to copy task" }
    }

    return {
      success: true,
      copiedTask: tasks[0] as any as Task
    }

  } catch (error) {
    log.error({ err: error }, "Error copying task:")
    return {
      success: false,
      error: "Failed to copy task"
    }
  }
}

/** A source task as a bulk-create row: what a copy keeps, and what it resets. */
function copyInput(
  originalTask: SourceTask,
  options: {
    targetListId?: string
    assigneeId: string | null
    preserveDueDate?: boolean
    includeComments?: boolean
  }
): BulkTaskInput {
  return {
    data: {
      title: originalTask.title, // No [copy] suffix
      description: originalTask.description,
      priority: originalTask.priority,
      repeating: originalTask.repeating,
      repeatingData: (originalTask.repeatingData ?? undefined) as Prisma.InputJsonValue | undefined,
      repeatFrom: originalTask.repeatFrom || 'COMPLETION_DATE', // Preserve repeat mode (default to COMPLETION_DATE)
      occurrenceCount: 0, // Reset occurrence count for new task copy
      isPrivate: false, // Copied tasks default to not private (user can change in their list)
      completed: false, // Always start as incomplete
      originalTaskId: originalTask.id, // Track the source
      dueDateTime: options.preserveDueDate ? originalTask.dueDateTime : null,
      assigneeId: options.assigneeId,
    },
    listIds: options.targetListId ? [options.targetListId] : [],
    // System comments (no author) are the source's own history, not the copy's.
    comments: options.includeComments
      ? originalTask.comments
          .filter(comment => comment.authorId !== null)
          .map(comment => ({ content: comment.content, authorId: comment.authorId }))
      : undefined,
  }
}

/**
 * Copy a list with all its tasks and settings
 */
export async function copyListWithTasks(
  listId: string,
  options: CopyListOptions
): Promise<CopyListResult> {
  try {
    // Increment copy count for the original list (only if it's PUBLIC)
    await prisma.taskList.updateMany({
      where: {
        id: listId,
        privacy: 'PUBLIC'
      },
      data: {
        copyCount: {
          increment: 1
        }
      }
    })

    // Get the original list with all its data
    const originalList = await prisma.taskList.findUnique({
      where: { id: listId },
      include: {
        tasks: {
          include: {
            comments: true,
            attachments: true
          }
        },
        owner: true,
        listMembers: true,
      }
    })

    if (!originalList) {
      return {
        success: false,
        error: "List not found"
      }
    }

    // Check if user has access to copy this list (public, owner, or shared member)
    if (!canAccessList(originalList, options.newOwnerId)) {
      return {
        success: false,
        error: "Access denied to copy this list"
      }
    }

    // Prepare the new list data
    const newListName = options.newName ||
      (originalList.privacy === "PUBLIC" && options.newOwnerName
        ? `${originalList.name} for ${options.newOwnerName}`
        : `Copy of ${originalList.name}`)

    const newListData: any = {
      name: newListName,
      description: originalList.description,
      color: originalList.color,
      privacy: "PRIVATE", // Copied lists are always private initially
      ownerId: options.newOwnerId,
      defaultAssigneeId: options.preserveTaskAssignees ? originalList.defaultAssigneeId :
                         (options.assignToUser !== false ? options.newOwnerId : null),
      defaultPriority: originalList.defaultPriority,
      defaultRepeating: originalList.defaultRepeating,
      defaultIsPrivate: originalList.defaultIsPrivate,
      defaultDueDate: originalList.defaultDueDate,
      defaultDueTime: originalList.defaultDueTime,
      // Copy filter settings
      filterCompletion: originalList.filterCompletion,
      filterDueDate: originalList.filterDueDate,
      filterAssignee: originalList.filterAssignee,
      filterAssignedBy: originalList.filterAssignedBy,
      filterRepeating: originalList.filterRepeating,
      filterInLists: originalList.filterInLists,
      filterPriority: originalList.filterPriority,
      sortBy: originalList.sortBy,
      // Don't copy virtual list settings or favorite status
      isVirtual: false,
      isFavorite: false,
      virtualListType: null
    }

    // Create the copied list
    const copiedList = await prisma.taskList.create({
      data: newListData,
      include: {
        owner: true,
        tasks: true
      }
    })

    // Assign consistent default image
    const consistentImage = getConsistentDefaultImage(copiedList.id)
    await prisma.taskList.update({
      where: { id: copiedList.id },
      data: { imageUrl: originalList.imageUrl || consistentImage.filename }
    })

    let copiedTasksCount = 0

    // Copy tasks if requested
    if (options.includeTasks && originalList.tasks.length > 0) {
      log.info(`📝 Copying ${originalList.tasks.length} tasks from original list`)

      // One batch, so the side effects are paid once rather than per task
      // (AWTD-1124). Copied into a list, a task starts unassigned — the rule
      // copyTask applies, whatever preserveTaskAssignees says.
      const { tasks, rejected } = await createTasksInBulk({
        actorId: options.newOwnerId,
        tasks: originalList.tasks.map(originalTask => copyInput(originalTask, {
          targetListId: copiedList.id,
          assigneeId: null,
          preserveDueDate: true,
        })),
      })
      copiedTasksCount = tasks.length
      for (const failure of rejected ?? []) {
        log.error(`❌ Failed to copy task: ${originalList.tasks[failure.index]?.title} - ${failure.error}`)
      }

      log.info(`📝 Total tasks copied: ${copiedTasksCount}`)
    } else {
      log.info(`📝 No tasks to copy (includeTasks: ${options.includeTasks}, task count: ${originalList.tasks.length})`)
    }

    // Fetch the final list with all its tasks and their list associations
    const finalList = await prisma.taskList.findUnique({
      where: { id: copiedList.id },
      include: {
        owner: true,
        tasks: {
          include: {
            lists: true,
            assignee: true,
            creator: true
          }
        },
        listMembers: {
          include: {
            user: true
          }
        }
      }
    })

    return {
      success: true,
      copiedList: finalList as any as TaskList,
      copiedTasksCount
    }

  } catch (error) {
    log.error({ err: error }, "Error copying list:")
    return {
      success: false,
      error: "Failed to copy list"
    }
  }
}

/**
 * Get popular public lists (most copied)
 */
export async function getPopularPublicLists(
  limit: number = 10,
  options?: { ownerId?: string | null }
) {
  try {
    const where: any = {
      privacy: "PUBLIC",
      isVirtual: false // Exclude virtual lists
    }

    if (options?.ownerId) {
      where.ownerId = options.ownerId
    }

    const publicLists = await prisma.taskList.findMany({
      where,
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        ...getTaskCountInclude({
          includePrivate: true, // Include all tasks for accurate list size representation
          includeCompleted: true,
          isPublicContext: false
        })
      },
      orderBy: [
        { copyCount: "desc" },
        { createdAt: "desc" }
      ],
      take: limit
    })

    // Get accurate task counts for all lists
    const listIds = publicLists.map(list => list.id)
    const accurateTaskCounts = await getMultipleListTaskCounts(listIds, {
      includePrivate: true,  // Include private tasks for accurate list size representation
      includeCompleted: false, // Only incomplete tasks for sidebar display
      isPublicContext: false  // Don't apply public context restrictions
    })

    // Update the _count.tasks with accurate counts
    const listsWithAccurateCounts = publicLists.map(list => ({
      ...list,
      _count: {
        ...list._count,
        tasks: accurateTaskCounts[list.id] || 0
      }
    }))

    return listsWithAccurateCounts
  } catch (error) {
    log.error({ err: error }, "Error fetching popular public lists:")
    return []
  }
}

/**
 * Get recent public lists
 */
export async function getRecentPublicLists(
  limit: number = 10,
  options?: { ownerId?: string | null }
) {
  try {
    const where: any = {
      privacy: "PUBLIC",
      isVirtual: false // Exclude virtual lists
    }

    if (options?.ownerId) {
      where.ownerId = options.ownerId
    }

    const publicLists = await prisma.taskList.findMany({
      where,
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        ...getTaskCountInclude({
          includePrivate: true, // Include all tasks for accurate list size representation
          includeCompleted: true,
          isPublicContext: false
        })
      },
      orderBy: { createdAt: "desc" },
      take: limit
    })

    // Get accurate task counts for all lists (incomplete only for display)
    const listIds = publicLists.map(list => list.id)
    const accurateTaskCounts = await getMultipleListTaskCounts(listIds, {
      includePrivate: true,  // Include private tasks for accurate list size representation
      includeCompleted: false, // Only incomplete tasks for sidebar display
      isPublicContext: false  // Don't apply public context restrictions
    })

    // Update the _count.tasks with accurate counts
    const listsWithAccurateCounts = publicLists.map(list => ({
      ...list,
      _count: {
        ...list._count,
        tasks: accurateTaskCounts[list.id] || 0
      }
    }))

    return listsWithAccurateCounts
  } catch (error) {
    log.error({ err: error }, "Error fetching recent public lists:")
    return []
  }
}

/**
 * Search public lists by name/description/creator
 */
export async function searchPublicLists(
  query: string,
  limit: number = 20,
  options?: { sortBy?: string | null, ownerId?: string | null }
) {
  try {
    const where: any = {
      privacy: "PUBLIC",
      isVirtual: false
    }

    // Add owner filter if provided
    if (options?.ownerId) {
      where.ownerId = options.ownerId
    }

    // Add search conditions
    where.OR = [
      {
        name: {
          contains: query,
          mode: "insensitive"
            }
          },
          {
            description: {
              contains: query,
              mode: "insensitive"
            }
          },
          {
            owner: {
              OR: [
                {
                  name: {
                    contains: query,
                    mode: "insensitive"
                  }
                },
                {
                  email: {
                    contains: query,
                    mode: "insensitive"
                  }
                }
              ]
            }
          }
        ]

    const publicLists = await prisma.taskList.findMany({
      where,
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        ...getTaskCountInclude({
          includePrivate: true, // Include all tasks for accurate list size representation
          includeCompleted: true,
          isPublicContext: false
        })
      },
      orderBy: options?.sortBy === 'copyCount'
        ? [{ copyCount: "desc" }, { createdAt: "desc" }]
        : [{ createdAt: "desc" }],
      take: limit
    })

    // Get accurate task counts for all lists
    const listIds = publicLists.map(list => list.id)
    const accurateTaskCounts = await getMultipleListTaskCounts(listIds, {
      includePrivate: true,  // Include private tasks for accurate list size representation
      includeCompleted: false, // Only incomplete tasks for sidebar display
      isPublicContext: false  // Don't apply public context restrictions
    })

    // Update the _count.tasks with accurate counts
    const listsWithAccurateCounts = publicLists.map(list => ({
      ...list,
      _count: {
        ...list._count,
        tasks: accurateTaskCounts[list.id] || 0
      }
    }))

    return listsWithAccurateCounts
  } catch (error) {
    log.error({ err: error }, "Error searching public lists:")
    return []
  }
}

/**
 * Get detailed preview of a public list including sample tasks
 */
export async function getPublicListPreview(listId: string) {
  try {
    const list = await prisma.taskList.findUnique({
      where: {
        id: listId,
        privacy: "PUBLIC"
      },
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        tasks: {
          take: 10, // Show first 10 tasks as preview
          orderBy: {
            createdAt: "asc"
          },
          select: {
            id: true,
            title: true,
            description: true,
            priority: true,
            completed: true,
            dueDateTime: true,
            createdAt: true
          }
        },
        ...getTaskCountInclude({
          includePrivate: true, // Include all tasks for accurate list size representation
          includeCompleted: true,
          isPublicContext: false
        })
      }
    })

    return list
  } catch (error) {
    log.error({ err: error }, "Error fetching public list preview:")
    return null
  }
}