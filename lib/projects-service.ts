/**
 * Shared project-status-board service. Both /api/projects (session auth,
 * web UI) and /api/v1/projects (OAuth, iOS) call into these primitives so
 * the two surfaces stay in lockstep — same seed data, same cascade rules,
 * same response shape (modulo the v1 envelope).
 *
 * Each function performs its DB work inside a transaction; the caller
 * owns auth/scope checks and Redis-invalidation cleanup.
 */

import { randomBytes } from 'crypto'
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

export type AttachListResult =
  | { error: 'project_not_found' }
  | { error: 'list_not_found' }
  | { error: 'forbidden' }
  | { error: 'invalid'; message: string }
  | {
      list: Awaited<ReturnType<typeof listProjectsForUser>>[number]['lists'][number]
      userIdsToInvalidate: Set<string>
    }

/**
 * Attach an existing regular list to an existing project (board sub-task #2).
 * Validated both ways: the user must be able to see the target project (owner
 * or member) AND own the list. Status lists are per-user globals and can never
 * be attached; a list already in a project must be detached first.
 */
export async function attachListToProject(
  projectId: string,
  listId: string,
  userId: string,
): Promise<AttachListResult> {
  const [project, list] = await Promise.all([
    prisma.project.findFirst({
      where: {
        id: projectId,
        OR: [{ ownerId: userId }, { members: { some: { userId } } }],
      },
      select: { id: true, ownerId: true, members: { select: { userId: true } } },
    }),
    prisma.taskList.findUnique({
      where: { id: listId },
      select: { id: true, ownerId: true, listType: true, projectId: true },
    }),
  ])

  if (!project) {
    return { error: 'project_not_found' }
  }
  if (!list) {
    return { error: 'list_not_found' }
  }
  if (list.ownerId !== userId) {
    return { error: 'forbidden' }
  }
  if (list.listType === 'status') {
    return { error: 'invalid', message: 'Status lists cannot be attached to a project' }
  }
  if (list.projectId) {
    return {
      error: 'invalid',
      message:
        list.projectId === projectId
          ? 'List is already part of this project'
          : 'List already belongs to another project — detach it first',
    }
  }

  const updated = await prisma.taskList.update({
    where: { id: listId },
    data: { projectId },
    include: listInclude,
  })

  const userIdsToInvalidate = new Set<string>([
    project.ownerId,
    ...project.members.map((member) => member.userId),
    userId,
  ])

  return { list: updated, userIdsToInvalidate }
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

/* ───────────────────────── Project member management ─────────────────────────
 *
 * The write side of board #3 (the read side — project membership granting list
 * access — already shipped). Permission model:
 *   - the project owner and project admins can manage members
 *   - the owner is immutable: never removed, never demoted
 *   - only the owner may grant or revoke the `admin` role; admins manage
 *     plain members only (so an admin can't promote themselves or stage a coup)
 *
 * Each mutation returns the set of user ids whose `userLists` cache must be
 * evicted — the caller (route) performs the Redis eviction, keeping this module
 * free of cache concerns (same split as attachListToProject).
 */

export type ProjectMemberRole = 'admin' | 'member'

interface ProjectMemberSummary {
  id: string
  name: string | null
  email: string
  image: string | null
  role: ProjectMemberRole
}

export type AddProjectMemberInput = {
  userId?: string
  email?: string
  role?: ProjectMemberRole
}

export type AddProjectMemberResult =
  | { error: 'not_found' }
  | { error: 'forbidden' }
  | { error: 'user_not_found' }
  | { error: 'invalid'; message: string }
  | { member: ProjectMemberSummary; userIdsToInvalidate: Set<string> }

export type RemoveProjectMemberResult =
  | { error: 'not_found' }
  | { error: 'forbidden' }
  | { error: 'member_not_found' }
  | { error: 'invalid'; message: string }
  | { removedUserId: string; userIdsToInvalidate: Set<string> }

export type UpdateProjectMemberRoleResult =
  | { error: 'not_found' }
  | { error: 'forbidden' }
  | { error: 'member_not_found' }
  | { error: 'invalid'; message: string }
  | { member: { id: string; role: ProjectMemberRole }; userIdsToInvalidate: Set<string> }

/** The acting user's authority over a project, or null if they have none. */
function actingProjectRole(
  project: { ownerId: string; members: Array<{ userId: string; role: string }> },
  userId: string,
): 'owner' | 'admin' | null {
  if (project.ownerId === userId) return 'owner'
  const membership = project.members.find((m) => m.userId === userId)
  if (membership && (membership.role === 'admin' || membership.role === 'owner')) return 'admin'
  return null
}

/**
 * Add an existing user to a project as a member or admin. Email lookups are
 * case-insensitive. There is no email-invite flow for non-existent users yet —
 * the caller gets `user_not_found` and can surface a "no account" message.
 */
export async function addProjectMember(
  projectId: string,
  actingUserId: string,
  input: AddProjectMemberInput,
): Promise<AddProjectMemberResult> {
  const role: ProjectMemberRole = input.role ?? 'member'
  if (role !== 'admin' && role !== 'member') {
    return { error: 'invalid', message: 'Role must be "admin" or "member"' }
  }
  if (!input.userId && !input.email) {
    return { error: 'invalid', message: 'A userId or email is required' }
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { ownerId: true, members: { select: { userId: true, role: true } } },
  })
  if (!project) return { error: 'not_found' }

  const actingRole = actingProjectRole(project, actingUserId)
  if (!actingRole) return { error: 'forbidden' }
  // Only the owner may grant the admin role.
  if (role === 'admin' && actingRole !== 'owner') return { error: 'forbidden' }

  const target = await prisma.user.findUnique({
    where: input.userId ? { id: input.userId } : { email: input.email!.toLowerCase() },
    select: { id: true, name: true, email: true, image: true },
  })
  if (!target) return { error: 'user_not_found' }

  if (target.id === project.ownerId) {
    return { error: 'invalid', message: 'User is already the project owner' }
  }
  if (project.members.some((m) => m.userId === target.id)) {
    return { error: 'invalid', message: 'User is already a member of this project' }
  }

  await prisma.projectMember.create({
    data: { projectId, userId: target.id, role },
  })

  // The newly added user gains access to every list in the project — evict
  // their cached list set. Existing members' visibility is unchanged.
  return {
    member: { id: target.id, name: target.name, email: target.email, image: target.image, role },
    userIdsToInvalidate: new Set<string>([target.id]),
  }
}

