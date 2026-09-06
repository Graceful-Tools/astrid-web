/**
 * Task CRUD operations for MCP API
 */

import { prisma } from "@/lib/prisma"
import { broadcastToUsers } from "@/lib/sse-utils"
import { createLogger } from '@/lib/logger'
import {
  resolveMCPActor,
  getListMemberIdsByListId,
  redactArgsForLogging,
  maskToken
} from "./shared"

const log = createLogger('mcp.task-operations')

export async function getListTasks(accessToken: string, listId: string, userId: string, includeCompleted = false) {
  const mcpToken = await resolveMCPActor(accessToken, userId, listId)

  // Verify access to this specific list (token-level permissions control access)
  const list = await prisma.taskList.findFirst({
    where: {
      id: listId,
      OR: [
        { ownerId: mcpToken.userId },
        { listMembers: { some: { userId: mcpToken.userId } } },
        { listMembers: { some: { userId: mcpToken.userId } } },
        { listMembers: { some: { userId: mcpToken.userId } } },
        { privacy: 'PUBLIC' }  // Allow access to PUBLIC lists for anyone
      ]
    }
  })

  if (!list) {
    throw new Error('List not found or access denied')
  }

  const tasks = await prisma.task.findMany({
    where: {
      lists: { some: { id: listId } },
      ...(includeCompleted ? {} : { completed: false })
    },
    include: {
      assignee: {
        select: { id: true, name: true, email: true }
      },
      creator: {
        select: { id: true, name: true, email: true }
      },
      lists: {
        select: {
          id: true,
          name: true,
          color: true,
          privacy: true,
          listMembers: {
            include: {
              user: { select: { id: true, name: true, email: true } }
            }
          }
        }
      },
      _count: {
        select: { comments: true }
      }
    },
    orderBy: { createdAt: 'desc' }
  })

  return {
    listId,
    tasks: tasks.map(task => ({
      id: task.id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      completed: task.completed,
      isPrivate: task.isPrivate,
      dueDateTime: task.dueDateTime,
      assigneeId: task.assigneeId,  // Add assigneeId for filtering
      assignee: task.assignee,
      creatorId: task.creatorId,    // Add creatorId for consistency
      creator: task.creator,
      lists: task.lists,  // Include full list objects for iOS task row display
      listIds: Array.isArray(task.lists) ? task.lists.map(l => l.id) : [],
      commentCount: task._count.comments,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    }))
  }
}

export async function getUserTasks(accessToken: string, userId: string, includeCompleted = true) {
  // Validate MCP token (user-level access)
  const mcpToken = await resolveMCPActor(accessToken, userId)

  // Get ALL tasks where the user is the assignee
  const tasks = await prisma.task.findMany({
    where: {
      assigneeId: mcpToken.userId,
      ...(includeCompleted ? {} : { completed: false })
    },
    include: {
      assignee: {
        select: { id: true, name: true, email: true }
      },
      creator: {
        select: { id: true, name: true, email: true }
      },
      lists: {
        select: {
          id: true,
          name: true,
          color: true,
          privacy: true,
          listMembers: {
            include: {
              user: { select: { id: true, name: true, email: true } }
            }
          }
        }
      },
      _count: {
        select: { comments: true }
      }
    },
    orderBy: { createdAt: 'desc' }
  })

  return {
    tasks: tasks.map(task => ({
      id: task.id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      assignee: task.assignee,
      assigneeId: task.assigneeId,  // Add assigneeId for iOS filtering
      creatorId: task.creatorId,
      creator: task.creator,
      lists: task.lists,
      listIds: Array.isArray(task.lists) ? task.lists.map(l => l.id) : [],
      dueDateTime: task.dueDateTime,
      isAllDay: task.isAllDay,
      completed: task.completed,
      isPrivate: task.isPrivate,
      repeating: task.repeating,
      repeatingData: task.repeatingData,
      reminderTime: task.reminderTime,
      reminderSent: task.reminderSent,
      reminderType: task.reminderType,
      commentCount: task._count.comments,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    }))
  }
}

