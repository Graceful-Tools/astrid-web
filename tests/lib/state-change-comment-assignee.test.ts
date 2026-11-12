/**
 * AWTD-1619 — "Activity log says 'reassigned from Unassigned to Unassigned'
 * when the task had an assignee".
 *
 * The update verb reads the pre-write row with TASK_UPDATE_EXISTING_INCLUDE,
 * which carries `assigneeId` but not the `assignee` relation. The tracker named
 * the old assignee from that missing relation, so every reassignment away from
 * a person read "from Unassigned". The previous assignee is now looked up when
 * the row did not carry it, and a write that leaves the assignee as it was —
 * `undefined` on one side, `null` on the other — logs no line.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    comment: { create: vi.fn(async ({ data }: { data: unknown }) => data) },
  },
}))

import { prisma } from '@/lib/prisma'
import { recordStateChangeComment } from '@/lib/task-update-handler'
import type { TaskWithRelations } from '@/lib/task-state-change-tracker'

const mockPrisma = vi.mocked(prisma, true)

const base = {
  id: 'task-1',
  title: 'Toasts from 16 screens never appear',
  description: null,
  priority: 1,
  dueDateTime: null,
  repeating: 'never',
  repeatingData: null,
  repeatFrom: 'COMPLETION_DATE',
  completed: false,
  lists: [{ id: 'board', name: 'Astrid Web To-do' }],
} as unknown as TaskWithRelations

function createdContent(): string | undefined {
  const call = mockPrisma.comment.create.mock.calls[0]
  return (call?.[0] as { data: { content: string } } | undefined)?.data.content
}

describe('reassignment activity line (AWTD-1619)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('names the previous assignee even when the pre-write row did not load the relation', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ name: 'Jon Paris' } as never)
    // The shape updateTaskWithSideEffects reads: assigneeId, no `assignee` key.
    const existingTask = { ...base, assigneeId: 'jon', statusRole: null } as TaskWithRelations
    const updatedTask = { ...base, assigneeId: null, assignee: null, statusRole: 'ready' } as TaskWithRelations

    await recordStateChangeComment({ existingTask, updatedTask, updaterName: 'Jon Paris' })

    expect(createdContent()).toBe('Jon Paris reassigned from Jon Paris to Unassigned')
  })

  it('logs nothing when the assignee did not change (undefined vs null)', async () => {
    const existingTask = { ...base, assigneeId: undefined, statusRole: null } as unknown as TaskWithRelations
    const updatedTask = { ...base, assigneeId: null, assignee: null, statusRole: 'ready' } as TaskWithRelations

    const comment = await recordStateChangeComment({ existingTask, updatedTask, updaterName: 'Jon Paris' })

    expect(comment).toBeNull()
    expect(mockPrisma.comment.create).not.toHaveBeenCalled()
  })

  it('logs nothing for a status move that keeps the assignee', async () => {
    const existingTask = { ...base, assigneeId: 'jon', statusRole: null } as TaskWithRelations
    const updatedTask = {
      ...base, assigneeId: 'jon', assignee: { id: 'jon', name: 'Jon Paris' }, statusRole: 'ready',
    } as TaskWithRelations

    const comment = await recordStateChangeComment({ existingTask, updatedTask, updaterName: 'Jon Paris' })

    expect(comment).toBeNull()
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
  })
})
