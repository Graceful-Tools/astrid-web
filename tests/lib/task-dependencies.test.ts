/**
 * AWTD-1002 — "waiting on tasks": the decisions that hold the feature together,
 * tested away from the database because that is where they can be stated once.
 *
 * The promotion rule itself is NOT re-tested here. It lives in
 * `classifyWaitingTask` and has its own suite; what is tested here is that this
 * feature CALLS it rather than restating it (see the spec's opening section),
 * plus the three decisions the spec makes that are genuinely new: cycles,
 * re-blocking on reopen, and demotion when a blocker is added.
 */

import { describe, it, expect } from 'vitest'
import { settleWaitingTs } from '@/lib/waiting-rules'
import {
  shouldDemoteOnBlockerAdded,
  shouldReblockOnBlockerReopened,
  wouldCreateDependencyCycle,
} from '@/lib/task-dependencies'

// The gate is astrid-core's Waiting rules now (lib/waiting-rules.ts, Jon 2026-11-12); these are
// the AWTD-1002 cases, asked of the same rule the service applies.
describe('AWTD-1002 blocker gate', () => {
  const now = new Date('2026-09-25T12:00:00.000Z')
  const waiting = (dueDateTime: string | null) => ({ id: 't', statusRole: 'waiting', dueDateTime, assigneeId: null })

  it('holds a task whose blockers are outstanding, even once its date has arrived', () => {
    expect(settleWaitingTs(waiting('2026-09-01T00:00:00.000Z'), [{ id: 'blocker-1', completed: false }], now).action).toBe('stay')
  })

  it('holds a task whose blockers are clear but whose date has not arrived', () => {
    expect(settleWaitingTs(waiting('2026-12-01T00:00:00.000Z'), [{ id: 'blocker-1', completed: true }], now).action).toBe('stay')
  })

  it('promotes when every blocker is complete and the date has arrived', () => {
    expect(settleWaitingTs(waiting('2026-09-01T00:00:00.000Z'), [{ id: 'blocker-1', completed: true }], now)).toEqual({
      action: 'wakeToReady',
      statusRole: 'ready',
      assignee: 'keep',
    })
  })

  it('promotes a dated-less task the moment its last blocker clears', () => {
    expect(settleWaitingTs(waiting(null), [{ id: 'blocker-1', completed: true }], now).action).toBe('wakeToReady')
  })
})

describe('AWTD-1002 cycle refusal', () => {
  /** blocked -> [blockers], the direction the walk follows. */
  const graph: Record<string, string[]> = {
    a: ['b'],
    b: ['c'],
    c: [],
    lonely: [],
  }
  const blockersOf = async (taskId: string) => graph[taskId] ?? []

  it('refuses a task blocking itself', async () => {
    await expect(
      wouldCreateDependencyCycle({ blockedTaskId: 'a', blockingTaskId: 'a', blockersOf }),
    ).resolves.toBe(true)
  })

  it('refuses an edge that closes a longer loop', async () => {
    // c is already reachable from a (a -> b -> c); blocking c on a closes it.
    await expect(
      wouldCreateDependencyCycle({ blockedTaskId: 'c', blockingTaskId: 'a', blockersOf }),
    ).resolves.toBe(true)
  })

  it('allows an edge that only deepens the chain', async () => {
    await expect(
      wouldCreateDependencyCycle({ blockedTaskId: 'c', blockingTaskId: 'lonely', blockersOf }),
    ).resolves.toBe(false)
  })

  it('terminates on a graph that already contains a cycle', async () => {
    const broken: Record<string, string[]> = { x: ['y'], y: ['x'] }
    await expect(
      wouldCreateDependencyCycle({
        blockedTaskId: 'z',
        blockingTaskId: 'x',
        blockersOf: async id => broken[id] ?? [],
      }),
    ).resolves.toBe(false)
  })
})

describe('AWTD-1002 who gets moved', () => {
  it('re-blocks a dependent out of Ready when a blocker is reopened', () => {
    expect(shouldReblockOnBlockerReopened('ready')).toBe(true)
  })

  it('leaves a dependent in Doing, a custom state, or Inbox alone on reopen', () => {
    expect(shouldReblockOnBlockerReopened('doing')).toBe(false)
    expect(shouldReblockOnBlockerReopened('in-review')).toBe(false)
    expect(shouldReblockOnBlockerReopened(null)).toBe(false)
  })

  it('demotes a Ready task to Waiting when a blocker is added to it', () => {
    expect(shouldDemoteOnBlockerAdded('ready')).toBe(true)
  })

  it('does not move a Doing task that acquires a blocker', () => {
    expect(shouldDemoteOnBlockerAdded('doing')).toBe(false)
    expect(shouldDemoteOnBlockerAdded(null)).toBe(false)
  })
})
