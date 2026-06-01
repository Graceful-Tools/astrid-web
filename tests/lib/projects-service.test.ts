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
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    project: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}))

import { ensureUserStatusLists, listProjectsForUser, attachListToProject } from '@/lib/projects-service'
import { prisma } from '@/lib/prisma'

const mockFindMany = vi.mocked(prisma.taskList.findMany)
const mockCreateMany = vi.mocked(prisma.taskList.createMany)
const mockProjectFindMany = vi.mocked(prisma.project.findMany)
const mockProjectFindFirst = vi.mocked(prisma.project.findFirst)
const mockListFindUnique = vi.mocked(prisma.taskList.findUnique)
const mockListUpdate = vi.mocked(prisma.taskList.update)

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