/**
 * Remove a member from a project. The owner can never be removed. Admins may
 * only remove plain members — removing another admin requires the owner.
 */
export async function removeProjectMember(
  projectId: string,
  actingUserId: string,
  targetUserId: string,
): Promise<RemoveProjectMemberResult> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { ownerId: true, members: { select: { userId: true, role: true } } },
  })
  if (!project) return { error: 'not_found' }

  const actingRole = actingProjectRole(project, actingUserId)
  if (!actingRole) return { error: 'forbidden' }

  if (targetUserId === project.ownerId) {
    return { error: 'invalid', message: 'The project owner cannot be removed' }
  }

  const membership = project.members.find((m) => m.userId === targetUserId)
  if (!membership) return { error: 'member_not_found' }

  // Admins can only remove plain members; only the owner removes admins.
  if (actingRole !== 'owner' && membership.role === 'admin') return { error: 'forbidden' }

  await prisma.projectMember.delete({
    where: { projectId_userId: { projectId, userId: targetUserId } },
  })

  // The removed user loses access to the project's lists — evict their cache.
  return {
    removedUserId: targetUserId,
    userIdsToInvalidate: new Set<string>([targetUserId]),
  }
}

/**
 * Change a member's role. Owner-only — promoting/demoting touches the admin
 * grant, which admins are not allowed to do. The owner's role is fixed.
 *
 * A role change does not alter which lists the user can see (both roles have
 * full project access), so no `userLists` eviction is required; the set is
 * returned empty for caller symmetry.
 */