export async function createTask(accessToken: string, listIds: string[], taskData: any, userId: string) {
  log.info({ args: redactArgsForLogging({ accessToken, listIds, taskData }) }, 'MCP [createTask] args')
  log.info({ listIds }, 'MCP [createTask] Extracted listIds:')

  // Validate MCP token
  // If listIds provided, use first list for validation, otherwise use user-level token
  const mcpToken = listIds.length > 0
    ? await resolveMCPActor(accessToken, userId, listIds[0])
    : await resolveMCPActor(accessToken, userId)

  // Verify write access to all specified lists (if any)
  let validLists: any[] = []
  if (listIds.length > 0) {
    validLists = await prisma.taskList.findMany({
      where: {
        id: { in: listIds },
        OR: [
          { ownerId: mcpToken.userId },
          { listMembers: { some: { userId: mcpToken.userId } } },
          // Allow creating tasks in collaborative public lists (anyone can add)
          {
            privacy: 'PUBLIC',
            publicListType: 'collaborative'
          }
        ]
      }
    })

    if (validLists.length === 0) {
      throw new Error('No accessible lists found or write access denied')
    }

    if (validLists.length !== listIds.length) {
      const missingListIds = listIds.filter(id => !validLists.some(list => list.id === id))
      throw new Error(`Access denied or lists not found: ${missingListIds.join(', ')}`)
    }
  }

  // Determine assigneeId before creating task
  const finalAssigneeId = 'assigneeId' in taskData ? taskData.assigneeId : mcpToken.userId

  const task = await prisma.task.create({
    data: {
      title: taskData.title,
      description: taskData.description || '',
      // Use nullish coalescing to allow priority 0 (none)
      // taskData.priority || 1 would fail because 0 is falsy in JavaScript
      priority: taskData.priority ?? 0,
      // Use explicit check to allow null (unassigned) while defaulting to current user if not provided
      assigneeId: finalAssigneeId,
      creatorId: mcpToken.userId,
      // Handle 'dueDateTime' (modern date+time field)
      dueDateTime: taskData.dueDateTime ? new Date(taskData.dueDateTime) : null,
      isAllDay: taskData.isAllDay ?? false,
      isPrivate: taskData.isPrivate || false,
      ...(listIds.length > 0 && {
        lists: {
          connect: listIds.map(id => ({ id }))
        }
      })
    },
    include: {
      assignee: {
        select: { id: true, name: true, email: true }
      },
      creator: {
        select: { id: true, name: true, email: true }
      },
      lists: {
        select: {
          id: true,
          name: true,
          color: true,
          privacy: true,
          listMembers: {
            include: {
              user: { select: { id: true, name: true, email: true } }
            }
          }
        }
      }
    }
  })

  // Broadcast SSE event for real-time updates
  try {
    const userIds = new Set<string>()

    // Get all members from all lists this task belongs to
    for (const listId of listIds) {
      const listMemberIds = await getListMemberIdsByListId(listId)
      listMemberIds.forEach(id => userIds.add(id))
    }

    // Add assignee if different from creator
    if (task.assigneeId && task.assigneeId !== mcpToken.userId) {
      userIds.add(task.assigneeId)
    }

    // Remove the creator (MCP user) from notifications
    userIds.delete(mcpToken.userId)

    if (userIds.size > 0) {
      log.info(`[MCP SSE] Broadcasting task_created to ${userIds.size} users`)
      broadcastToUsers(Array.from(userIds), {
        type: 'task_created',
        timestamp: new Date().toISOString(),
        data: {
          taskId: task.id,
          taskTitle: task.title,
          taskPriority: task.priority,
          creatorName: mcpToken.user.name || mcpToken.user.email || "MCP Agent",
          userId: mcpToken.userId,
          listNames: Array.isArray(task.lists) ? task.lists.map(list => list.name) : [],
          task: {
            id: task.id,
            title: task.title,
            description: task.description,
            priority: task.priority,
            completed: task.completed,
            dueDateTime: task.dueDateTime,
            isAllDay: task.isAllDay,
            assignee: task.assignee,
            creator: task.creator,
            createdAt: task.createdAt
          }
        }
      })
    }
  } catch (error) {
    log.error({ err: error }, '[MCP SSE] Failed to broadcast task_created:')
    // Don't fail the operation if SSE fails
  }

  return {
    success: true,
    task: {
      id: task.id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      completed: task.completed,
      isPrivate: task.isPrivate,
      dueDateTime: task.dueDateTime,
      isAllDay: task.isAllDay,
      assigneeId: task.assigneeId,  // Add assigneeId for filtering
      assignee: task.assignee,
      creatorId: task.creatorId,    // Add creatorId for consistency
      creator: task.creator,
      createdAt: task.createdAt,
      lists: Array.isArray(task.lists) ? task.lists : [],  // Include list associations
      listIds: Array.isArray(task.lists) ? task.lists.map(l => l.id) : []  // Include list IDs for convenience
    }
  }
}

