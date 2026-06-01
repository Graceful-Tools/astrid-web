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
  // Lazily backfill the user's global status lists so existing boards
  // (created before the per-user-status migration) still render columns.
  await ensureUserStatusLists(userId)
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
  // Embed the shared status columns into every project's list set.
  return projects.map(project => ({
    ...project,
    lists: [...project.lists, ...statusLists],
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

/**
 * Fetch a single project the user can see (owner or member), in the same
 * shape as {@link listProjectsForUser} (embedded board lists + shared status
 * columns). Returns null when missing or not visible to the user.
 */
export async function getProjectForUser(projectId: string, userId: string) {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      OR: [{ ownerId: userId }, { members: { some: { userId } } }],
    },
    include: projectInclude,
  })

  if (!project) {
    return null
  }

  const statusLists = await fetchUserStatusLists(userId)
  return { ...project, lists: [...project.lists, ...statusLists] }
}

export interface UpdateProjectMetadataInput {
  name?: string
  description?: string | null
  color?: string
  imageUrl?: string | null
}

export type UpdateProjectMetadataResult =
  | { error: 'not_found' }
  | { error: 'forbidden' }
  | { error: 'invalid'; message: string }
  | {
      project: Awaited<ReturnType<typeof listProjectsForUser>>[number]
      userIdsToInvalidate: Set<string>
    }

/**
 * Update a project's display metadata (name / description / color / imageUrl).
 * Owner-only — project-level membership roles are not yet wired into perms
 * (that's sub-task #3), so this mirrors the owner check used by DELETE. Only
 * the fields present in `input` are touched. Returns the updated project in the
 * same shape as {@link listProjectsForUser} plus the user ids whose cached
 * list/project data should be invalidated.
 */
export async function updateProjectMetadata(
  projectId: string,
  userId: string,
  input: UpdateProjectMetadataInput,
): Promise<UpdateProjectMetadataResult> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { ownerId: true, members: { select: { userId: true } } },
  })

  if (!project) {
    return { error: 'not_found' }
  }
  if (project.ownerId !== userId) {
    return { error: 'forbidden' }
  }

  const data: Record<string, unknown> = {}
  if (input.name !== undefined) {
    const trimmed = input.name.trim()
    if (!trimmed) {
      return { error: 'invalid', message: 'Project name cannot be empty' }
    }
    data.name = trimmed
  }
  if (input.description !== undefined) {
    data.description = input.description?.trim() || null
  }
  if (input.color !== undefined) {
    if (!/^#[0-9a-fA-F]{6}$/.test(input.color)) {
      return { error: 'invalid', message: 'Color must be a 6-digit hex value like #3b82f6' }
    }
    data.color = input.color
  }
  if (input.imageUrl !== undefined) {
    data.imageUrl = input.imageUrl?.trim() || null
  }

  if (Object.keys(data).length === 0) {
    return { error: 'invalid', message: 'No metadata fields provided to update' }
  }

  const updated = await prisma.project.update({
    where: { id: projectId },
    data,
    include: projectInclude,
  })

  const userIdsToInvalidate = new Set<string>([
    project.ownerId,
    ...project.members.map((member) => member.userId),
  ])

  return { project: updated, userIdsToInvalidate }
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
