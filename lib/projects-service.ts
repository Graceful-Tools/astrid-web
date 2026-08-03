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

const listInclude = {
  owner: { select: safeUserSelect },
  listMembers: { include: { user: { select: safeUserSelect } } },
}

const projectInclude = {
  owner: { select: safeUserSelect },
  members: { include: { user: { select: safeUserSelect } } },
  lists: {
    include: listInclude,
    orderBy: [
      { listType: 'asc' as const },
      { statusOrder: 'asc' as const },
      { createdAt: 'asc' as const },
    ],
  },
}

/**
 * Fetch the user's per-user global status lists with the same include
 * shape as a project's embedded lists. Status lists are `projectId: null`
 * so they are NOT part of any project's `lists` relation — we merge them
 * in explicitly so each project response embeds the full board (regular
 * domain lists + the shared status columns).
 */
async function fetchUserStatusLists(userId: string, client: PrismaLike = prisma) {
  return client.taskList.findMany({
    where: { ownerId: userId, listType: 'status', projectId: null },
    include: listInclude,
    orderBy: { statusOrder: 'asc' },
  })
}

/** List every project the user owns or is a member of. */
export async function listProjectsForUser(userId: string) {
  const [projects, statusLists] = await Promise.all([
    prisma.project.findMany({
      where: {
        OR: [
          { ownerId: userId },
          { members: { some: { userId } } },
        ],
      },
      include: projectInclude,
      orderBy: { createdAt: 'desc' },
    }),
    fetchUserStatusLists(userId),
  ])

  // Lazy backfill of the per-user global status lists, gated to the rare case
  // that actually needs it: the user has at least one board but is missing a
  // default status column (a board created before the per-user-status
  // migration). The hot path — no boards, or status lists already present —
  // skips the write path and the second fetch entirely. Board creation
  // (createProjectFromList / createProjectForUser) seeds these directly, so a
  // board-less user never needs them pre-created here.
  let effectiveStatusLists = statusLists
  if (projects.length > 0) {
    const haveRoles = new Set(statusLists.map(s => s.statusRole))
    const missingDefault = DEFAULT_PROJECT_STATUSES.some(s => !haveRoles.has(s.role))
    if (missingDefault) {
      await ensureUserStatusLists(userId)
      effectiveStatusLists = await fetchUserStatusLists(userId)
    }
  }

  // Embed the shared status columns into every project's list set.
  return projects.map(project => ({
    ...project,
    lists: [...project.lists, ...effectiveStatusLists],
  }))
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

    const [project, statusLists] = await Promise.all([
      tx.project.findUniqueOrThrow({
        where: { id: createdProject.id },
        include: projectInclude,
      }),
      fetchUserStatusLists(userId, tx),
    ])
    // Embed the shared status columns so the response carries the full
    // board (regular domain lists + status columns) — they are
    // `projectId: null` and thus absent from the project's relation.
    return { ...project, lists: [...project.lists, ...statusLists] }
  })
}

export type CreateProjectFromListResult =
  | { error: 'list_not_found' }
  | { error: 'forbidden' }
  | { error: 'invalid'; message: string }
  | {
      project: Awaited<ReturnType<typeof listProjectsForUser>>[number]
      list: Prisma.TaskListGetPayload<Record<string, never>>
    }

/**
 * Atomically turn a list into a project board: create the project (copying the
 * list's metadata) AND attach the list, in a single transaction. Replaces the
 * old two-request client flow (create project, then PUT the list) whose middle
 * failure left empty, same-named orphan projects. Idempotent guard: refuses a
 * list that is already part of a project.
 */
