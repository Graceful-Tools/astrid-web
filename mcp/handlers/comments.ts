/**
 * MCP comment handlers — addComment + getTaskComments.
 *
 * Both handlers share the same shape:
 *   1. Validate the MCP access token against the list and required permission
 *      (read for getTaskComments, write for addComment).
 *   2. Verify the target task exists and is in the requested list (defends
 *      against cross-list comment leakage).
 *   3. Do the Prisma operation and return the MCP "content" envelope.
 *
 * Pulled out of mcp-server-v2.ts so the server class can stop being a
 * grab-bag of method bodies — handler additions go into their own files
 * from now on.
 */

const { PrismaClient } = require("@prisma/client")
const { CreateCommentSchema } = require("../schemas")
const { validateAccessToken } = require("../access-token-validator")

const prisma = new PrismaClient()

async function addComment(args: any) {
  const { accessToken, listId, comment } = args

  const { userId } = await validateAccessToken(accessToken, listId, "write")

  const validatedComment = CreateCommentSchema.parse(comment)

  const existingTask = await prisma.task.findFirst({
    where: {
      id: validatedComment.taskId,
      lists: { some: { id: listId } },
    },
  })

  if (!existingTask) {
    throw new Error("Task not found in the specified list")
  }

  const newComment = await prisma.comment.create({
    data: {
      content: validatedComment.content,
      type: validatedComment.type,
      authorId: userId,
      taskId: validatedComment.taskId,
    },
    include: {
      author: { select: { id: true, name: true, email: true } },
      task: { select: { id: true, title: true } },
    },
  })

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          comment: {
            id: newComment.id,
            content: newComment.content,
            type: newComment.type,
            createdAt: newComment.createdAt,
            author: newComment.author,
            task: newComment.task,
          },
        }),
      },
    ],
  }
}

async function getTaskComments(args: any) {
  const { accessToken, listId, taskId } = args

  await validateAccessToken(accessToken, listId, "read")

  const existingTask = await prisma.task.findFirst({
    where: {
      id: taskId,
      lists: { some: { id: listId } },
    },
  })

  if (!existingTask) {
    throw new Error("Task not found in the specified list")
  }

  const comments = await prisma.comment.findMany({
    where: { taskId },
    include: {
      author: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "asc" },
  })

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          taskId,
          comments: comments.map((comment: any) => ({
            id: comment.id,
            content: comment.content,
            type: comment.type,
            createdAt: comment.createdAt,
            author: comment.author,
          })),
        }),
      },
    ],
  }
}

module.exports = { addComment, getTaskComments }
export {}
