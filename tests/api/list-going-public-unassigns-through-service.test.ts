/**
 * AWTD-1109 — a list going PUBLIC unassigns its tasks through the task service.
 *
 * It was one raw `task.updateMany({ assigneeId: null })` inside the list's
 * transaction: no task events, no SSE to whoever had the task open, no reminder
 * reschedule, no cache invalidation, and an agent that had been assigned kept
 * its coding workflow running. Each task now goes through
 * `updateTaskWithSideEffects`, after the list change has committed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const updateTaskWithSideEffects = vi.hoisted(() =>
  vi.fn(async (args: { taskId: string }) => ({ ok: true, task: { id: args.taskId }, rolledForward: false })),
)

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/services/task.service', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  updateTaskWithSideEffects,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: { update: vi.fn(), findUnique: vi.fn() },
    listMember: { deleteMany: vi.fn(), create: vi.fn() },
    task: { findMany: vi.fn(), updateMany: vi.fn() },
    user: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}))

import { PUT } from '@/app/api/lists/[id]/route'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

const owner = { id: 'user-123', email: 'owner@example.com', name: 'Owner' }

const existingList = {
  id: 'list-123',
  name: 'Soon public',
  ownerId: owner.id,
  listType: 'regular',
  privacy: 'PRIVATE',
  admins: [],
  members: [],
  listMembers: [],
}

function put(body: unknown) {
  return PUT(
    new NextRequest('http://localhost/api/lists/list-123', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: { id: 'list-123' } } as any,
  )
}

describe('a list going public unassigns its tasks through the service (AWTD-1109)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getServerSession).mockResolvedValue({ user: owner } as any)
    ;(prisma.$transaction as any).mockImplementation((operation: any) => operation(prisma))
    vi.mocked(prisma.taskList.findUnique).mockResolvedValue(existingList as any)
    vi.mocked(prisma.taskList.update).mockResolvedValue({
      ...existingList,
      privacy: 'PUBLIC',
      owner,
      listMembers: [],
      _count: { tasks: 2 },
    } as any)
    vi.mocked(prisma.task.findMany).mockResolvedValue([{ id: 'task-a' }, { id: 'task-b' }] as any)
  })

  it('unassigns each assigned task via updateTaskWithSideEffects, not a raw updateMany (AWTD-1109)', async () => {
    const res = await put({ name: 'Soon public', privacy: 'PUBLIC' })

    expect(res.status).toBe(200)
    expect(prisma.task.updateMany).not.toHaveBeenCalled()
    expect(prisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { lists: { some: { id: 'list-123' } }, assigneeId: { not: null } },
      }),
    )
    const calls = updateTaskWithSideEffects.mock.calls.map(([args]) => args)
    expect(calls.map(call => call.taskId).sort()).toEqual(['task-a', 'task-b'])
    for (const call of calls) {
      expect(call).toMatchObject({ actorId: owner.id, intent: { assigneeId: null } })
    }
  })

  it('one task failing to unassign does not fail the list update (AWTD-1109)', async () => {
    updateTaskWithSideEffects.mockImplementationOnce(async () => {
      throw new Error('boom')
    })

    const res = await put({ name: 'Soon public', privacy: 'PUBLIC' })

    expect(res.status).toBe(200)
    expect(updateTaskWithSideEffects).toHaveBeenCalledTimes(2)
  })

  it('a list that was already public unassigns nothing (AWTD-1109)', async () => {
    vi.mocked(prisma.taskList.findUnique).mockResolvedValue({ ...existingList, privacy: 'PUBLIC' } as any)

    await put({ name: 'Still public', privacy: 'PUBLIC' })

    expect(updateTaskWithSideEffects).not.toHaveBeenCalled()
    expect(prisma.task.updateMany).not.toHaveBeenCalled()
  })
})