export async function updateProjectMemberRole(
  projectId: string,
  actingUserId: string,
  targetUserId: string,
  role: ProjectMemberRole,
): Promise<UpdateProjectMemberRoleResult> {
  if (role !== 'admin' && role !== 'member') {
    return { error: 'invalid', message: 'Role must be "admin" or "member"' }
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { ownerId: true, members: { select: { userId: true, role: true } } },
  })
  if (!project) return { error: 'not_found' }

  if (project.ownerId !== actingUserId) return { error: 'forbidden' }
  if (targetUserId === project.ownerId) {
    return { error: 'invalid', message: "The owner's role cannot be changed" }
  }

  const membership = project.members.find((m) => m.userId === targetUserId)
  if (!membership) return { error: 'member_not_found' }

  const updated = await prisma.projectMember.update({
    where: { projectId_userId: { projectId, userId: targetUserId } },
    data: { role },
  })

  return {
    member: { id: targetUserId, role: (updated.role as ProjectMemberRole) ?? role },
    userIdsToInvalidate: new Set<string>(),
  }
}

/* ─────────────────── Project sharing (invite by email) ───────────────────
 *
 * Project sharing reuses the generic Invitation system (type PROJECT_SHARING).
 * Inviting an email with no Astrid account creates a pending Invitation +
 * email; on acceptance the invite route upserts a ProjectMember (see
 * app/api/invitations/[token]). These helpers own the permission + dedupe
 * rules; the route owns email sending and cache eviction.
 */

const PROJECT_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

interface NormalizedProjectMember {
  id: string
  user_id?: string
  role: string
  email: string
  name?: string | null
  image?: string | null
  isAIAgent?: boolean
  isOwner?: boolean
  created_at?: Date
  type: 'member' | 'invite'
}

export type ProjectMembersResult =
  | { error: 'not_found' }
  | { error: 'forbidden' }
  | { members: NormalizedProjectMember[]; userRole: 'owner' | 'admin' | 'member' }

/**
 * List a project's members + pending project invitations in the shape the
 * sharing UI expects (mirrors GET /api/lists/[id]/members). Any project member
 * may view; mutations are gated elsewhere to owner/admin.
 */
export async function getProjectMembers(
  projectId: string,
  actingUserId: string,
): Promise<ProjectMembersResult> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      ownerId: true,
      owner: { select: safeUserSelect },
      members: { include: { user: { select: safeUserSelect } } },
    },
  })
  if (!project) return { error: 'not_found' }

  const isOwner = project.ownerId === actingUserId
  const membership = project.members.find((m) => m.userId === actingUserId)
  if (!isOwner && !membership) return { error: 'forbidden' }

  const userRole: 'owner' | 'admin' | 'member' = isOwner
    ? 'owner'
    : membership?.role === 'admin' || membership?.role === 'owner'
      ? 'admin'
      : 'member'

  const memberEmails = new Set<string>()
  const members: NormalizedProjectMember[] = []

  // Owner row (the owner is also stored as a member; represent them once as owner).
  if (project.owner) {
    members.push({
      id: `owner_${project.owner.id}`,
      user_id: project.owner.id,
      role: 'owner',
      email: project.owner.email,
      name: project.owner.name,
      image: project.owner.image,
      isAIAgent: project.owner.isAIAgent,
      isOwner: true,
      type: 'member',
    })
    if (project.owner.email) memberEmails.add(project.owner.email)
  }

  for (const pm of project.members) {
    if (pm.userId === project.ownerId) continue
    if (pm.user?.email) memberEmails.add(pm.user.email)
    members.push({
      id: `member_${pm.id}`,
      user_id: pm.userId,
      role: pm.role === 'admin' ? 'admin' : 'member',
      email: pm.user?.email ?? '',
      name: pm.user?.name,
      image: pm.user?.image,
      isAIAgent: pm.user?.isAIAgent,
      type: 'member',
    })
  }

  // Pending project invitations (exclude any already-member emails).
  const invites = await prisma.invitation.findMany({
    where: {
      projectId,
      type: 'PROJECT_SHARING',
      status: 'PENDING',
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  })
  for (const inv of invites) {
    if (memberEmails.has(inv.email)) continue
    members.push({
      id: `invite_${inv.id}`,
      role: inv.role === 'admin' ? 'admin' : 'member',
      email: inv.email,
      created_at: inv.createdAt,
      type: 'invite',
    })
  }

  return { members, userRole }
}

