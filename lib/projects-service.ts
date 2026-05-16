/**
 * Shared project-status-board service. Both /api/projects (session auth,
 * web UI) and /api/v1/projects (OAuth, iOS) call into these primitives so
 * the two surfaces stay in lockstep — same seed data, same cascade rules,
 * same response shape (modulo the v1 envelope).
 *
 * Each function performs its DB work inside a transaction; the caller
 * owns auth/scope checks and Redis-invalidation cleanup.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { DEFAULT_PROJECT_STATUSES } from '@/lib/project-status'

/** Either the top-level client or a transaction client. */
type PrismaLike = typeof prisma | Prisma.TransactionClient

/**
 * Get-or-create the user's global status lists (Ready / Doing / Waiting).
 *
 * Status lists are per-user singletons — `projectId: null`, `listType:
 * "status"` — shared across every project board the user has, rather
 * than duplicated per project. This helper is idempotent: it creates
 * only the roles the user is missing and returns the full set ordered
 * by `statusOrder`.
 */
export async function ensureUserStatusLists(userId: string, client: PrismaLike = prisma) {
  const existing = await client.taskList.findMany({
    where: { ownerId: userId, listType: 'status', projectId: null },
  })
  const haveRoles = new Set(existing.map(list => list.statusRole))
  const missing = DEFAULT_PROJECT_STATUSES.filter(status => !haveRoles.has(status.role))

  if (missing.length > 0) {
    await client.taskList.createMany({
      data: missing.map(status => ({
        name: status.name,
        description: status.description,
        color: '#3b82f6',
        privacy: 'PRIVATE' as const,
        ownerId: userId,
        projectId: null,
        listType: 'status',
        statusRole: status.role,
        statusOrder: status.order,
        statusDescription: status.description,
        statusCompleted: false,
        imageUrl: null,
      })),
    })
  }

  return client.taskList.findMany({
    where: { ownerId: userId, listType: 'status', projectId: null },
    orderBy: { statusOrder: 'asc' },
  })
}

const safeUserSelect = {
  id: true,
  name: true,
  email: true,
  image: true,
  isAIAgent: true,
} as const

const projectInclude = {
  owner: { select: safeUserSelect },
  members: { include: { user: { select: safeUserSelect } } },
  lists: {
    include: {
      owner: { select: safeUserSelect },
      listMembers: { include: { user: { select: safeUserSelect } } },
    },
    orderBy: [
      { listType: 'asc' as const },
      { statusOrder: 'asc' as const },
      { createdAt: 'asc' as const },
    ],
  },
}

/** List every project the user owns or is a member of. */
export async function listProjectsForUser(userId: string) {
  // Lazily backfill the user's global status lists so existing boards
  // (created before the per-user-status migration) still render columns.
  await ensureUserStatusLists(userId)
  return prisma.project.findMany({
    where: {
      OR: [
        { ownerId: userId },
        { members: { some: { userId } } },
      ],
    },
    include: projectInclude,
    orderBy: { createdAt: 'desc' },
  })
}

export interface CreateProjectInput {
  name: string
  description?: string | null
  color?: string
  imageUrl?: string | null
}

/**
 * Create a project. Status lists are NOT seeded per project — they are
 * per-user globals (see {@link ensureUserStatusLists}); a project's board
 * is the intersection of its domain tasks with those shared statuses.
 * We ensure the user's global status lists exist so a brand-new board
 * has its Ready / Doing / Waiting columns.
 *
 * Inbox and Done are virtual columns — never created as rows. See
 * docs/product/project-status-board.md for the invariants.
 */
export async function createProjectForUser(userId: string, input: CreateProjectInput) {
  const color = input.color || '#3b82f6'
  return prisma.$transaction(async (tx) => {
    const createdProject = await tx.project.create({
      data: {
        name: input.name,
        description: input.description || null,
        color,
        imageUrl: input.imageUrl || null,
        ownerId: userId,
        members: {
          create: { userId, role: 'admin' },
        },
      },
    })

    // Per-user global status lists — shared across every board, created
    // once per user rather than duplicated per project.
    await ensureUserStatusLists(userId, tx)

    return tx.project.findUniqueOrThrow({
      where: { id: createdProject.id },
      include: projectInclude,
    })
  })
}

/**
 * Tear down a project: detach its domain (regular) lists, then cascade-delete
 * the project and its status lists. Caller must have already verified that
 * the user owns the project.
 *
 * Returns the detached domain-list ids and the set of users whose list cache
 * should be invalidated.
 */
export async function deleteProjectAndDetachLists(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      members: true,
      lists: { select: { id: true, listType: true, ownerId: true } },
    },
  })

  if (!project) {
    return null
  }

  const domainListIds = project.lists
    .filter((list) => list.listType !== 'status')
    .map((list) => list.id)

  const userIdsToInvalidate = new Set<string>([
    project.ownerId,
    ...project.members.map((member) => member.userId),
  ])

  await prisma.$transaction(async (tx) => {
    if (domainListIds.length > 0) {
      await tx.taskList.updateMany({
        where: { id: { in: domainListIds } },
        data: { projectId: null },
      })
    }
    await tx.project.delete({ where: { id: projectId } })
  })

  return { project, detachedListIds: domainListIds, userIdsToInvalidate }
}
