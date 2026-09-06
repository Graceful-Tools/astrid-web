import { canUserManageList } from "../../lib/list-permissions"
import {
  createTaskWithSideEffects,
  deleteTaskWithSideEffects,
  updateTaskWithSideEffects,
} from '../../services/task.service'
/**
 * The SHARED client, not a new one.
 *
 * These modules each constructed their own PrismaClient, which bypassed the
 * `$extends` hook in lib/prisma.ts that watches for an assignee change and
 * dispatches the AI agent. So assigning a task to an agent through the MCP
 * server never started the agent — the single feature MCP exists to serve —
 * and each module also opened its own connection pool (task 390bccc3).
 */
import { prisma } from "../../lib/prisma"
/**
 * MCP task CRUD handlers — createTask, updateTask, deleteTask,
 * getTaskDetails, addTaskAttachment.
 *
 * Each handler validates the MCP access token + the user's actual
 * list/task access, runs the Prisma operation, and returns the MCP
 * "content" envelope. The "MCP never has more access than the user"
 * invariant is enforced inside each write handler — verifying the user's
 * current list role at execution time, not just when the token was
 * minted.
 */

const {
  CreateTaskSchema,
  UpdateTaskSchema,
  CreateAttachmentSchema,
} = require("../schemas")
const { validateAccessToken } = require("../access-token-validator")
const { hasListAccess } = require("../list-access")


async function createTask(args: any) {
  const { accessToken, listId, task } = args

  const { userId, user, list } = await validateAccessToken(accessToken, listId, "write")

  const validatedTask = CreateTaskSchema.parse(task)

  // Defense in depth: even with a write-scoped token, refuse to create if
  // the user has lost list access since the token was minted.
  if (!hasListAccess(list, user.id)) {
    throw new Error("User no longer has permission to create tasks in this list")
  }

  // Everything a create implies — identifier, idempotency, creation comment,
  // reminders, manual sort, SSE, cache — lives in the service (epic 9dedd8aa).
  // This handler did none of it, so a task created through the MCP server had
  // no AST-nnn identifier and never entered a manually-sorted list's order.
  const result = await createTaskWithSideEffects({
    input: { ...validatedTask, listIds: [listId] },
    actorId: userId,
    actorName: user.name || user.email || "MCP Agent",
    platform: "API-other",
  })

  if (!result.ok) {
    throw new Error(result.error)
  }

  const newTask = result.task as any

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        success: true,
        task: {
          id: newTask.id,
          title: newTask.title,
          description: newTask.description,
          priority: newTask.priority,
          completed: newTask.completed,
          dueDateTime: newTask.dueDateTime,
          reminderTime: newTask.reminderTime,
          reminderType: newTask.reminderType,
          isPrivate: newTask.isPrivate,
          identifier: newTask.identifier,
          createdAt: newTask.createdAt,
          assignee: newTask.assignee,
          creator: newTask.creator,
          lists: (newTask.lists ?? []).map((l: any) => ({ id: l.id, name: l.name })),
        },
      }),
    }],
  }
}

async function updateTask(args: any) {
  const { accessToken, listId, taskUpdate } = args

  const { user, list } = await validateAccessToken(accessToken, listId, "write")

  const validatedUpdate = UpdateTaskSchema.parse(taskUpdate)
  const { taskId, ...updateData } = validatedUpdate

  const existingTask = await prisma.task.findFirst({
    where: {
      id: taskId,
      lists: { some: { id: listId } },
    },
    include: {
      lists: {
        select: {
          id: true,
          name: true,
          listType: true,
          listMembers: { select: { userId: true, role: true } },
        },
      },
    },
  })

  if (!existingTask) {
    throw new Error("Task not found in the specified list")
  }

  const userCanEditTask =
    existingTask.creatorId === user.id ||
    existingTask.assigneeId === user.id ||
    canUserManageList({ id: user.id }, list as never)

  if (!userCanEditTask) {
    throw new Error("User no longer has permission to edit this task")
  }

  // Everything an update implies lives in the service (epic 9dedd8aa). This was
  // a raw prisma.task.update, so completing a task through the MCP server left
  // no completion stamp, kept its board status set, never rolled a repeating
  // series forward — killing it — and told nobody: no events, no notification,
  // no reminder rescheduling, no cache invalidation.
  const result = await updateTaskWithSideEffects({
    taskId,
    actorId: user.id,
    actorName: user.name || user.email || "MCP Agent",
    actorType: 'agent',
    platform: "API-other",
    intent: updateData,
    existingTask,
    include: {
      assignee: { select: { id: true, name: true, email: true } },
      creator: { select: { id: true, name: true, email: true } },
      comments: { select: { id: true, authorId: true } },
      lists: {
        select: {
          id: true,
          name: true,
          listMembers: { select: { userId: true, role: true } },
        },
      },
    },
  })

  if (!result.ok) {
    throw new Error(result.error)
  }

  const updatedTask = result.task as any

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        success: true,
        task: {
          id: updatedTask.id,
          title: updatedTask.title,
          description: updatedTask.description,
          priority: updatedTask.priority,
          completed: updatedTask.completed,
          dueDateTime: updatedTask.dueDateTime,
          reminderTime: updatedTask.reminderTime,
          reminderType: updatedTask.reminderType,
          isPrivate: updatedTask.isPrivate,
          identifier: updatedTask.identifier,
          updatedAt: updatedTask.updatedAt,
          assignee: updatedTask.assignee,
          creator: updatedTask.creator,
          lists: (updatedTask.lists ?? []).map((l: any) => ({ id: l.id, name: l.name })),
        },
      }),
    }],
  }
}

