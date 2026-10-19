/**
 * AWTD-1039 check 5 — a card the server moves must move on every open board.
 *
 * Task events carry two shapes: `task` (the agent protocol's, which has no
 * statusRole or lists) and `v1Task` (the web's own). The board merged `task`,
 * so a card the blocker gate moved to Ready stayed in Waiting until a refresh.
 */
import { describe, it, expect } from 'vitest'
import { taskFromUpdateEvent } from '@/hooks/task-manager/sse-task-update'

describe('AWTD-1039: taskFromUpdateEvent', () => {
  it('AWTD-1039: prefers the v1 shape, which carries statusRole', () => {
    const got = taskFromUpdateEvent({
      taskId: 't1',
      task: { id: 't1', title: 'T', listId: 'l1', assignerName: 'A' },
      v1Task: { id: 't1', title: 'T', statusRole: 'ready', lists: [{ id: 'l1' }] },
    })
    expect(got).toMatchObject({ id: 't1', statusRole: 'ready', lists: [{ id: 'l1' }] })
    expect(got).not.toHaveProperty('assignerName')
  })

  it('falls back to the agent shape, then to the bare payload', () => {
    expect(taskFromUpdateEvent({ task: { id: 't1', title: 'T' } })).toEqual({ id: 't1', title: 'T' })
    expect(taskFromUpdateEvent({ id: 't1', title: 'T' })).toEqual({ id: 't1', title: 'T' })
  })

  it('drops comments, which the board keeps from its own fetch', () => {
    expect(taskFromUpdateEvent({ v1Task: { id: 't1', comments: [{ id: 'c' }] } })).toEqual({ id: 't1' })
  })

  it('answers null for a payload with no task id', () => {
    expect(taskFromUpdateEvent({})).toBeNull()
    expect(taskFromUpdateEvent(null)).toBeNull()
  })
})
