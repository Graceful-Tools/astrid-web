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

import { ensureUserStatusLists, listProjectsForUser, updateProjectMetadata, getProjectForUser, addUserStatus, attachListToProject, collectProjectMemberUserIds, addProjectMember, removeProjectMember, updateProjectMemberRole, getProjectMembers, inviteProjectMemberByEmail, cancelProjectInvite, updateProjectInviteRole, createProjectFromList } from '@/lib/projects-service'
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

// Project member management (write side of board #3). Permission model:
//   - owner + project admins can manage members
//   - the owner is immutable (never removed or demoted)
//   - only the owner may grant/revoke the `admin` role; admins manage members
// Every change returns the user ids whose userLists cache must be evicted.
describe('addProjectMember', () => {
  const OWNER = 'owner-1'
  const ADMIN = 'admin-1'
  const PID = 'proj-1'

  beforeEach(() => vi.clearAllMocks())

  function project(members: Array<{ userId: string; role: string }> = []) {
    mockProjectFindUnique.mockResolvedValue({ id: PID, ownerId: OWNER, members } as never)
  }
  function targetUser(id: string | null) {
    mockUserFindUnique.mockResolvedValue(id ? ({ id, name: 'T', email: 't@x.com', image: null } as never) : (null as never))
  }

  it('returns not_found when the project is missing', async () => {
    mockProjectFindUnique.mockResolvedValue(null as never)
    expect(await addProjectMember(PID, OWNER, { email: 't@x.com' })).toEqual({ error: 'not_found' })
    expect(mockMemberCreate).not.toHaveBeenCalled()
  })

  it('forbids a non-owner/non-admin from adding', async () => {
    project([])
    expect(await addProjectMember(PID, 'stranger', { email: 't@x.com' })).toEqual({ error: 'forbidden' })
    expect(mockMemberCreate).not.toHaveBeenCalled()
  })

  it('forbids an admin from granting the admin role', async () => {
    project([{ userId: ADMIN, role: 'admin' }])
    targetUser('new-1')
    expect(await addProjectMember(PID, ADMIN, { email: 't@x.com', role: 'admin' })).toEqual({ error: 'forbidden' })
    expect(mockMemberCreate).not.toHaveBeenCalled()
  })

  it('rejects an invalid role', async () => {
    project([])
    expect(await addProjectMember(PID, OWNER, { email: 't@x.com', role: 'superadmin' as never })).toMatchObject({ error: 'invalid' })
  })

  it('returns user_not_found when no user matches', async () => {
    project([])
    targetUser(null)
    expect(await addProjectMember(PID, OWNER, { email: 'nobody@x.com' })).toEqual({ error: 'user_not_found' })
  })

  it('rejects adding the owner', async () => {
    project([])
    targetUser(OWNER)
    expect(await addProjectMember(PID, OWNER, { userId: OWNER })).toMatchObject({ error: 'invalid' })
  })

  it('rejects adding an existing member', async () => {
    project([{ userId: 'existing', role: 'member' }])
    targetUser('existing')
    expect(await addProjectMember(PID, OWNER, { userId: 'existing' })).toMatchObject({ error: 'invalid' })
    expect(mockMemberCreate).not.toHaveBeenCalled()
  })

  it('owner adds a member and invalidates the new user', async () => {
    project([])
    targetUser('new-1')
    mockMemberCreate.mockResolvedValue({ id: 'pm-1' } as never)
    const result = await addProjectMember(PID, OWNER, { email: 'T@X.com', role: 'member' })
    expect(mockMemberCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { projectId: PID, userId: 'new-1', role: 'member' } })
    )
    // email lookups are lowercased
    expect(mockUserFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { email: 't@x.com' } }))
    if ('member' in result) {
      expect(result.member).toMatchObject({ id: 'new-1', role: 'member' })
      expect([...result.userIdsToInvalidate]).toEqual(['new-1'])
    } else {
      throw new Error('expected success')
    }
  })

  it('owner can grant the admin role', async () => {
    project([])
    targetUser('new-1')
    mockMemberCreate.mockResolvedValue({ id: 'pm-1' } as never)
    const result = await addProjectMember(PID, OWNER, { userId: 'new-1', role: 'admin' })
    expect(mockMemberCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { projectId: PID, userId: 'new-1', role: 'admin' } })
    )
    expect('member' in result).toBe(true)
  })
})