export async function updateTask(accessToken: string, taskId: string, updates: any, userId: string) {
  const mcpToken = await resolveMCPActor(accessToken, userId)

  // Find task and verify access
  // Allow access if:
  // 1) task is in a list user has access to (owner/member)
  // 2) user is the creator (for listless tasks)
  // 3) task is in a collaborative public list AND user is the creator
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      OR: [
        {
          lists: {
            some: {
              OR: [
                { ownerId: mcpToken.userId },
                { listMembers: { some: { userId: mcpToken.userId } } },
                // Collaborative public lists: task creator can edit their own tasks
                {
                  privacy: 'PUBLIC',
                  publicListType: 'collaborative'
                }
              ]
            }
          }
        },
        {
          creatorId: mcpToken.userId
        }
      ]
    },
    include: {
      lists: {
        select: {
          privacy: true,
          publicListType: true
        }
      }
    }
  })

  if (!task) {
    throw new Error('Task not found or access denied')
  }

  // For collaborative public lists, verify user is the task creator
  const inCollaborativePublicList = task.lists.some(
    list => list.privacy === 'PUBLIC' && list.publicListType === 'collaborative'
  )
  if (inCollaborativePublicList && task.creatorId !== mcpToken.userId) {
    throw new Error('Access denied: can only edit your own tasks in collaborative lists')
  }

  const updatedTask = await prisma.task.update({
    where: { id: taskId },
    data: {
      ...(updates.title && { title: updates.title }),
      ...(updates.description !== undefined && { description: updates.description }),
      ...(updates.priority !== undefined && { priority: updates.priority }),
      ...(updates.completed !== undefined && { completed: updates.completed }),
      ...(updates.dueDateTime !== undefined && {
        dueDateTime: updates.dueDateTime ? new Date(updates.dueDateTime) : null,
        when: updates.dueDateTime ? new Date(updates.dueDateTime) : null // Legacy field - populate with same value for backward compatibility
      }),
      ...(updates.assigneeId !== undefined && { assigneeId: updates.assigneeId })
    },
    include: {
      assignee: {
        select: { id: true, name: true, email: true }
      },
      creator: {
        select: { id: true, name: true, email: true }
      },
      lists: {
        select: {
          id: true,
          name: true,
          color: true,
          privacy: true,
          listMembers: {
            include: {
              user: { select: { id: true, name: true, email: true } }
            }
          }
        }
      }
    }
  })

  // Broadcast SSE event for real-time updates
  try {
    const userIds = new Set<string>()

    // Get all members from all lists this task belongs to
    for (const list of updatedTask.lists) {
      const listMemberIds = await getListMemberIdsByListId(list.id)
      listMemberIds.forEach(id => userIds.add(id))
    }

    // Add assignee if different from updater
    if (updatedTask.assigneeId && updatedTask.assigneeId !== mcpToken.userId) {
      userIds.add(updatedTask.assigneeId)
    }

    // Remove the updater (MCP user) from notifications
    userIds.delete(mcpToken.userId)

    if (userIds.size > 0) {
      log.info(`[MCP SSE] Broadcasting task_updated to ${userIds.size} users`)
      broadcastToUsers(Array.from(userIds), {
        type: 'task_updated',
        timestamp: new Date().toISOString(),
        data: {
          taskId: updatedTask.id,
          taskTitle: updatedTask.title,
          taskPriority: updatedTask.priority,
          taskCompleted: updatedTask.completed,
          updaterName: mcpToken.user.name || mcpToken.user.email || "MCP Agent",
          userId: mcpToken.userId,
          listNames: Array.isArray(updatedTask.lists) ? updatedTask.lists.map(list => list.name) : [],
          task: {
            id: updatedTask.id,
            title: updatedTask.title,
            description: updatedTask.description,
            priority: updatedTask.priority,
            completed: updatedTask.completed,
            dueDateTime: updatedTask.dueDateTime,
            isAllDay: updatedTask.isAllDay,
            assignee: updatedTask.assignee,
            creator: updatedTask.creator,
            updatedAt: updatedTask.updatedAt
          }
        }
      })
    }
  } catch (error) {
    log.error({ err: error }, '[MCP SSE] Failed to broadcast task_updated:')
    // Don't fail the operation if SSE fails
  }

  return {
    success: true,
    task: {
      id: updatedTask.id,
      title: updatedTask.title,
      description: updatedTask.description,
      priority: updatedTask.priority,
      completed: updatedTask.completed,
      isPrivate: updatedTask.isPrivate,
      dueDateTime: updatedTask.dueDateTime,
      isAllDay: updatedTask.isAllDay,
      assigneeId: updatedTask.assigneeId,  // Add assigneeId for filtering
      assignee: updatedTask.assignee,
      creatorId: updatedTask.creatorId,    // Add creatorId for consistency
      creator: updatedTask.creator,
      listIds: Array.isArray(updatedTask.lists) ? updatedTask.lists.map(l => l.id) : [],
      lists: Array.isArray(updatedTask.lists) ? updatedTask.lists : [],
      createdAt: updatedTask.createdAt,
      updatedAt: updatedTask.updatedAt
    }
  }
}

