/**
 * Regression test for task 11042ae3 — cancelling an occurrence of a repeating
 * task must NOT roll the series forward.
 *
 * "We're not doing this one" and "this one is done, schedule the next" are
 * opposite intents. Rolling forward on a cancel would resurrect the very task
 * the user just decided to drop — every week, forever.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: { task: { findUnique: vi.fn() } },
}))

vi.mock('@/lib/repeating-task-handler', () => ({
  handleRepeatingTaskCompletion: vi.fn(),
  applyRepeatingTaskRollForward: vi.fn(),
}))

vi.mock('@/lib/task-state-change-tracker', () => ({
  detectTaskStateChanges: vi.fn(() => []),
  formatStateChangesAsComment: vi.fn(() => ''),
}))

import { applyRepeatingTaskCompletion } from '@/lib/task-update-handler'
import {
  handleRepeatingTaskCompletion,
  applyRepeatingTaskRollForward,
} from '@/lib/repeating-task-handler'

const mockDetect = vi.mocked(handleRepeatingTaskCompletion)
const mockApply = vi.mocked(applyRepeatingTaskRollForward)

describe('Cancelling a repeating task (11042ae3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // A repeating series that WOULD roll forward on a normal completion.
    mockDetect.mockResolvedValue({ shouldRollForward: true } as never)
  })

  it('does not roll forward when the task is closed as canceled', async () => {
    const outcome = await applyRepeatingTaskCompletion({
      taskId: 'task-1',
      existingCompleted: false,
      dataCompleted: true,
      closedReason: 'canceled',
    })

    expect(outcome).toEqual({ rolledForward: false })
    expect(mockApply).not.toHaveBeenCalled()
    // Short-circuits before even asking, so no next occurrence is computed.
    expect(mockDetect).not.toHaveBeenCalled()
  })

  it('does not roll forward for any of the terminal reasons', async () => {
    for (const reason of ['canceled', 'duplicate', 'not_planned']) {
      vi.clearAllMocks()
      mockDetect.mockResolvedValue({ shouldRollForward: true } as never)

      const outcome = await applyRepeatingTaskCompletion({
        taskId: 'task-1',
        existingCompleted: false,
        dataCompleted: true,
        closedReason: reason,
      })

      expect(outcome, `reason: ${reason}`).toEqual({ rolledForward: false })
      expect(mockApply, `reason: ${reason}`).not.toHaveBeenCalled()
    }
  })

  it('STILL rolls forward on a normal completion — the guard must be narrow', async () => {
    // The failure mode worth guarding against is over-applying the fix and
    // breaking recurring tasks entirely.
    mockDetect.mockResolvedValue({ shouldRollForward: true } as never)
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.task.findUnique).mockResolvedValue({ id: 'task-1' } as never)

    const outcome = await applyRepeatingTaskCompletion({
      taskId: 'task-1',
      existingCompleted: false,
      dataCompleted: true,
      closedReason: null,
    })

    expect(mockDetect).toHaveBeenCalled()
    expect(mockApply).toHaveBeenCalled()
    expect(outcome.rolledForward).toBe(true)
  })

  it('ignores an unrecognised reason rather than blocking roll-forward', async () => {
    // An unknown string is not a cancel; treating it as one would silently
    // break recurrence for a typo.
    mockDetect.mockResolvedValue({ shouldRollForward: true } as never)
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.task.findUnique).mockResolvedValue({ id: 'task-1' } as never)

    await applyRepeatingTaskCompletion({
      taskId: 'task-1',
      existingCompleted: false,
      dataCompleted: true,
      closedReason: 'not-a-real-reason',
    })

    expect(mockDetect).toHaveBeenCalled()
  })

  it('does nothing when completion is not part of the update', async () => {
    const outcome = await applyRepeatingTaskCompletion({
      taskId: 'task-1',
      existingCompleted: false,
      dataCompleted: undefined,
      closedReason: 'canceled',
    })

    expect(outcome).toEqual({ rolledForward: false })
  })
})
