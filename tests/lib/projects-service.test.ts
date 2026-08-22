/**
 * Unit tests for ensureUserStatusLists — the per-user global status-list
 * seeder. Status lists (Ready/Doing/Waiting) are per-user singletons
 * (projectId = null), not duplicated per project. This helper is the
 * idempotent get-or-create for that set.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    project: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    projectMember: {
      create: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    invitation: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

import { ensureUserStatusLists, listProjectsForUser, addUserStatus, collectProjectMemberUserIds, createProjectFromList } from '@/lib/projects-service'
import { prisma } from '@/lib/prisma'

const mockFindMany = vi.mocked(prisma.taskList.findMany)
const mockCreateMany = vi.mocked(prisma.taskList.createMany)
const mockListCreate = vi.mocked(prisma.taskList.create)
const mockListFindUnique = vi.mocked(prisma.taskList.findUnique)
const mockListUpdate = vi.mocked(prisma.taskList.update)
const mockProjectFindMany = vi.mocked(prisma.project.findMany)
const mockProjectFindFirst = vi.mocked(prisma.project.findFirst)
const mockProjectFindUnique = vi.mocked(prisma.project.findUnique)
const mockProjectUpdate = vi.mocked(prisma.project.update)
const mockMemberCreate = vi.mocked(prisma.projectMember.create)
const mockMemberDelete = vi.mocked(prisma.projectMember.delete)
const mockMemberUpdate = vi.mocked(prisma.projectMember.update)
const mockUserFindUnique = vi.mocked(prisma.user.findUnique)
const mockInviteFindMany = vi.mocked(prisma.invitation.findMany)
const mockInviteFindFirst = vi.mocked(prisma.invitation.findFirst)
const mockInviteCreate = vi.mocked(prisma.invitation.create)
const mockInviteDeleteMany = vi.mocked(prisma.invitation.deleteMany)
const mockInviteUpdateMany = vi.mocked(prisma.invitation.updateMany)

function statusRow(role: string, order: number) {
  return { id: role, statusRole: role, statusOrder: order, listType: 'status', projectId: null }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listProjectsForUser', () => {
  it('returns each project with only its own lists', async () => {
    // It used to fetch the per-user `listType: 'status'` rows and append them
    // to every project, so each board carried its columns as list rows. Stage
    // D (task b7b0c2f5) made columns config, so there is nothing to merge —
    // and, critically, this read no longer writes.
    mockProjectFindMany.mockResolvedValue([
      { id: 'p1', name: 'Board A', lists: [{ id: 'domain-a', listType: 'regular' }] },
      { id: 'p2', name: 'Board B', lists: [] },
    ] as any)

    const projects = await listProjectsForUser('user-1')

    expect(projects).toHaveLength(2)
    expect(projects[0].lists.map((l: any) => l.id)).toEqual(['domain-a'])
    expect(projects[1].lists).toEqual([])
  })

  it('never writes on a plain read', async () => {
    // The lazy backfill that used to live here re-seeded the status rows on an
    // ordinary "list my projects" call — which would have undone the migration
    // within minutes of the deploy.
    mockProjectFindMany.mockResolvedValue([{ id: 'p1', name: 'Board A', lists: [] }] as any)

    await listProjectsForUser('user-1')

    expect(mockCreateMany).not.toHaveBeenCalled()
    expect(mockListCreate).not.toHaveBeenCalled()
  })
})

describe('addUserStatus (task 1c7817f9 — project board #5)', () => {
  const USER = 'user-1'
  const PROJECT = 'project-1'

  /**
   * A custom state lives on `Project.customStates` and nowhere else since
   * Stage D (task b7b0c2f5), so the board has to exist and there is exactly
   * one write. The transaction this used to need existed only to keep the
   * legacy row and the JSON in lockstep.
   */
  beforeEach(() => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue({ customStates: null } as never)
    vi.mocked(prisma.project.update).mockResolvedValue({} as never)
  })

  /** The `customStates` the writer will be handed for this board. */
  const boardWith = (...states: Array<{ role: string; name: string; order: number }>) => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue({ customStates: states } as never)
  }

  /** What was written to `Project.customStates`. */
  const written = () =>
    (vi.mocked(prisma.project.update).mock.calls[0]?.[0] as any)?.data?.customStates

  it('rejects an empty name', async () => {
    expect(await addUserStatus(USER, '   ', PROJECT)).toMatchObject({ error: 'invalid' })
    expect(mockListCreate).not.toHaveBeenCalled()
  })

  it('rejects a duplicate name (case-insensitive)', async () => {
    boardWith({ role: 'custom-blocked', name: 'Blocked', order: 0 })
    expect(await addUserStatus(USER, ' blocked ', PROJECT)).toMatchObject({ error: 'duplicate' })
    expect(prisma.project.update).not.toHaveBeenCalled()
  })

  it('appends after the existing states with a unique custom role', async () => {
    boardWith({ role: 'custom-first', name: 'First', order: 0 })

    const result = await addUserStatus(USER, '  Blocked  ', PROJECT)

    expect(written()).toMatchObject([
      { role: 'custom-first', name: 'First' },
      { role: 'custom-blocked', name: 'Blocked' },
    ])
    if ('userIdsToInvalidate' in result) {
      expect([...result.userIdsToInvalidate]).toEqual([USER])
    }
  })

  it('REGRESSION (task 109d8a91): the state is stored on THIS board', async () => {
    // 05dc842 scoped the reader per-project and left the writer on
    // projectId: null, so every custom status was created and then rendered on
    // no board at all. Storing it on the project makes the two agree by
    // construction — there is no second place for it to go.
    await addUserStatus(USER, 'Blocked', PROJECT)

    const update = vi.mocked(prisma.project.update).mock.calls[0]?.[0] as any
    expect(update.where).toMatchObject({ id: PROJECT })
  })

  it('REGRESSION (task 109d8a91): a status added on one board is not offered on another', async () => {
    // The duplicate check reads THIS board's states. Adding "Blocked" to board
    // B must not be refused because board A already has one.
    boardWith()

    expect(await addUserStatus(USER, 'Blocked', PROJECT)).toMatchObject({
      state: { name: 'Blocked' },
    })
  })

  it('refuses to create a custom status with no project to hang it on', async () => {
    // `customStates` is a column on the board. Without one there is nowhere to
    // store the state — fail loudly instead of writing an inert status.
    expect(await addUserStatus(USER, 'Blocked', '')).toMatchObject({ error: 'invalid' })
    expect(prisma.project.update).not.toHaveBeenCalled()
  })

  it('stores the state on the project and writes no list row (AWTD-562)', async () => {
    await addUserStatus(USER, 'Blocked', PROJECT)

    const update = vi.mocked(prisma.project.update).mock.calls[0]?.[0] as any
    expect(update, 'the custom state was never written to the project').toBeDefined()
    expect(update.data.customStates).toMatchObject([{ role: 'custom-blocked', name: 'Blocked' }])
    expect(mockListCreate, 'Stage D deleted the rows; writing one recreates them')
      .not.toHaveBeenCalled()
  })

  it('returns the same role it stored', async () => {
    // A task points at its column by role, so the caller must be told the one
    // that was actually written.
    const result = await addUserStatus(USER, 'In Review', PROJECT)

    if ('state' in result) expect(result.state.role).toBe(written()[0].role)
  })

  it('does not write anything when the board is gone', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue(null as never)

    expect(await addUserStatus(USER, 'Blocked', PROJECT)).toMatchObject({ error: 'invalid' })
    expect(prisma.project.update).not.toHaveBeenCalled()
  })

  it('refuses a name that would shadow a built-in status', async () => {
    // Two columns called Ready is exactly the duplication this model removes.
    // The built-ins are config now, so this check compares NAMES: "Ready"
    // slugs to `custom-ready` and collides with no role at all.
    expect(await addUserStatus(USER, 'Ready', PROJECT)).toMatchObject({ error: 'invalid' })
    expect(prisma.project.update).not.toHaveBeenCalled()
  })

  it('disambiguates a custom role that collides with an existing one', async () => {
    boardWith({ role: 'custom-blocked', name: 'Blocked', order: 0 })

    await addUserStatus(USER, 'Blocked!', PROJECT)

    expect(written()[1].role).toBe('custom-blocked-2')
  })
})

