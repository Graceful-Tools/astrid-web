import { describe, expect, it, vi } from 'vitest'

const reconcileAgentLifecycleAfterTaskMutation = vi.hoisted(() => vi.fn())
const reconcileAgentLifecycleBoard = vi.hoisted(() => vi.fn())

vi.mock('@/lib/agent-lifecycle', () => ({
  reconcileAgentLifecycleAfterTaskMutation,
  reconcileAgentLifecycleBoard,
}))
vi.unmock('@/lib/agent-lifecycle-mutations')

import {
  reconcileBoardLifecycleAfterMutation,
  reconcileTaskLifecycleAfterMutation,
} from '@/lib/agent-lifecycle-mutations'

describe('agent lifecycle mutation boundary (AWTD-760)', () => {
  it('passes task completion context to the reconciler', async () => {
    reconcileAgentLifecycleAfterTaskMutation.mockResolvedValue({
      scanned: 2,
      transitioned: 1,
      unchanged: 1,
    })

    await expect(
      reconcileTaskLifecycleAfterMutation('task-1', { completed: true }),
    ).resolves.toMatchObject({ transitioned: 1 })
    expect(reconcileAgentLifecycleAfterTaskMutation).toHaveBeenCalledWith(
      'task-1',
      { completed: true },
    )
  })

  it('propagates reconciliation failures to mutation callers', async () => {
    reconcileAgentLifecycleAfterTaskMutation.mockRejectedValue(
      new Error('reconciliation unavailable'),
    )

    await expect(
      reconcileTaskLifecycleAfterMutation('task-1'),
    ).rejects.toThrow('reconciliation unavailable')
  })

  it('delegates board opt-in reconciliation', async () => {
    reconcileAgentLifecycleBoard.mockResolvedValue({
      scanned: 0,
      transitioned: 0,
      unchanged: 0,
    })

    await reconcileBoardLifecycleAfterMutation('board-1')
    expect(reconcileAgentLifecycleBoard).toHaveBeenCalledWith('board-1')
  })
})