describe('removeProjectMember', () => {
  const OWNER = 'owner-1'
  const ADMIN = 'admin-1'
  const PID = 'proj-1'

  beforeEach(() => vi.clearAllMocks())

  function project(members: Array<{ userId: string; role: string }>) {
    mockProjectFindUnique.mockResolvedValue({ id: PID, ownerId: OWNER, members } as never)
  }

  it('returns not_found when the project is missing', async () => {
    mockProjectFindUnique.mockResolvedValue(null as never)
    expect(await removeProjectMember(PID, OWNER, 'm1')).toEqual({ error: 'not_found' })
  })

  it('forbids a non-owner/non-admin', async () => {
    project([{ userId: 'm1', role: 'member' }])
    expect(await removeProjectMember(PID, 'stranger', 'm1')).toEqual({ error: 'forbidden' })
    expect(mockMemberDelete).not.toHaveBeenCalled()
  })

  it('refuses to remove the owner', async () => {
    project([{ userId: 'm1', role: 'member' }])
    expect(await removeProjectMember(PID, OWNER, OWNER)).toMatchObject({ error: 'invalid' })
    expect(mockMemberDelete).not.toHaveBeenCalled()
  })

  it('returns member_not_found when the target is not a member', async () => {
    project([{ userId: 'm1', role: 'member' }])
    expect(await removeProjectMember(PID, OWNER, 'ghost')).toEqual({ error: 'member_not_found' })
  })

  it('forbids an admin from removing another admin', async () => {
    project([{ userId: ADMIN, role: 'admin' }, { userId: 'other-admin', role: 'admin' }])
    expect(await removeProjectMember(PID, ADMIN, 'other-admin')).toEqual({ error: 'forbidden' })
    expect(mockMemberDelete).not.toHaveBeenCalled()
  })

  it('owner removes a member and invalidates the removed user', async () => {
    project([{ userId: 'm1', role: 'member' }])
    mockMemberDelete.mockResolvedValue({ id: 'pm-1' } as never)
    const result = await removeProjectMember(PID, OWNER, 'm1')
    expect(mockMemberDelete).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId_userId: { projectId: PID, userId: 'm1' } } })
    )
    if ('removedUserId' in result) {
      expect(result.removedUserId).toBe('m1')
      expect([...result.userIdsToInvalidate]).toEqual(['m1'])
    } else {
      throw new Error('expected success')
    }
  })

  it('admin can remove a plain member', async () => {
    project([{ userId: ADMIN, role: 'admin' }, { userId: 'm1', role: 'member' }])
    mockMemberDelete.mockResolvedValue({ id: 'pm-1' } as never)
    expect('removedUserId' in (await removeProjectMember(PID, ADMIN, 'm1'))).toBe(true)
  })
})