async function getTaskDetails(args: any) {
  const { accessToken, listId, taskId, includeComments = true, includeAttachments = true } = args

  await validateAccessToken(accessToken, listId, "read")

  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      lists: { some: { id: listId } },
    },
    include: {
      assignee: { select: { id: true, name: true, email: true } },
      creator: { select: { id: true, name: true, email: true } },
      lists: { select: { id: true, name: true } },
      comments: includeComments ? {
        include: { author: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: "asc" },
      } : false,
      attachments: includeAttachments,
      _count: { select: { comments: true, attachments: true } },
    },
  })

  if (!task) {
    throw new Error("Task not found in the specified list")
  }

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        task: {
          id: task.id,
          title: task.title,
          description: task.description,
          priority: task.priority,
          completed: task.completed,
          dueDateTime: task.dueDateTime,
          isAllDay: task.isAllDay,
          reminderTime: task.reminderTime,
          reminderType: task.reminderType,
          repeating: task.repeating,
          repeatingData: task.repeatingData,
          isPrivate: task.isPrivate,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          assignee: task.assignee,
          creator: task.creator,
          lists: task.lists,
          comments: includeComments ? task.comments : undefined,
          attachments: includeAttachments ? task.attachments : undefined,
          commentCount: task._count.comments,
          attachmentCount: task._count.attachments,
        },
      }),
    }],
  }
}

async function addTaskAttachment(args: any) {
  const { accessToken, listId, taskId, attachment } = args

  await validateAccessToken(accessToken, listId, "write")

  const validatedAttachment = CreateAttachmentSchema.parse(attachment)

  const existingTask = await prisma.task.findFirst({
    where: {
      id: taskId,
      lists: { some: { id: listId } },
    },
  })

  if (!existingTask) {
    throw new Error("Task not found in the specified list")
  }

  const newAttachment = await prisma.attachment.create({
    data: {
      name: validatedAttachment.name,
      url: validatedAttachment.url,
      type: validatedAttachment.type,
      size: validatedAttachment.size,
      taskId,
    },
  })

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        success: true,
        attachment: {
          id: newAttachment.id,
          name: newAttachment.name,
          url: newAttachment.url,
          type: newAttachment.type,
          size: newAttachment.size,
          createdAt: newAttachment.createdAt,
          taskId: newAttachment.taskId,
        },
      }),
    }],
  }
}

async function deleteTask(args: any) {
  const { accessToken, listId, taskId } = args

  const { user, list } = await validateAccessToken(accessToken, listId, "write")

  const existingTask = await prisma.task.findFirst({
    where: {
      id: taskId,
      lists: { some: { id: listId } },
    },
  })

  if (!existingTask) {
    throw new Error("Task not found in the specified list")
  }

  const userCanDeleteTask =
    existingTask.creatorId === user.id ||
    existingTask.assigneeId === user.id ||
    canUserManageList({ id: user.id }, list as never)

  if (!userCanDeleteTask) {
    throw new Error("User no longer has permission to delete this task")
  }

  // This surface also skipped the tombstone, so a task deleted here stayed on
  // delta-syncing clients forever (epic 9dedd8aa).
  await deleteTaskWithSideEffects({
    taskId,
    actorId: user.id,
    actorName: user.name || user.email || undefined,
  })

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        success: true,
        message: "Task deleted successfully",
        taskId,
      }),
    }],
  }
}

module.exports = {
  createTask,
  updateTask,
  getTaskDetails,
  addTaskAttachment,
  deleteTask,
}
export {}
