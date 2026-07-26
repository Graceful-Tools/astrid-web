import { canUserManageList } from "../../lib/list-permissions"
/**
 * MCP list-level read handlers — getSharedLists, getListTasks, getListMembers.
 *
 * All three are read-only and follow the same shape: validate the token
 * (read permission) → Prisma query → return MCP "content" envelope.
 *
 * Pulled out of mcp-server-v2.ts so the server class shrinks toward being
 * a router instead of a god class.
 */

const { PrismaClient } = require("@prisma/client")
const { validateAccessToken } = require("../access-token-validator")

const prisma = new PrismaClient()

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

  const mcpToken = await prisma.mcpToken.findFirst({
    where: {
      token: accessToken,
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
      admins: { select: { id: true, name: true, email: true } },
      members: { select: { id: true, name: true, email: true } },
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

  list.admins.forEach((admin: any) => {
    if (admin.id !== list.ownerId) {
      members.push({ ...admin, role: "admin" })
    }
  })

  list.members.forEach((member: any) => {
    // Anyone who is not owner/admin is a plain member. Asked via the canonical
    // role lookup rather than two inline checks (task e2803305).
    if (!canUserManageList({ id: member.id }, list as never)) {
      members.push({ ...member, role: "member" })
    }
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