export async function deleteTask(accessToken: string, taskId: string, userId: string) {
  const mcpToken = await resolveMCPActor(accessToken, userId)

  log.info(`[MCP deleteTask] Attempting to delete task ${taskId} for user ${mcpToken.userId}`)

  // First, check if task exists at all
  const taskExists = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      lists: {
        select: { id: true, name: true, ownerId: true }
      }
    }
  })

  if (!taskExists) {
    log.info(`[MCP deleteTask] Task ${taskId} not found in database`)
    throw new Error('Task not found')
  }

  log.info(`[MCP deleteTask] Task found. Lists: ${JSON.stringify(taskExists.lists)}`)
  log.info(`[MCP deleteTask] MCP token userId: ${mcpToken.userId}`)

  // Verify task access and write permission
  // User can delete if they are: (1) task creator, OR (2) member of a list containing the task
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      OR: [
        // Creator can always delete their own tasks
        { creatorId: mcpToken.userId },
        // OR member of a list containing the task
        {
          lists: {
            some: {
              OR: [
                { ownerId: mcpToken.userId },
                { listMembers: { some: { userId: mcpToken.userId } } },
                { listMembers: { some: { userId: mcpToken.userId } } },
                { listMembers: { some: { userId: mcpToken.userId } } }
              ]
            }
          }
        }
      ]
    },
    include: {
      lists: {
        select: {
          id: true,
          name: true,
          color: true,
          privacy: true,
          listMembers: {
            include: {
              user: { select: { id: true, name: true, email: true } }
            }
          }
        }
      }
    }
  })

  if (!task) {
    log.info(`[MCP deleteTask] Access denied for user ${mcpToken.userId} to task ${taskId}`)
    throw new Error('Task not found or access denied')
  }

  log.info(`[MCP deleteTask] Access granted. Deleting task ${taskId}`)

  // Get relevant users before deletion for SSE broadcast
  const userIds = new Set<string>()

  try {
    // Get all members from all lists this task belongs to
    for (const list of task.lists) {
      const listMemberIds = await getListMemberIdsByListId(list.id)
      listMemberIds.forEach(id => userIds.add(id))
    }

    // Add task assignee and creator
    if (task.assigneeId) userIds.add(task.assigneeId)
    if (task.creatorId) userIds.add(task.creatorId)

    // Remove the deleter (MCP user) from notifications
    userIds.delete(mcpToken.userId)
  } catch (error) {
    log.error({ err: error }, '[MCP SSE] Failed to gather user IDs for task deletion broadcast:')
  }

  await prisma.task.delete({
    where: { id: taskId }
  })

  // Broadcast SSE event for real-time updates
  try {
    if (userIds.size > 0) {
      log.info(`[MCP SSE] Broadcasting task_deleted to ${userIds.size} users`)
      broadcastToUsers(Array.from(userIds), {
        type: 'task_deleted',
        timestamp: new Date().toISOString(),
        data: {
          taskId: task.id,
          taskTitle: task.title,
          deleterName: mcpToken.user.name || mcpToken.user.email || "MCP Agent",
          userId: mcpToken.userId,
          listNames: Array.isArray(task.lists) ? task.lists.map(list => list.name) : []
        }
      })
    }
  } catch (error) {
    log.error({ err: error }, '[MCP SSE] Failed to broadcast task_deleted:')
    // Don't fail the operation if SSE fails
  }

  return {
    success: true,
    message: 'Task deleted successfully'
  }
}

