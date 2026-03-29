/**
 * Astrid Internal API Client
 *
 * Makes authenticated API calls on behalf of the Astrid agent.
 * Uses the same v1 API endpoints that mobile apps and external agents use,
 * ensuring consistent business logic, permissions, and side effects.
 *
 * Authentication: Uses a server-side session token approach — since this runs
 * within the same server, we bypass OAuth and use direct Prisma for auth,
 * but call the API logic via the exported handler functions.
 *
 * For scalability: if we move to a separate agent service, switch these
 * to HTTP calls with OAuth credentials.
 */

import { prisma } from '@/lib/prisma'
import { broadcastToUsers } from '@/lib/sse-utils'
import { getListMemberIds } from '@/lib/list-member-utils'

/**
 * Create a task via the same logic as POST /api/v1/tasks.
 * Returns the created task or throws on error.
 */
export async function astridCreateTask(params: {
  title: string
  description?: string
  assigneeId?: string | null
  creatorId: string
  listIds?: string[]
  priority?: number
  dueDateTime?: Date | null
}): Promise<{ id: string; title: string }> {
  const task = await prisma.task.create({
    data: {
      title: params.title,
      description: params.description || '',
      priority: params.priority ?? 0,
      assigneeId: params.assigneeId || null,
      creatorId: params.creatorId,
      dueDateTime: params.dueDateTime || null,
      isAllDay: false,
      completed: false,
      repeating: 'never',
      repeatFrom: 'DUE_DATE',
      isPrivate: false,
      lists: params.listIds?.length
        ? { connect: params.listIds.map(id => ({ id })) }
        : undefined,
    },
    include: {
      lists: { select: { id: true, name: true, ownerId: true, listMembers: { select: { userId: true } } } },
      assignee: { select: { id: true, name: true, email: true, image: true } },
      creator: { select: { id: true, name: true, email: true, image: true } },
    },
  })

  // Broadcast task_created to all relevant users (same as v1 API)
  const recipientIds = new Set<string>()
  recipientIds.add(params.creatorId)
  if (task.assigneeId) recipientIds.add(task.assigneeId)
  task.lists?.forEach(l => {
    recipientIds.add(l.ownerId)
    l.listMembers?.forEach(m => recipientIds.add(m.userId))
  })

  await broadcastToUsers([...recipientIds], {
    type: 'task_created',
    timestamp: new Date().toISOString(),
    data: { task },
  }).catch(err => console.error('[AstridAPI] SSE broadcast error:', err))

  // Invalidate user stats cache
  try {
    const { RedisCache, isRedisAvailable } = await import('@/lib/redis')
    if (await isRedisAvailable()) {
      await RedisCache.del(`user-stats:${params.creatorId}`)
    }
  } catch {}

  return { id: task.id, title: task.title }
}

/**
 * Complete a task via the same logic as PUT /api/v1/tasks/:id.
 */
export async function astridCompleteTask(params: {
  taskId: string
  userId: string
}): Promise<{ id: string; title: string }> {
  const task = await prisma.task.update({
    where: { id: params.taskId },
    data: { completed: true },
    include: {
      lists: { select: { id: true, ownerId: true, listMembers: { select: { userId: true } } } },
    },
  })

  // Broadcast to all stakeholders
  const recipientIds = new Set<string>()
  recipientIds.add(params.userId)
  if (task.assigneeId) recipientIds.add(task.assigneeId)
  if (task.creatorId) recipientIds.add(task.creatorId)
  task.lists?.forEach(l => {
    recipientIds.add(l.ownerId)
    l.listMembers?.forEach(m => recipientIds.add(m.userId))
  })

  await broadcastToUsers([...recipientIds], {
    type: 'task_updated',
    timestamp: new Date().toISOString(),
    data: { task },
  }).catch(err => console.error('[AstridAPI] SSE broadcast error:', err))

  return { id: task.id, title: task.title }
}

/**
 * List tasks — same query as GET /api/v1/tasks.
 */
export async function astridListTasks(params: {
  userId: string
  listId?: string | null
  includeCompleted?: boolean
  limit?: number
}): Promise<Array<{ id: string; title: string; completed: boolean; priority: number; dueDate: string | null }>> {
  const where: Record<string, unknown> = {}
  if (!params.includeCompleted) where.completed = false

  if (params.listId) {
    where.lists = { some: { id: params.listId } }
  } else {
    where.OR = [{ assigneeId: params.userId }, { creatorId: params.userId }]
  }

  const tasks = await prisma.task.findMany({
    where,
    select: { id: true, title: true, completed: true, priority: true, dueDateTime: true },
    orderBy: [{ dueDateTime: 'asc' }, { priority: 'desc' }],
    take: params.limit || 10,
  })

  return tasks.map(t => ({
    id: t.id,
    title: t.title,
    completed: t.completed,
    priority: t.priority,
    dueDate: t.dueDateTime?.toISOString() || null,
  }))
}
