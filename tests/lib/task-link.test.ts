/**
 * AWTD-1016 — `/t/KEY-N` resolves, checks access, and redirects; a task the
 * reader cannot see answers exactly like one that does not exist.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: { task: { findUnique: vi.fn() } } }))
vi.mock('@/lib/api-auth-middleware', () => ({ requireTaskReadAccess: vi.fn() }))
vi.mock('@/lib/task-identifier', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveTaskIdOrIdentifier: vi.fn(),
}))

import { resolveTaskLink } from '@/lib/task-link'
import { prisma } from '@/lib/prisma'
import { requireTaskReadAccess } from '@/lib/api-auth-middleware'
import { resolveTaskIdOrIdentifier } from '@/lib/task-identifier'

const findUnique = vi.mocked(prisma.task.findUnique)
const resolve = vi.mocked(resolveTaskIdOrIdentifier)
const readAccess = vi.mocked(requireTaskReadAccess)

describe('resolveTaskLink (AWTD-1016)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolve.mockImplementation(async (value: string) => (value.toUpperCase() === 'AWTD-7' ? 'task-uuid' : null))
    readAccess.mockResolvedValue(undefined)
    findUnique.mockResolvedValue({
      lists: [
        { id: 'inbox', projectId: null },
        { id: 'board', projectId: 'project-1' },
      ],
    } as never)
  })

  it('redirects a visible task to its board, preferring the project list (AWTD-1016)', async () => {
    expect(await resolveTaskLink('awtd-7', 'user-1')).toEqual({
      kind: 'redirect',
      href: '/lists/board?task=task-uuid',
    })
  })

  it('a hidden task and a nonexistent one give the same not-found (AWTD-1016)', async () => {
    readAccess.mockRejectedValue(new Error('Access denied to this task'))
    const hidden = await resolveTaskLink('AWTD-7', 'user-1')
    const missing = await resolveTaskLink('AWTD-99999', 'user-1')

    expect(hidden).toEqual({ kind: 'not-found' })
    expect(missing).toEqual(hidden)
  })

  it('sends a signed-out reader to sign in and back, without resolving anything (AWTD-1016)', async () => {
    expect(await resolveTaskLink('AWTD-7', null)).toEqual({
      kind: 'signin',
      href: '/auth/signin?callbackUrl=%2Ft%2FAWTD-7',
    })
    expect(resolve).not.toHaveBeenCalled()
  })

  it('is not a second task URL: a uuid or junk is not-found (AWTD-1016)', async () => {
    expect(await resolveTaskLink('3f2a0c1e-1111-2222-3333-444455556666', 'user-1')).toEqual({ kind: 'not-found' })
    expect(await resolveTaskLink('not an id', 'user-1')).toEqual({ kind: 'not-found' })
  })

  it('a task on no list opens in My Tasks (AWTD-1016)', async () => {
    findUnique.mockResolvedValue({ lists: [] } as never)
    expect(await resolveTaskLink('AWTD-7', 'user-1')).toEqual({ kind: 'redirect', href: '/?task=task-uuid' })
  })
})