describe('updateProjectMemberRole', () => {
  const OWNER = 'owner-1'
  const ADMIN = 'admin-1'
  const PID = 'proj-1'

  beforeEach(() => vi.clearAllMocks())

  function project(members: Array<{ userId: string; role: string }>) {
    mockProjectFindUnique.mockResolvedValue({ id: PID, ownerId: OWNER, members } as never)
  }

  it('returns not_found when the project is missing', async () => {
    mockProjectFindUnique.mockResolvedValue(null as never)
    expect(await updateProjectMemberRole(PID, OWNER, 'm1', 'admin')).toEqual({ error: 'not_found' })
  })

  it('forbids an admin (only the owner changes roles)', async () => {
    project([{ userId: ADMIN, role: 'admin' }, { userId: 'm1', role: 'member' }])
    expect(await updateProjectMemberRole(PID, ADMIN, 'm1', 'admin')).toEqual({ error: 'forbidden' })
    expect(mockMemberUpdate).not.toHaveBeenCalled()
  })

  it('rejects an invalid role', async () => {
    project([{ userId: 'm1', role: 'member' }])
    expect(await updateProjectMemberRole(PID, OWNER, 'm1', 'boss' as never)).toMatchObject({ error: 'invalid' })
  })

  it('refuses to change the owner role', async () => {
    project([{ userId: 'm1', role: 'member' }])
    expect(await updateProjectMemberRole(PID, OWNER, OWNER, 'member')).toMatchObject({ error: 'invalid' })
  })

  it('returns member_not_found for a non-member target', async () => {
    project([{ userId: 'm1', role: 'member' }])
    expect(await updateProjectMemberRole(PID, OWNER, 'ghost', 'admin')).toEqual({ error: 'member_not_found' })
  })

  it('owner promotes a member to admin', async () => {
    project([{ userId: 'm1', role: 'member' }])
    mockMemberUpdate.mockResolvedValue({ id: 'pm-1', role: 'admin' } as never)
    const result = await updateProjectMemberRole(PID, OWNER, 'm1', 'admin')
    expect(mockMemberUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId_userId: { projectId: PID, userId: 'm1' } },
        data: { role: 'admin' },
      })
    )
    expect('member' in result).toBe(true)
  })
})

// Project sharing (invitation-based) — board #3 write side reusing the
// generic Invitation system.
describe('getProjectMembers', () => {
  const OWNER = 'owner-1'
  const PID = 'proj-1'
  beforeEach(() => vi.clearAllMocks())

  function project(members: Array<{ userId: string; role: string; user?: any }>, owner = { id: OWNER, name: 'Owner', email: 'owner@x.com', image: null, isAIAgent: false }) {
    mockProjectFindUnique.mockResolvedValue({ ownerId: OWNER, owner, members } as never)
  }

  it('returns not_found when the project is missing', async () => {
    mockProjectFindUnique.mockResolvedValue(null as never)
    expect(await getProjectMembers(PID, OWNER)).toEqual({ error: 'not_found' })
  })

  it('forbids a non-owner non-member', async () => {
    project([])
    mockInviteFindMany.mockResolvedValue([] as never)
    expect(await getProjectMembers(PID, 'stranger')).toEqual({ error: 'forbidden' })
  })

  it('returns owner + members + pending invites, deduped, with userRole', async () => {
    project([
      { userId: OWNER, role: 'admin', user: { id: OWNER, name: 'Owner', email: 'owner@x.com', image: null, isAIAgent: false } },
      { userId: 'm1', role: 'member', user: { id: 'm1', name: 'M1', email: 'm1@x.com', image: null, isAIAgent: false } },
    ])
    mockInviteFindMany.mockResolvedValue([
      { id: 'i1', email: 'pending@x.com', role: 'member', createdAt: new Date(0) },
      { id: 'i2', email: 'm1@x.com', role: 'admin', createdAt: new Date(0) }, // already a member → excluded
    ] as never)

    const result = await getProjectMembers(PID, OWNER)
    if ('members' in result) {
      expect(result.userRole).toBe('owner')
      const owner = result.members.find((m) => m.role === 'owner')
      expect(owner?.user_id).toBe(OWNER)
      // owner appears once (not duplicated by their admin membership row)
      expect(result.members.filter((m) => m.user_id === OWNER)).toHaveLength(1)
      expect(result.members.find((m) => m.type === 'invite')?.email).toBe('pending@x.com')
      expect(result.members.some((m) => m.email === 'm1@x.com' && m.type === 'invite')).toBe(false)
    } else {
      throw new Error('expected members')
    }
  })

  it('reports member userRole for a plain member viewer', async () => {
    project([{ userId: 'm1', role: 'member', user: { id: 'm1', email: 'm1@x.com' } }])
    mockInviteFindMany.mockResolvedValue([] as never)
    const result = await getProjectMembers(PID, 'm1')
    expect('members' in result && result.userRole).toBe('member')
  })
})

