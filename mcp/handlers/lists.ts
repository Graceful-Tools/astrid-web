import { getUserRoleInList } from "../../lib/list-permissions"
import { mcpTokenLookup } from "../../lib/mcp-token"
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
 * MCP list-level read handlers — getSharedLists, getListTasks, getListMembers.
 *
 * All three are read-only and follow the same shape: validate the token
 * (read permission) → Prisma query → return MCP "content" envelope.
 *
 * Pulled out of mcp-server-v2.ts so the server class shrinks toward being
 * a router instead of a god class.
 */

const { validateAccessToken } = require("../access-token-validator")


/**
 * Return all lists this access token can reach.
 *
 * One token currently maps to one list, so the returned array always has
 * length 1 — but the contract is a list because the design space is for
 * multiple lists per token.
 */
async function getSharedLists(args: any) {
  const { accessToken } = args
  if (!accessToken) {
    throw new Error("Access token required")
  }

  const mcpToken = await prisma.mCPToken.findFirst({
    where: {
      token: { in: mcpTokenLookup(accessToken) },
      isActive: true,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
    include: {
      list: {
        include: {
          owner: { select: { id: true, name: true, email: true } },
          _count: { select: { tasks: true } },
        },
      },
    },
  })

  if (!mcpToken) {
    throw new Error("No accessible lists found")
  }

  // A user-level token has listId null, so `list` is null here. Reading through
  // it threw a TypeError, which was invisible while this module used an
  // untyped Prisma client (task 390bccc3).
  if (!mcpToken.list) {
    throw new Error(
      "This access token is not scoped to a list. Create a list-scoped MCP token, or pass listId explicitly.",
    )
  }

  const lists = [{
    id: mcpToken.list.id,
    name: mcpToken.list.name,
    description: mcpToken.list.description,
    color: mcpToken.list.color,
    privacy: mcpToken.list.privacy,
    owner: mcpToken.list.owner,
    taskCount: mcpToken.list._count.tasks,
    permissions: mcpToken.permissions,
    mcpAccessLevel:
      mcpToken.permissions.includes("admin") ? "BOTH" :
      mcpToken.permissions.includes("write") ? "BOTH" : "READ",
  }]

  return {
    content: [{ type: "text", text: JSON.stringify({ lists }) }],
  }
}

/**
 * Return tasks in a list. Defaults to incomplete only; pass
 * includeCompleted: true to include completed tasks. Embeds assignee,
 * creator, and the 3 most recent comments per task for context.
 */
async function getListTasks(args: any) {
  const { accessToken, listId, includeCompleted = false } = args

  await validateAccessToken(accessToken, listId, "read")

  const tasks = await prisma.task.findMany({
    where: {
      lists: { some: { id: listId } },
      ...(includeCompleted ? {} : { completed: false }),
    },
    include: {
      assignee: { select: { id: true, name: true, email: true } },
      creator: { select: { id: true, name: true, email: true } },
      comments: {
        include: { author: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: "desc" },
        take: 3, // recent only — full comment list is its own tool
      },
      _count: { select: { comments: true } },
    },
    orderBy: [
      { completed: "asc" },
      { priority: "desc" },
      { dueDateTime: "asc" },
      { createdAt: "desc" },
    ],
  })

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        listId,
        tasks: tasks.map((task: any) => ({
          id: task.id,
          title: task.title,
          description: task.description,
          priority: task.priority,
          completed: task.completed,
          dueDateTime: task.dueDateTime,
          reminderTime: task.reminderTime,
          reminderType: task.reminderType,
          isPrivate: task.isPrivate,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          assignee: task.assignee,
          creator: task.creator,
          commentCount: task._count.comments,
          recentComments: task.comments,
        })),
      }),
    }],
  }
}

/**
 * Return everyone who has access to a list, with their role.
 *
 * Combines two membership systems: the legacy `admins`/`members` arrays
 * and the newer `listMembers` join table. Owner always comes first, and
 * the new system shadows the legacy one when both have the same user.
 */
async function getListMembers(args: any) {
  const { accessToken, listId } = args

  await validateAccessToken(accessToken, listId, "read")

  const list = await prisma.taskList.findFirst({
    where: { id: listId },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      listMembers: {
        include: { user: { select: { id: true, name: true, email: true } } },
      },
    },
  })

  if (!list) {
    throw new Error("List not found")
  }

  const members: any[] = []
  members.push({ ...list.owner, role: "owner" })

  list.listMembers.forEach((membership) => {
    // Role comes from the canonical lookup rather than being re-derived here,
    // which also answers "is this the owner" without an inline comparison.
    const role = getUserRoleInList({ id: membership.user.id }, list as never)
    if (role === "owner") return
    members.push({ ...membership.user, role: role ?? "member" })
  })

  list.listMembers.forEach((listMember: any) => {
    // The new system shadows legacy entries — skip if already present
    if (!members.some(m => m.id === listMember.user.id)) {
      members.push({ ...listMember.user, role: listMember.role })
    }
  })

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        listId,
        listName: list.name,
        members,
        totalMembers: members.length,
      }),
    }],
  }
}

module.exports = { getSharedLists, getListTasks, getListMembers }
export {}