export async function getTaskDetails(accessToken: string, taskId: string, userId: string) {
  const mcpToken = await resolveMCPActor(accessToken, userId)

  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      OR: [
        {
          lists: {
            some: {
              OR: [
                { ownerId: mcpToken.userId },
                { listMembers: { some: { userId: mcpToken.userId } } },
                { listMembers: { some: { userId: mcpToken.userId } } },
                { listMembers: { some: { userId: mcpToken.userId } } }
              ]
            }
          }
        },
        {
          creatorId: mcpToken.userId
        },
        {
          // Allow access to tasks in PUBLIC lists
          lists: {
            some: {
              privacy: 'PUBLIC'
            }
          }
        }
      ]
    },
    include: {
      assignee: {
        select: { id: true, name: true, email: true }
      },
      creator: {
        select: { id: true, name: true, email: true }
      },
      lists: {
        select: {
          id: true,
          name: true,
          color: true,
          privacy: true,
          listMembers: {
            include: {
              user: { select: { id: true, name: true, email: true } }
            }
          }
        }
      },
      comments: {
        include: {
          author: {
            select: { id: true, name: true, email: true }
          }
        },
        orderBy: { createdAt: 'asc' }
      }
    }
  })

  if (!task) {
    throw new Error('Task not found or access denied')
  }

  return {
    task: {
      id: task.id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      completed: task.completed,
      isPrivate: task.isPrivate,
      dueDateTime: task.dueDateTime,
      assigneeId: task.assigneeId,  // Add assigneeId for filtering
      assignee: task.assignee,
      creatorId: task.creatorId,    // Add creatorId for consistency
      creator: task.creator,
      listIds: Array.isArray(task.lists) ? task.lists.map(l => l.id) : [],
      lists: task.lists,
      comments: task.comments,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    }
  }
}

export async function addTaskAttachment(accessToken: string, taskId: string, attachmentData: any, userId: string) {
  const mcpToken = await resolveMCPActor(accessToken, userId)

  // Verify task access and write permission
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      lists: {
        some: {
                  OR: [
            { ownerId: mcpToken.userId },
            { listMembers: { some: { userId: mcpToken.userId } } },
            { listMembers: { some: { userId: mcpToken.userId } } },
            { listMembers: { some: { userId: mcpToken.userId } } }
          ]
        }
      }
    }
  })

  if (!task) {
    throw new Error('Task not found or access denied')
  }

  const attachment = await prisma.attachment.create({
    data: {
      name: attachmentData.name,
      url: attachmentData.url,
      type: attachmentData.type || 'file',
      size: attachmentData.size || 0,
      taskId
    }
  })

  return {
    success: true,
    attachment: {
      id: attachment.id,
      name: attachment.name,
      url: attachment.url,
      type: attachment.type,
      size: attachment.size,
      createdAt: attachment.createdAt
    }
  }
}
