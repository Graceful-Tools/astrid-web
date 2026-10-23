/**
 * DELETE /api/projects/:id — authorization (AWTD-1341).
 *
 * Only the project's owner may delete it; an admin member or a plain member
 * is refused before anything is touched. When the owner deletes, the domain
 * lists are DETACHED (projectId → null) through lib/projects-service, never
 * deleted with the project.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const getUnifiedSession = vi.hoisted(() => vi.fn())
const projectFindUnique = vi.hoisted(() => vi.fn())
const tx = vi.hoisted(() => ({
  taskList: { updateMany: vi.fn(), deleteMany: vi.fn(), delete: vi.fn() },
  project: { delete: vi.fn() },
}))

vi.mock('@/lib/session-utils', () => ({ getUnifiedSession }))
vi.mock('@/lib/redis', () => ({
  RedisCache: { invalidate: { userListsAllVersions: vi.fn().mockResolvedValue(undefined) } },
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    project: { findUnique: projectFindUnique, delete: vi.fn() },
    taskList: { updateMany: vi.fn(), deleteMany: vi.fn(), delete: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  },
}))
const detachSpy = vi.hoisted(() => ({ fn: undefined as undefined | ReturnType<typeof vi.fn> }))
vi.mock('@/lib/projects-service', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/projects-service')>()
  detachSpy.fn = vi.fn(actual.deleteProjectAndDetachLists)
  return { ...actual, deleteProjectAndDetachLists: detachSpy.fn }
})

import { DELETE } from '@/app/api/projects/[id]/route'

const PROJECT = {
  id: 'project-1',
  ownerId: 'owner-1',
  members: [
    { userId: 'admin-1', role: 'admin' },
    { userId: 'member-1', role: 'member' },
  ],
  lists: [
    { id: 'list-a', listType: 'domain', ownerId: 'owner-1' },
    { id: 'list-b', listType: 'domain', ownerId: 'admin-1' },
    { id: 'status-1', listType: 'status', ownerId: 'owner-1' },
  ],
}

const ctx = { params: Promise.resolve({ id: 'project-1' }) } as never
const del = () => DELETE(new NextRequest('http://localhost/api/projects/project-1', { method: 'DELETE' }), ctx)
const signIn = (id: string | null) =>
  getUnifiedSession.mockResolvedValue(id ? { user: { id } } : null)

function expectUntouched() {
  expect(detachSpy.fn).not.toHaveBeenCalled()
  expect(tx.project.delete).not.toHaveBeenCalled()
  expect(tx.taskList.updateMany).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  projectFindUnique.mockResolvedValue(PROJECT)
})

describe('DELETE /api/projects/:id authorization (AWTD-1341)', () => {
  it('AWTD-1341: refuses a signed-out caller with 401', async () => {
    signIn(null)
    expect((await del()).status).toBe(401)
    expectUntouched()
  })

  it('AWTD-1341: refuses an ADMIN member (not the owner) with 403', async () => {
    signIn('admin-1')
    expect((await del()).status).toBe(403)
    expectUntouched()
  })

  it('AWTD-1341: refuses a plain member with 403', async () => {
    signIn('member-1')
    expect((await del()).status).toBe(403)
    expectUntouched()
  })

  it('AWTD-1341: refuses a stranger with 403', async () => {
    signIn('stranger-1')
    expect((await del()).status).toBe(403)
    expectUntouched()
  })

  it('AWTD-1341: the owner deletes the project and its domain lists are detached, not deleted', async () => {
    signIn('owner-1')
    const res = await del()
    expect(res.status).toBe(200)
    expect(detachSpy.fn).toHaveBeenCalledWith('project-1')
    expect(tx.taskList.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['list-a', 'list-b'] } },
      data: { projectId: null },
    })
    expect(tx.taskList.deleteMany).not.toHaveBeenCalled()
    expect(tx.taskList.delete).not.toHaveBeenCalled()
    expect(tx.project.delete).toHaveBeenCalledWith({ where: { id: 'project-1' } })
    expect(await res.json()).toEqual({ success: true, detachedListIds: ['list-a', 'list-b'] })
  })
})
