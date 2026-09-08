/**
 * Task CRUD operations for MCP API
 */

import { prisma } from "@/lib/prisma"
import {
  createTaskWithSideEffects,
  deleteTaskWithSideEffects,
  updateTaskWithSideEffects,
  type UpdateTaskIntent,
} from '@/services/task.service'
import { AnalyticsPlatform } from '@/lib/analytics-events'
import { broadcastToUsers } from "@/lib/sse-utils"
import { createLogger } from '@/lib/logger'
import { listVisibilityWhere } from '@/lib/list-permissions'
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
      // PUBLIC included: this lookup has always let anyone read a public list.
      ...listVisibilityWhere(mcpToken.userId, { includePublic: true })
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

  // Validate MCP token. With lists, the first one scopes the token check;
  // without, it is a user-level token.
  const mcpToken = listIds.length > 0
    ? await resolveMCPActor(accessToken, userId, listIds[0])
    : await resolveMCPActor(accessToken, userId)

  const result = await createTaskWithSideEffects({
    input: {
      ...taskData,
      listIds,
      // MCP's own default: a task an agent creates with no stated assignee
      // belongs to the agent. Every other surface falls through to the list's
      // default assignee instead. Kept as an INPUT here rather than a branch
      // inside the service — it is a choice this caller makes, not a fifth
      // rule about how tasks get assigned.
      assigneeId: 'assigneeId' in taskData ? taskData.assigneeId : mcpToken.userId,
    },
    actorId: mcpToken.userId,
    actorName: mcpToken.user?.name || mcpToken.user?.email || 'MCP Agent',
    platform: AnalyticsPlatform.API_OTHER,
  })

  // MCP surfaces signal failure by throwing; there is no status code to carry.
  if (!result.ok) {
    throw new Error(result.error)
  }

  const task = result.task as any

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
      identifier: task.identifier,  // AST-nnn for tasks in a project (epic 9dedd8aa)
      assigneeId: task.assigneeId,  // Add assigneeId for filtering
      assignee: task.assignee,
      creatorId: task.creatorId,    // Add creatorId for consistency
      creator: task.creator,
      createdAt: task.createdAt,
      lists: Array.isArray(task.lists) ? task.lists : [],  // Include list associations
      listIds: Array.isArray(task.lists) ? task.lists.map((l: any) => l.id) : []  // Include list IDs for convenience
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
        { creatorId: mcpToken.userId },
      ],
    },
    include: {
      lists: {
        select: {
          id: true,
          name: true,
          listType: true,
          privacy: true,
          publicListType: true,
          listMembers: { select: { userId: true, role: true } },
        },
      },
    },
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

  // The whole verb lives in the service now (epic 9dedd8aa). This was a raw
  // prisma.task.update: no completion stamp, no statusRole clearing (breaking
  // the schema invariant the board depends on), and no repeating roll-forward —
  // so completing one occurrence of a repeating task over MCP killed the
  // series, the same bug task fb94f2ee fixed for the agent PATCH.
  const intent: UpdateTaskIntent = {}
  if (updates.title) intent.title = updates.title
  if (updates.description !== undefined) intent.description = updates.description
  if (updates.priority !== undefined) intent.priority = updates.priority
  if (updates.completed !== undefined) intent.completed = updates.completed
  if (updates.dueDateTime !== undefined) intent.dueDateTime = updates.dueDateTime
  if (updates.assigneeId !== undefined) intent.assigneeId = updates.assigneeId
  if (updates.closedReason !== undefined) intent.closedReason = updates.closedReason
  if (updates.statusRole !== undefined) intent.statusRole = updates.statusRole

  const result = await updateTaskWithSideEffects({
    taskId,
    actorId: mcpToken.userId,
    actorName: mcpToken.user?.name || mcpToken.user?.email || 'MCP Agent',
    actorType: 'agent',
    platform: AnalyticsPlatform.API_OTHER,
    intent,
    existingTask: task,
    include: {
      assignee: { select: { id: true, name: true, email: true } },
      creator: { select: { id: true, name: true, email: true } },
      comments: { select: { id: true, authorId: true } },
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
    },
  })

  // MCP surfaces signal failure by throwing; there is no status code to carry.
  if (!result.ok) {
    throw new Error(result.error)
  }

  const updatedTask = result.task as any

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
      identifier: updatedTask.identifier,
      assigneeId: updatedTask.assigneeId,
      assignee: updatedTask.assignee,
      creatorId: updatedTask.creatorId,
      creator: updatedTask.creator,
      updatedAt: updatedTask.updatedAt,
      lists: Array.isArray(updatedTask.lists) ? updatedTask.lists : [],
      listIds: Array.isArray(updatedTask.lists) ? updatedTask.lists.map((l: any) => l.id) : []
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
            some: listVisibilityWhere(mcpToken.userId, { includePublic: false })
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

  // THIS SURFACE USED TO SKIP THE TOMBSTONE. It hard-deleted the row and
  // broadcast SSE, so a task deleted over MCP was invisible to every
  // delta-syncing client forever — iOS and Mac kept showing it until a full
  // refetch, because `updatedSince` had nothing to report for a row that no
  // longer existed (epic 9dedd8aa).
  await deleteTaskWithSideEffects({
    taskId,
    actorId: mcpToken.userId,
    actorName: mcpToken.user.name || mcpToken.user.email || 'MCP Agent',
  })

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
            some: listVisibilityWhere(mcpToken.userId, { includePublic: false })
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
        some: listVisibilityWhere(mcpToken.userId, { includePublic: false })
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