export async function createProjectFromList(
  userId: string,
  listId: string,
): Promise<CreateProjectFromListResult> {
  return prisma.$transaction(async (tx) => {
    const list = await tx.taskList.findUnique({
      where: { id: listId },
      select: {
        id: true,
        ownerId: true,
        name: true,
        description: true,
        color: true,
        imageUrl: true,
        listType: true,
        projectId: true,
      },
    })

    if (!list) return { error: 'list_not_found' as const }
    if (list.ownerId !== userId) return { error: 'forbidden' as const }
    if (list.listType === 'status') {
      return { error: 'invalid' as const, message: 'A status list cannot become a board' }
    }
    if (list.projectId) {
      return { error: 'invalid' as const, message: 'This list is already part of a project' }
    }

    const created = await tx.project.create({
      data: {
        name: list.name,
        description: list.description || null,
        color: list.color || '#3b82f6',
        imageUrl: list.imageUrl || null,
        ownerId: userId,
        members: { create: { userId, role: 'admin' } },
      },
    })

    const updatedList = await tx.taskList.update({
      where: { id: listId },
      data: { projectId: created.id, listType: 'regular' },
    })

    await ensureUserStatusLists(userId, tx)

    const [project, statusLists] = await Promise.all([
      tx.project.findUniqueOrThrow({ where: { id: created.id }, include: projectInclude }),
      fetchUserStatusLists(userId, tx),
    ])

    return {
      project: { ...project, lists: [...project.lists, ...statusLists] },
      list: updatedList,
    }
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

export type AddUserStatusResult =
  | { error: 'invalid'; message: string }
  | { error: 'duplicate'; message: string }
  | {
      list: Awaited<ReturnType<typeof fetchUserStatusLists>>[number]
      userIdsToInvalidate: Set<string>
    }

/** Slugify a status name into a stable, role-safe identifier fragment. */
function statusNameToRoleFragment(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'status'
}

/**
 * Add a custom status column for the user (board sub-task #5, keep-global
 * model). Status lists are per-user globals (`projectId: null`), so the new
 * column appears on every board the user has. Appended after the existing
 * statuses by `statusOrder`. Rename/reorder reuse PUT /api/lists/[id].
 */
export async function addUserStatus(userId: string, name: string): Promise<AddUserStatusResult> {
  const trimmed = name.trim()
  if (!trimmed) {
    return { error: 'invalid', message: 'Status name cannot be empty' }
  }
  if (trimmed.length > 40) {
    return { error: 'invalid', message: 'Status name is too long (40 characters max)' }
  }

  const existing = await prisma.taskList.findMany({
    where: { ownerId: userId, listType: 'status', projectId: null },
    select: { name: true, statusOrder: true, statusRole: true },
  })

  if (existing.some(s => s.name.trim().toLowerCase() === trimmed.toLowerCase())) {
    return { error: 'duplicate', message: 'A status with that name already exists' }
  }

  const maxOrder = existing.reduce(
    (max, s) => Math.max(max, typeof s.statusOrder === 'number' ? s.statusOrder : 0),
    0,
  )
  const roles = new Set(existing.map(s => s.statusRole))
  const base = `custom-${statusNameToRoleFragment(trimmed)}`
  let statusRole = base
  let suffix = 2
  while (roles.has(statusRole)) {
    statusRole = `${base}-${suffix++}`
  }

  const created = await prisma.taskList.create({
    data: {
      name: trimmed,
      description: trimmed,
      color: '#3b82f6',
      privacy: 'PRIVATE',
      ownerId: userId,
      projectId: null,
      listType: 'status',
      statusRole,
      statusOrder: maxOrder + 1,
      statusDescription: trimmed,
      statusCompleted: false,
      imageUrl: null,
    },
    include: listInclude,
  })

  return { list: created, userIdsToInvalidate: new Set<string>([userId]) }
}

/**
 * Collect every user whose list visibility depends on the given projects'
 * membership — the project owner and all project members. Used to invalidate
 * cached list sets when a list is attached to / detached from a project
 * outside `attachListToProject` (e.g. iOS's PUT /api/v1/lists/:id with a
 * changed projectId). Pure read — the caller performs the cache eviction.
 */
export async function collectProjectMemberUserIds(
  projectIds: Array<string | null | undefined>,
): Promise<string[]> {
  const ids = projectIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
  if (ids.length === 0) return []

  const projects = await prisma.project.findMany({
    where: { id: { in: ids } },
    select: { ownerId: true, members: { select: { userId: true } } },
  })

  const userIds = new Set<string>()
  for (const project of projects) {
    userIds.add(project.ownerId)
    project.members.forEach((member) => userIds.add(member.userId))
  }
  return Array.from(userIds)
}
