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
  },
}))

import { ensureUserStatusLists, listProjectsForUser, updateProjectMetadata, getProjectForUser, addUserStatus, attachListToProject, collectProjectMemberUserIds } from '@/lib/projects-service'
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

describe('updateProjectMetadata (task 17745aa8 — project board #6)', () => {
  const OWNER = 'owner-1'

  function ownedProject() {
    mockProjectFindUnique.mockResolvedValue({
      ownerId: OWNER,
      members: [{ userId: 'member-2' }],
    } as never)
  }

  it('returns not_found when the project does not exist', async () => {
    mockProjectFindUnique.mockResolvedValue(null as never)
    const result = await updateProjectMetadata('p1', OWNER, { name: 'New' })
    expect(result).toEqual({ error: 'not_found' })
    expect(mockProjectUpdate).not.toHaveBeenCalled()
  })

  it('forbids a non-owner from editing', async () => {
    ownedProject()
    const result = await updateProjectMetadata('p1', 'someone-else', { name: 'New' })
    expect(result).toEqual({ error: 'forbidden' })
    expect(mockProjectUpdate).not.toHaveBeenCalled()
  })

  it('rejects an empty name', async () => {
    ownedProject()
    const result = await updateProjectMetadata('p1', OWNER, { name: '   ' })
    expect(result).toMatchObject({ error: 'invalid' })
    expect(mockProjectUpdate).not.toHaveBeenCalled()
  })

  it('rejects a non-hex color', async () => {
    ownedProject()
    const result = await updateProjectMetadata('p1', OWNER, { color: 'blue' })
    expect(result).toMatchObject({ error: 'invalid' })
    expect(mockProjectUpdate).not.toHaveBeenCalled()
  })

  it('rejects an update with no fields', async () => {
    ownedProject()
    const result = await updateProjectMetadata('p1', OWNER, {})
    expect(result).toMatchObject({ error: 'invalid' })
    expect(mockProjectUpdate).not.toHaveBeenCalled()
  })

  it('updates only the provided fields and trims them', async () => {
    ownedProject()
    mockProjectUpdate.mockResolvedValue({ id: 'p1', name: 'Renamed' } as never)
    const result = await updateProjectMetadata('p1', OWNER, {
      name: '  Renamed  ',
      description: '  details  ',
      color: '#ff0000',
    })
    expect('project' in result && result.project).toMatchObject({ id: 'p1' })
    expect(mockProjectUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: { name: 'Renamed', description: 'details', color: '#ff0000' },
      })
    )
  })

  it('clears optional fields when passed empty/null and invalidates owner + members', async () => {
    ownedProject()
    mockProjectUpdate.mockResolvedValue({ id: 'p1' } as never)
    const result = await updateProjectMetadata('p1', OWNER, { description: '', imageUrl: null })
    expect(mockProjectUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { description: null, imageUrl: null } })
    )
    if ('userIdsToInvalidate' in result) {
      expect([...result.userIdsToInvalidate].sort()).toEqual(['member-2', OWNER].sort())
    } else {
      throw new Error('expected success result')
    }
  })
})

describe('getProjectForUser (task 17745aa8 — project board #6)', () => {
  it('returns null when the project is missing or not visible', async () => {
    mockProjectFindFirst.mockResolvedValue(null as never)
    const result = await getProjectForUser('p1', 'user-1')
    expect(result).toBeNull()
    // scoped to owner-or-member in the query
    expect(mockProjectFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'p1',
          OR: [{ ownerId: 'user-1' }, { members: { some: { userId: 'user-1' } } }],
        }),
      })
    )
  })

  it('merges the user global status lists into the project board', async () => {
    mockProjectFindFirst.mockResolvedValue({
      id: 'p1', name: 'Board', lists: [{ id: 'domain-a' }],
    } as never)
    mockFindMany.mockResolvedValue([
      statusRow('ready', 0), statusRow('doing', 1), statusRow('waiting', 2),
    ] as never)

    const result = await getProjectForUser('p1', 'user-1')
    expect(result?.lists.map((l: any) => l.id)).toEqual(['domain-a', 'ready', 'doing', 'waiting'])
  })
})

