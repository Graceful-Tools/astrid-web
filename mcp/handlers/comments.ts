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
import { dispatchPostCommentSideEffects } from "../../lib/comments/post-comment-side-effects"
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

const { CreateCommentSchema } = require("../schemas")
const { validateAccessToken } = require("../access-token-validator")


async function addComment(args: any) {
  const { accessToken, listId, comment } = args

  const { userId } = await validateAccessToken(accessToken, listId, "write")

  const validatedComment = CreateCommentSchema.parse(comment)

  const existingTask = await prisma.task.findFirst({
    where: {
      id: validatedComment.taskId,
      lists: { some: { id: listId } },
    },
    include: {
      assignee: {
        select: { id: true, email: true, name: true, isAIAgent: true, aiAgentType: true },
      },
      lists: { select: { id: true, githubRepositoryId: true, aiAgentConfiguredBy: true } },
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
      author: { select: { id: true, name: true, email: true, isAIAgent: true } },
      task: { select: { id: true, title: true } },
    },
  })

  // Run the same side effects the web and v1 comment routes run. Creating the
  // row directly meant an @mention posted through MCP triggered no agent and
  // sent no push — the notification simply did not happen (task 390bccc3).
  await dispatchPostCommentSideEffects({
    comment: { id: newComment.id, content: newComment.content },
    task: {
      id: existingTask.id,
      title: existingTask.title,
      creatorId: existingTask.creatorId,
      assigneeId: existingTask.assigneeId,
      assignee: existingTask.assignee,
      lists: existingTask.lists,
    },
    commenter: {
      id: userId,
      name: newComment.author?.name,
      email: newComment.author?.email,
      isAIAgent: newComment.author?.isAIAgent ?? false,
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
