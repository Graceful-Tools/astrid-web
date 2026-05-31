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
    },
    project: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

import { ensureUserStatusLists, listProjectsForUser, updateProjectMetadata } from '@/lib/projects-service'
import { prisma } from '@/lib/prisma'

const mockFindMany = vi.mocked(prisma.taskList.findMany)
const mockCreateMany = vi.mocked(prisma.taskList.createMany)
const mockProjectFindMany = vi.mocked(prisma.project.findMany)
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
