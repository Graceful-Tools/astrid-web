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

describe('ensureUserStatusLists', () => {
  it('creates all three global status lists when the user has none', async () => {
    mockFindMany
      .mockResolvedValueOnce([] as any) // existing lookup
      .mockResolvedValueOnce([ // final ordered fetch
        statusRow('ready', 0),
        statusRow('doing', 1),
        statusRow('waiting', 2),
      ] as any)

    const result = await ensureUserStatusLists('user-1')

    expect(mockCreateMany).toHaveBeenCalledTimes(1)
    const created = (mockCreateMany.mock.calls[0][0] as any).data
    expect(created.map((row: any) => row.statusRole)).toEqual(['ready', 'doing', 'waiting'])
    // Per-user global: projectId null, owned by the user.
    expect(created.every((row: any) => row.projectId === null)).toBe(true)
    expect(created.every((row: any) => row.ownerId === 'user-1')).toBe(true)
    expect(created.every((row: any) => row.listType === 'status')).toBe(true)
    expect(result).toHaveLength(3)
  })

  it('only creates the roles the user is missing', async () => {
    mockFindMany
      .mockResolvedValueOnce([statusRow('ready', 0)] as any)
      .mockResolvedValueOnce([
        statusRow('ready', 0),
        statusRow('doing', 1),
        statusRow('waiting', 2),
      ] as any)

    await ensureUserStatusLists('user-1')

    const created = (mockCreateMany.mock.calls[0][0] as any).data
    expect(created.map((row: any) => row.statusRole)).toEqual(['doing', 'waiting'])
  })

  it('is idempotent — creates nothing when all three already exist', async () => {
    const all = [statusRow('ready', 0), statusRow('doing', 1), statusRow('waiting', 2)]
    mockFindMany
      .mockResolvedValueOnce(all as any)
      .mockResolvedValueOnce(all as any)

    await ensureUserStatusLists('user-1')

    expect(mockCreateMany).not.toHaveBeenCalled()
  })

  it('runs its DB work against the supplied transaction client', async () => {
    const tx = {
      taskList: {
        findMany: vi.fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([statusRow('ready', 0)]),
        createMany: vi.fn(),
      },
    }

    await ensureUserStatusLists('user-1', tx as any)

    expect(tx.taskList.findMany).toHaveBeenCalled()
    expect(tx.taskList.createMany).toHaveBeenCalled()
    // The top-level client must not be touched when a tx client is passed.
    expect(mockFindMany).not.toHaveBeenCalled()
    expect(mockCreateMany).not.toHaveBeenCalled()
  })
})

describe('listProjectsForUser', () => {
  it('embeds the per-user global status lists into every project\'s list set', async () => {
    // Status lists are projectId:null so they are not in any project's
    // `lists` relation — listProjectsForUser must merge them in.
    const status = [statusRow('ready', 0), statusRow('doing', 1), statusRow('waiting', 2)]
    mockFindMany.mockResolvedValue(status as any)
    mockProjectFindMany.mockResolvedValue([
      { id: 'p1', name: 'Board A', lists: [{ id: 'domain-a', listType: 'regular' }] },
      { id: 'p2', name: 'Board B', lists: [] },
    ] as any)

    const projects = await listProjectsForUser('user-1')

    expect(projects).toHaveLength(2)
    // Each project keeps its own domain lists AND the 3 shared statuses.
    expect(projects[0].lists.map((l: any) => l.id)).toEqual([
      'domain-a', 'ready', 'doing', 'waiting',
    ])
    expect(projects[1].lists.map((l: any) => l.id)).toEqual([
      'ready', 'doing', 'waiting',
    ])
  })
})