export type InviteProjectMemberResult =
  | { error: 'not_found' }
  | { error: 'forbidden' }
  | { error: 'invalid'; message: string }
  | { token: string; email: string; role: ProjectMemberRole; projectName: string }

/**
 * Create a pending PROJECT_SHARING invitation for an email with no account
 * (the existing-user path goes through addProjectMember instead). Owner +
 * admins may invite; only the owner may invite as admin.
 */
export async function inviteProjectMemberByEmail(
  projectId: string,
  actingUserId: string,
  input: { email: string; role?: ProjectMemberRole },
): Promise<InviteProjectMemberResult> {
  const email = input.email.trim().toLowerCase()
  const role: ProjectMemberRole = input.role ?? 'member'
  if (!email) return { error: 'invalid', message: 'Email is required' }
  if (role !== 'admin' && role !== 'member') {
    return { error: 'invalid', message: 'Role must be "admin" or "member"' }
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { ownerId: true, name: true, members: { select: { userId: true, role: true } } },
  })
  if (!project) return { error: 'not_found' }

  const actingRole = actingProjectRole(project, actingUserId)
  if (!actingRole) return { error: 'forbidden' }
  if (role === 'admin' && actingRole !== 'owner') return { error: 'forbidden' }

  // Dedupe an existing pending invite for this email + project.
  const existing = await prisma.invitation.findFirst({
    where: { projectId, email, type: 'PROJECT_SHARING', status: 'PENDING' },
    select: { id: true },
  })
  if (existing) {
    return { error: 'invalid', message: 'An invitation is already pending for this email' }
  }

  const token = `inv_${randomBytes(16).toString('hex')}`
  await prisma.invitation.create({
    data: {
      email,
      token,
      type: 'PROJECT_SHARING',
      status: 'PENDING',
      role,
      projectId,
      senderId: actingUserId,
      expiresAt: new Date(Date.now() + PROJECT_INVITE_TTL_MS),
    },
  })

  return { token, email, role, projectName: project.name }
}

export type ProjectInviteMutationResult =
  | { error: 'not_found' }
  | { error: 'forbidden' }
  | { error: 'invalid'; message: string }
  | { success: true }

/** Cancel a pending project invitation by email (owner/admin). */
export async function cancelProjectInvite(
  projectId: string,
  actingUserId: string,
  email: string,
): Promise<ProjectInviteMutationResult> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { ownerId: true, members: { select: { userId: true, role: true } } },
  })
  if (!project) return { error: 'not_found' }
  if (!actingProjectRole(project, actingUserId)) return { error: 'forbidden' }

  const result = await prisma.invitation.deleteMany({
    where: { projectId, email: email.trim().toLowerCase(), type: 'PROJECT_SHARING', status: 'PENDING' },
  })
  if (result.count === 0) return { error: 'not_found' }
  return { success: true }
}

/** Change the role on a pending project invitation (owner only for admin). */
export async function updateProjectInviteRole(
  projectId: string,
  actingUserId: string,
  email: string,
  role: ProjectMemberRole,
): Promise<ProjectInviteMutationResult> {
  if (role !== 'admin' && role !== 'member') {
    return { error: 'invalid', message: 'Role must be "admin" or "member"' }
  }
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { ownerId: true, members: { select: { userId: true, role: true } } },
  })
  if (!project) return { error: 'not_found' }

  const actingRole = actingProjectRole(project, actingUserId)
  if (!actingRole) return { error: 'forbidden' }
  if (role === 'admin' && actingRole !== 'owner') return { error: 'forbidden' }

  const result = await prisma.invitation.updateMany({
    where: { projectId, email: email.trim().toLowerCase(), type: 'PROJECT_SHARING', status: 'PENDING' },
    data: { role },
  })
  if (result.count === 0) return { error: 'not_found' }
  return { success: true }
}