// Cache-invalidation helper for project attach/detach happening outside
// attachListToProject (e.g. iOS PUT /api/v1/lists/:id changing projectId).
describe('collectProjectMemberUserIds', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns owner + members across all given projects, deduped', async () => {
    mockProjectFindMany.mockResolvedValue([
      { ownerId: 'owner-a', members: [{ userId: 'm1' }, { userId: 'm2' }] },
      { ownerId: 'owner-b', members: [{ userId: 'm2' }, { userId: 'm3' }] },
    ] as never)
    const ids = await collectProjectMemberUserIds(['proj-a', 'proj-b'])
    expect(ids.sort()).toEqual(['m1', 'm2', 'm3', 'owner-a', 'owner-b'].sort())
  })

  it('skips null/undefined/empty ids and avoids the query when none remain', async () => {
    const ids = await collectProjectMemberUserIds([null, undefined, ''])
    expect(ids).toEqual([])
    expect(mockProjectFindMany).not.toHaveBeenCalled()
  })

  it('queries only the valid project ids', async () => {
    mockProjectFindMany.mockResolvedValue([
      { ownerId: 'owner-a', members: [] },
    ] as never)
    await collectProjectMemberUserIds([null, 'proj-a'])
    expect(mockProjectFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['proj-a'] } } })
    )
  })
})