describe('inviteProjectMemberByEmail', () => {
  const OWNER = 'owner-1'
  const ADMIN = 'admin-1'
  const PID = 'proj-1'
  beforeEach(() => vi.clearAllMocks())

  function project(members: Array<{ userId: string; role: string }> = []) {
    mockProjectFindUnique.mockResolvedValue({ ownerId: OWNER, name: 'Board', members } as never)
  }

  it('not_found when project missing', async () => {
    mockProjectFindUnique.mockResolvedValue(null as never)
    expect(await inviteProjectMemberByEmail(PID, OWNER, { email: 'a@x.com' })).toEqual({ error: 'not_found' })
  })

  it('forbids non-owner/admin', async () => {
    project([])
    expect(await inviteProjectMemberByEmail(PID, 'stranger', { email: 'a@x.com' })).toEqual({ error: 'forbidden' })
  })

  it('forbids an admin inviting as admin', async () => {
    project([{ userId: ADMIN, role: 'admin' }])
    expect(await inviteProjectMemberByEmail(PID, ADMIN, { email: 'a@x.com', role: 'admin' })).toEqual({ error: 'forbidden' })
    expect(mockInviteCreate).not.toHaveBeenCalled()
  })

  it('rejects a duplicate pending invite', async () => {
    project([])
    mockInviteFindFirst.mockResolvedValue({ id: 'x' } as never)
    expect(await inviteProjectMemberByEmail(PID, OWNER, { email: 'a@x.com' })).toMatchObject({ error: 'invalid' })
    expect(mockInviteCreate).not.toHaveBeenCalled()
  })

  it('creates a PROJECT_SHARING invitation (lowercased email) and returns the token', async () => {
    project([])
    mockInviteFindFirst.mockResolvedValue(null as never)
    mockInviteCreate.mockResolvedValue({ id: 'inv1' } as never)
    const result = await inviteProjectMemberByEmail(PID, OWNER, { email: 'New@X.com', role: 'member' })
    expect(mockInviteCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: 'new@x.com', type: 'PROJECT_SHARING', status: 'PENDING', projectId: PID, role: 'member', senderId: OWNER }),
      })
    )
    if ('token' in result) {
      expect(result.token).toMatch(/^inv_/)
      expect(result.projectName).toBe('Board')
    } else {
      throw new Error('expected token')
    }
  })
})

describe('cancelProjectInvite / updateProjectInviteRole', () => {
  const OWNER = 'owner-1'
  const ADMIN = 'admin-1'
  const PID = 'proj-1'
  beforeEach(() => vi.clearAllMocks())

  function project(members: Array<{ userId: string; role: string }> = []) {
    mockProjectFindUnique.mockResolvedValue({ ownerId: OWNER, members } as never)
  }

  it('cancel: forbids non-member, 404 when none deleted, success otherwise', async () => {
    project([])
    expect(await cancelProjectInvite(PID, 'stranger', 'a@x.com')).toEqual({ error: 'forbidden' })
    mockInviteDeleteMany.mockResolvedValue({ count: 0 } as never)
    expect(await cancelProjectInvite(PID, OWNER, 'a@x.com')).toEqual({ error: 'not_found' })
    mockInviteDeleteMany.mockResolvedValue({ count: 1 } as never)
    expect(await cancelProjectInvite(PID, OWNER, 'A@x.com')).toEqual({ success: true })
    expect(mockInviteDeleteMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ email: 'a@x.com', type: 'PROJECT_SHARING', status: 'PENDING' }) })
    )
  })

  it('updateRole: admin cannot set admin; owner can; 404 when none updated', async () => {
    project([{ userId: ADMIN, role: 'admin' }])
    expect(await updateProjectInviteRole(PID, ADMIN, 'a@x.com', 'admin')).toEqual({ error: 'forbidden' })
    mockInviteUpdateMany.mockResolvedValue({ count: 0 } as never)
    expect(await updateProjectInviteRole(PID, OWNER, 'a@x.com', 'member')).toEqual({ error: 'not_found' })
    mockInviteUpdateMany.mockResolvedValue({ count: 1 } as never)
    expect(await updateProjectInviteRole(PID, OWNER, 'a@x.com', 'admin')).toEqual({ success: true })
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
