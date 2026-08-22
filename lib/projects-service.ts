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
import { addCustomState, renameCustomState } from '@/lib/project-custom-states'
import type { StatusState } from '@/lib/task-status'

/** Either the top-level client or a transaction client. */
type PrismaLike = typeof prisma | Prisma.TransactionClient

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
 * List every project the user owns or is a member of.
 *
 * Board columns are NOT in this response and no longer need to be: since
 * Stage D (task b7b0c2f5) the three defaults come from `DEFAULT_STATES`
 * config and a board's custom columns from its own `Project.customStates`,
 * so there is nothing per-user left to merge in. This used to fetch the
 * `listType: 'status'` rows and append them to every project's `lists`, and
 * to lazily re-seed them on a plain read — which is why the seeder had to go
 * in the same change as the migration that deleted them.
 */
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
 * Create a project.
 *
 * No status rows are written. A new board gets its Ready / Doing / Waiting
 * columns from `DEFAULT_STATES` config, and Inbox and Done stay virtual —
 * none of the five is a row (task b7b0c2f5). See
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

    return tx.project.findUniqueOrThrow({
      where: { id: createdProject.id },
      include: projectInclude,
    })
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

    const project = await tx.project.findUniqueOrThrow({
      where: { id: created.id },
      include: projectInclude,
    })

    return { project, list: updatedList }
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
      /** The state as stored on `Project.customStates` — now the only copy. */
      state: StatusState
      userIdsToInvalidate: Set<string>
    }

/**
 * Add a custom status column to a board (board sub-task #5).
 *
 * **Scoped to the project, not to the user** (task 109d8a91): a custom state
 * belongs to one board and must not leak onto another. The three default
 * roles are config, shared by every board, and are not stored anywhere.
 *
 * Writes `Project.customStates` and nothing else. Until Stage D
 * (task b7b0c2f5) this also wrote a `listType: 'status'` TaskList alongside
 * it, because the board rendered its columns from those rows; the rows are
 * deleted now and the board reads `customStates` directly, so the second
 * write would recreate exactly what the migration removed.
 *
 * Rename and reorder are NOT here — see `renameCustomState` in
 * lib/project-custom-states.ts, which has no route yet.
 */
export async function addUserStatus(
  userId: string,
  name: string,
  projectId: string,
): Promise<AddUserStatusResult> {
  const trimmed = name.trim()
  if (!trimmed) {
    return { error: 'invalid', message: 'Status name cannot be empty' }
  }
  if (trimmed.length > 40) {
    return { error: 'invalid', message: 'Status name is too long (40 characters max)' }
  }
  if (!projectId) {
    // A custom state is stored ON the board. Without one there is nowhere to
    // put it — fail loudly rather than writing an inert status.
    return { error: 'invalid', message: 'A status must belong to a board' }
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { customStates: true },
  })
  if (!project) {
    return { error: 'invalid', message: 'Board not found' }
  }

  // Name clashes — with another custom column, and with a built-in whose name
  // is config rather than data — are both `validateName`'s job inside
  // `addCustomState`. Custom roles are namespaced `custom-*`, so a role can
  // only collide with another custom one, and those all live in `customStates`.
  const write = addCustomState(project.customStates, trimmed)
  if ('error' in write) {
    // `reserved` has no wire code of its own; it is a bad request like any
    // other malformed name, and the route maps `invalid` to 400.
    return {
      error: write.error === 'duplicate' ? 'duplicate' : 'invalid',
      message: write.message,
    }
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { customStates: write.states as unknown as Prisma.InputJsonValue },
  })

  return { state: write.state, userIdsToInvalidate: new Set<string>([userId]) }
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

export type RenameUserStatusResult =
  | { error: 'invalid'; message: string }
  | { error: 'duplicate'; message: string }
  | { error: 'not_found'; message: string }
  | { state: StatusState; userIdsToInvalidate: Set<string> }

/**
 * Rename a board's CUSTOM status column.
 *
 * Rename used to be a `PUT /api/v1/lists/[id]` on the row backing the column.
 * Stage D (task b7b0c2f5) deleted the rows, so this is where a rename lives
 * now — against `Project.customStates`, the only durable copy.
 *
 * The three defaults are NOT renameable here, and deliberately: they are
 * `DEFAULT_STATES` config shared by every board and every user, so there is
 * nowhere per-board to put a new name. Renaming one used to work; no
 * production board had ever done it. Tracked separately.
 *
 * The role is preserved across a rename — see `renameCustomState`. Minting a
 * fresh one would orphan every task carrying the old role.
 */
export async function renameUserStatus(
  userId: string,
  role: string,
  name: string,
  projectId: string,
): Promise<RenameUserStatusResult> {
  if (!projectId) {
    return { error: 'invalid', message: 'A status must belong to a board' }
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { customStates: true },
  })
  if (!project) {
    return { error: 'not_found', message: 'Board not found' }
  }

  const write = renameCustomState(project.customStates, role, name)
  if ('error' in write) {
    if (write.error === 'not-found') {
      return { error: 'not_found', message: write.message }
    }
    return {
      error: write.error === 'duplicate' ? 'duplicate' : 'invalid',
      message: write.message,
    }
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { customStates: write.states as unknown as Prisma.InputJsonValue },
  })

  return { state: write.state, userIdsToInvalidate: new Set<string>([userId]) }
}