// Atomic create-board: create project + attach list in one transaction.
describe('createProjectFromList', () => {
  const USER = 'owner-1'
  beforeEach(() => vi.clearAllMocks())

  // Drive the validation branches: they all return before any write, after a
  // single tx.taskList.findUnique. We stub $transaction to invoke the callback
  // with a tx exposing that lookup.
  function txWithList(list: any) {
    vi.mocked(prisma.$transaction).mockImplementation(((cb: any) =>
      cb({ taskList: { findUnique: vi.fn().mockResolvedValue(list) } })) as any)
  }

  it('list_not_found when the list is missing', async () => {
    txWithList(null)
    expect(await createProjectFromList(USER, 'l1')).toEqual({ error: 'list_not_found' })
  })

  it('forbidden when the user does not own the list', async () => {
    txWithList({ id: 'l1', ownerId: 'someone', listType: 'regular', projectId: null })
    expect(await createProjectFromList(USER, 'l1')).toEqual({ error: 'forbidden' })
  })

  it('invalid for a status list', async () => {
    txWithList({ id: 'l1', ownerId: USER, listType: 'status', projectId: null })
    expect(await createProjectFromList(USER, 'l1')).toMatchObject({ error: 'invalid' })
  })

  it('invalid when the list is already part of a project', async () => {
    txWithList({ id: 'l1', ownerId: USER, listType: 'regular', projectId: 'p9' })
    expect(await createProjectFromList(USER, 'l1')).toMatchObject({ error: 'invalid' })
  })

  it('creates the project and attaches the list atomically', async () => {
    const projectCreate = vi.fn().mockResolvedValue({ id: 'p1' })
    const listUpdate = vi.fn().mockResolvedValue({ id: 'l1', projectId: 'p1', listType: 'regular' })
    const tx: any = {
      taskList: {
        findUnique: vi.fn().mockResolvedValue({ id: 'l1', ownerId: USER, name: 'Career', description: null, color: '#fff', imageUrl: null, listType: 'regular', projectId: null }),
        update: listUpdate,
        findMany: vi.fn()
          .mockResolvedValueOnce([]) // ensureUserStatusLists: existing
          .mockResolvedValueOnce([]) // ensureUserStatusLists: final
          .mockResolvedValueOnce([]), // fetchUserStatusLists
        createMany: vi.fn(),
      },
      project: {
        create: projectCreate,
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'p1', name: 'Career', lists: [{ id: 'l1' }] }),
      },
    }
    vi.mocked(prisma.$transaction).mockImplementation(((cb: any) => cb(tx)) as any)

    const result = await createProjectFromList(USER, 'l1')
    expect(projectCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'Career', ownerId: USER, members: { create: { userId: USER, role: 'admin' } } }) })
    )
    expect(listUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'l1' }, data: { projectId: 'p1', listType: 'regular' } })
    )
    if ('project' in result) {
      expect(result.project.id).toBe('p1')
      expect(result.list.projectId).toBe('p1')
    } else {
      throw new Error('expected success')
    }
  })
})
