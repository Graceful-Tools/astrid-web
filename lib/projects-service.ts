/**
 * Shared project-status-board service. Both /api/projects (session auth,
 * web UI) and /api/v1/projects (OAuth, iOS) call into these primitives so
 * the two surfaces stay in lockstep — same seed data, same cascade rules,
 * same response shape (modulo the v1 envelope).
 *
 * Each function performs its DB work inside a transaction; the caller
 * owns auth/scope checks and Redis-invalidation cleanup.
 */

import { prisma } from '@/lib/prisma'
import { DEFAULT_PROJECT_STATUSES } from '@/lib/project-status'

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
 * Create a project and seed its three default status lists (Ready, Doing,
 * Waiting). The creator becomes owner + admin of the project and admin of
 * every seeded status list.
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

    await tx.taskList.createMany({
      data: DEFAULT_PROJECT_STATUSES.map((status) => ({
        name: status.name,
        description: status.description,
        color,
        privacy: 'SHARED' as const,
        ownerId: userId,
        projectId: createdProject.id,
        listType: 'status',
        statusRole: status.role,
        statusOrder: status.order,
        statusDescription: status.description,
        statusCompleted: false,
        imageUrl: null,
      })),
    })

    const statusLists = await tx.taskList.findMany({
      where: { projectId: createdProject.id, listType: 'status' },
      select: { id: true },
    })

    await tx.listMember.createMany({
      data: statusLists.map((list) => ({
        listId: list.id,
        userId,
        role: 'admin',
      })),
      skipDuplicates: true,
    })

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