describe('addUserStatus (task 1c7817f9 — project board #5)', () => {
  const USER = 'user-1'
  const PROJECT = 'project-1'

  /**
   * A custom state is now stored on `Project.customStates` and the legacy
   * `listType: 'status'` row is written alongside it, in one transaction,
   * until the board reads the project instead of the rows (AWTD-562). So the
   * project has to exist and the transaction has to actually run its callback.
   */
  beforeEach(() => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue({ customStates: null } as never)
    vi.mocked(prisma.$transaction).mockImplementation((async (fn: unknown) =>
      typeof fn === 'function'
        ? await (fn as (tx: unknown) => unknown)(prisma)
        : fn) as never)
  })

  it('rejects an empty name', async () => {
    expect(await addUserStatus(USER, '   ', PROJECT)).toMatchObject({ error: 'invalid' })
    expect(mockListCreate).not.toHaveBeenCalled()
  })

  it('rejects a duplicate name (case-insensitive)', async () => {
    mockFindMany.mockResolvedValue([
      { name: 'Ready', statusOrder: 0, statusRole: 'ready' },
    ] as never)
    expect(await addUserStatus(USER, ' ready ', PROJECT)).toMatchObject({ error: 'duplicate' })
    expect(mockListCreate).not.toHaveBeenCalled()
  })

  it('appends after the highest statusOrder with a unique custom role', async () => {
    mockFindMany.mockResolvedValue([
      { name: 'Ready', statusOrder: 0, statusRole: 'ready' },
      { name: 'Doing', statusOrder: 1, statusRole: 'doing' },
      { name: 'Waiting', statusOrder: 2, statusRole: 'waiting' },
    ] as never)
    mockListCreate.mockResolvedValue({ id: 'new', name: 'Blocked' } as never)

    const result = await addUserStatus(USER, '  Blocked  ', PROJECT)
    expect('list' in result && result.list).toMatchObject({ id: 'new' })
    const data = (mockListCreate.mock.calls[0][0] as any).data
    expect(data).toMatchObject({
      name: 'Blocked',
      ownerId: USER,
      listType: 'status',
      statusOrder: 3,
      statusRole: 'custom-blocked',
    })
    if ('userIdsToInvalidate' in result) {
      expect([...result.userIdsToInvalidate]).toEqual([USER])
    }
  })

  it('REGRESSION (task 109d8a91): writes the project id the reader requires', async () => {
    // 05dc842 scoped the READER to per-project (statusListsForUser keeps a
    // custom role only when list.projectId === projectId) and left the writer
    // on projectId: null. The two can never agree, so every custom status was
    // created and then rendered on no board at all — including the one it was
    // added from.
    mockFindMany.mockResolvedValue([] as never)
    mockListCreate.mockResolvedValue({ id: 'new' } as never)

    await addUserStatus(USER, 'Blocked', PROJECT)

    const data = (mockListCreate.mock.calls[0][0] as any).data
    expect(data.projectId).toBe(PROJECT)
  })

  it('REGRESSION (task 109d8a91): a status added on one board is not offered on another', async () => {
    // The duplicate check must look at THIS project's statuses, not every
    // status the user owns — otherwise adding "Blocked" to board B is refused
    // because board A already has one.
    mockFindMany.mockResolvedValue([] as never)
    mockListCreate.mockResolvedValue({ id: 'new' } as never)

    await addUserStatus(USER, 'Blocked', PROJECT)

    const where = (mockFindMany.mock.calls.at(-1)![0] as any).where
    expect(where).toMatchObject({ ownerId: USER, listType: 'status' })
    expect(where.OR ?? where.projectId).toBeDefined()
  })

  it('refuses to create a custom status with no project to hang it on', async () => {
    // Without a project the row is unreachable by the reader, which is the bug
    // this task exists for. Fail loudly instead of writing an inert row.
    expect(await addUserStatus(USER, 'Blocked', '')).toMatchObject({ error: 'invalid' })
    expect(mockListCreate).not.toHaveBeenCalled()
  })

  it('stores the state on the project, not only as a list row (AWTD-562)', async () => {
    // The durable home for a custom column is `Project.customStates`. The row
    // is transitional; if only the row were written the state would vanish
    // with it when the status lists are dropped.
    mockFindMany.mockResolvedValue([] as never)
    mockListCreate.mockResolvedValue({ id: 'new' } as never)

    await addUserStatus(USER, 'Blocked', PROJECT)

    const update = vi.mocked(prisma.project.update).mock.calls[0]?.[0] as any
    expect(update, 'the custom state was never written to the project').toBeDefined()
    expect(update.where).toMatchObject({ id: PROJECT })
    expect(update.data.customStates).toMatchObject([{ role: 'custom-blocked', name: 'Blocked' }])
  })

  it('keeps the stored state and the legacy row on the SAME role', async () => {
    // The reader will deduplicate columns by role. Two roles for one column
    // means the board grows a duplicate the moment it starts merging them.
    mockFindMany.mockResolvedValue([] as never)
    mockListCreate.mockResolvedValue({ id: 'new' } as never)

    const result = await addUserStatus(USER, 'In Review', PROJECT)

    const rowRole = (mockListCreate.mock.calls[0][0] as any).data.statusRole
    const stored = (vi.mocked(prisma.project.update).mock.calls[0]?.[0] as any).data.customStates
    expect(rowRole).toBe(stored[0].role)
    if ('state' in result) expect(result.state.role).toBe(rowRole)
  })

  it('does not write anything when the board is gone', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue(null as never)
    mockFindMany.mockResolvedValue([] as never)

    expect(await addUserStatus(USER, 'Blocked', PROJECT)).toMatchObject({ error: 'invalid' })
    expect(mockListCreate).not.toHaveBeenCalled()
  })

  it('refuses a name that would shadow a built-in status', async () => {
    // Two columns called Ready is exactly the duplication this model removes.
    mockFindMany.mockResolvedValue([] as never)

    expect(await addUserStatus(USER, 'Ready', PROJECT)).toMatchObject({ error: 'invalid' })
    expect(mockListCreate).not.toHaveBeenCalled()
  })

  it('disambiguates a custom role that collides with an existing one', async () => {
    mockFindMany.mockResolvedValue([
      { name: 'Blocked', statusOrder: 0, statusRole: 'custom-blocked' },
    ] as never)
    mockListCreate.mockResolvedValue({ id: 'new' } as never)
    await addUserStatus(USER, 'Blocked!', PROJECT)
    const data = (mockListCreate.mock.calls[0][0] as any).data
    expect(data.statusRole).toBe('custom-blocked-2')
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
