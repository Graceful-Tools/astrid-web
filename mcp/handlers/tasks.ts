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

const { PrismaClient } = require("@prisma/client")
const {
  CreateTaskSchema,
  UpdateTaskSchema,
  CreateAttachmentSchema,
} = require("../schemas")
const { validateAccessToken } = require("../access-token-validator")
const { hasListAccess } = require("../list-access")

const prisma = new PrismaClient()

async function createTask(args: any) {
  const { accessToken, listId, task } = args

  const { userId, user, list } = await validateAccessToken(accessToken, listId, "write")

  const validatedTask = CreateTaskSchema.parse(task)

  // Defense in depth: even with a write-scoped token, refuse to create if
  // the user has lost list access since the token was minted.
  if (!hasListAccess(list, user.id)) {
    throw new Error("User no longer has permission to create tasks in this list")
  }

  const newTask = await prisma.task.create({
    data: {
      ...validatedTask,
      creatorId: userId,
      dueDateTime: validatedTask.dueDateTime ? new Date(validatedTask.dueDateTime) : null,
      reminderTime: validatedTask.reminderTime ? new Date(validatedTask.reminderTime) : null,
      lists: { connect: { id: listId } },
    },
    include: {
      assignee: { select: { id: true, name: true, email: true } },
      creator: { select: { id: true, name: true, email: true } },
      lists: { select: { id: true, name: true } },
    },
  })

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
          createdAt: newTask.createdAt,
          assignee: newTask.assignee,
          creator: newTask.creator,
          lists: newTask.lists,
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
  })

  if (!existingTask) {
    throw new Error("Task not found in the specified list")
  }

  const userCanEditTask =
    existingTask.creatorId === user.id ||
    existingTask.assigneeId === user.id ||
    list.ownerId === user.id ||
    list.admins.some((admin: any) => admin.id === user.id)

  if (!userCanEditTask) {
    throw new Error("User no longer has permission to edit this task")
  }

  const updatedTask = await prisma.task.update({
    where: { id: taskId },
    data: {
      ...updateData,
      dueDateTime: updateData.dueDateTime ? new Date(updateData.dueDateTime) : undefined,
      reminderTime: updateData.reminderTime ? new Date(updateData.reminderTime) : undefined,
    },
    include: {
      assignee: { select: { id: true, name: true, email: true } },
      creator: { select: { id: true, name: true, email: true } },
      lists: { select: { id: true, name: true } },
    },
  })

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
          updatedAt: updatedTask.updatedAt,
          assignee: updatedTask.assignee,
          creator: updatedTask.creator,
          lists: updatedTask.lists,
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
    list.ownerId === user.id ||
    list.admins.some((admin: any) => admin.id === user.id)

  if (!userCanDeleteTask) {
    throw new Error("User no longer has permission to delete this task")
  }

  await prisma.task.delete({ where: { id: taskId } })

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