describe('addUserStatus (task 1c7817f9 — project board #5)', () => {
  const USER = 'user-1'

  it('rejects an empty name', async () => {
    expect(await addUserStatus(USER, '   ')).toMatchObject({ error: 'invalid' })
    expect(mockListCreate).not.toHaveBeenCalled()
  })

  it('rejects a duplicate name (case-insensitive)', async () => {
    mockFindMany.mockResolvedValue([
      { name: 'Ready', statusOrder: 0, statusRole: 'ready' },
    ] as never)
    expect(await addUserStatus(USER, ' ready ')).toMatchObject({ error: 'duplicate' })
    expect(mockListCreate).not.toHaveBeenCalled()
  })

  it('appends after the highest statusOrder with a unique custom role', async () => {
    mockFindMany.mockResolvedValue([
      { name: 'Ready', statusOrder: 0, statusRole: 'ready' },
      { name: 'Doing', statusOrder: 1, statusRole: 'doing' },
      { name: 'Waiting', statusOrder: 2, statusRole: 'waiting' },
    ] as never)
    mockListCreate.mockResolvedValue({ id: 'new', name: 'Blocked' } as never)

    const result = await addUserStatus(USER, '  Blocked  ')
    expect('list' in result && result.list).toMatchObject({ id: 'new' })
    const data = (mockListCreate.mock.calls[0][0] as any).data
    expect(data).toMatchObject({
      name: 'Blocked',
      ownerId: USER,
      projectId: null,
      listType: 'status',
      statusOrder: 3,
      statusRole: 'custom-blocked',
    })
    if ('userIdsToInvalidate' in result) {
      expect([...result.userIdsToInvalidate]).toEqual([USER])
    }
  })

  it('disambiguates a custom role that collides with an existing one', async () => {
    mockFindMany.mockResolvedValue([
      { name: 'Blocked', statusOrder: 0, statusRole: 'custom-blocked' },
    ] as never)
    mockListCreate.mockResolvedValue({ id: 'new' } as never)
    await addUserStatus(USER, 'Blocked!')
    const data = (mockListCreate.mock.calls[0][0] as any).data
    expect(data.statusRole).toBe('custom-blocked-2')
  })
})

describe('attachListToProject (task 0b0784c7 — project board #2)', () => {
  const USER = 'user-1'

  function visibleProject() {
    mockProjectFindFirst.mockResolvedValue({
      id: 'proj-1', ownerId: USER, members: [{ userId: 'member-2' }],
    } as never)
  }

  it('rejects when the project is not visible to the user', async () => {
    mockProjectFindFirst.mockResolvedValue(null as never)
    mockListFindUnique.mockResolvedValue({ id: 'l1', ownerId: USER, listType: 'regular', projectId: null } as never)
    expect(await attachListToProject('proj-1', 'l1', USER)).toEqual({ error: 'project_not_found' })
    expect(mockListUpdate).not.toHaveBeenCalled()
  })

  it('rejects when the list does not exist', async () => {
    visibleProject()
    mockListFindUnique.mockResolvedValue(null as never)
    expect(await attachListToProject('proj-1', 'l1', USER)).toEqual({ error: 'list_not_found' })
  })

  it('forbids attaching a list the user does not own', async () => {
    visibleProject()
    mockListFindUnique.mockResolvedValue({ id: 'l1', ownerId: 'someone-else', listType: 'regular', projectId: null } as never)
    expect(await attachListToProject('proj-1', 'l1', USER)).toEqual({ error: 'forbidden' })
    expect(mockListUpdate).not.toHaveBeenCalled()
  })

  it('refuses to attach a status list', async () => {
    visibleProject()
    mockListFindUnique.mockResolvedValue({ id: 'l1', ownerId: USER, listType: 'status', projectId: null } as never)
    expect(await attachListToProject('proj-1', 'l1', USER)).toMatchObject({ error: 'invalid' })
  })

  it('refuses to attach a list already in a project', async () => {
    visibleProject()
    mockListFindUnique.mockResolvedValue({ id: 'l1', ownerId: USER, listType: 'regular', projectId: 'proj-2' } as never)
    expect(await attachListToProject('proj-1', 'l1', USER)).toMatchObject({ error: 'invalid' })
  })

  it('attaches the list and invalidates project members + the user', async () => {
    visibleProject()
    mockListFindUnique.mockResolvedValue({ id: 'l1', ownerId: USER, listType: 'regular', projectId: null } as never)
    mockListUpdate.mockResolvedValue({ id: 'l1', projectId: 'proj-1' } as never)
    const result = await attachListToProject('proj-1', 'l1', USER)
    expect(mockListUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'l1' }, data: { projectId: 'proj-1' } })
    )
    if ('list' in result) {
      expect([...result.userIdsToInvalidate].sort()).toEqual(['member-2', USER].sort())
    } else {
      throw new Error('expected success')
    }
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
