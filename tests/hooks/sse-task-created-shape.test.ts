/**
 * AWTD-1497 — a created task from the live stream must land in the web's own
 * shape. task_created carries the agent shape as `task` and the GET's shape as
 * `v1Task`; the create handler stored `task`, which the list view filtered out,
 * so a copy echoed to its own tab vanished from the list until a reload
 * (e2e: "a copy into the same list shows at once"). Updates already prefer
 * v1Task (taskFromUpdateEvent).
 */
import { describe, expect, it } from 'vitest'
import { taskFromCreatedEvent } from '@/hooks/task-manager/sse-task-update'

describe('taskFromCreatedEvent (AWTD-1497)', () => {
  it('prefers v1Task — the shape the board renders', () => {
    const v1 = { id: 't1', title: 'T', lists: [{ id: 'l1' }] }
    expect(taskFromCreatedEvent({ task: { id: 't1', listIds: ['l1'] }, v1Task: v1 })).toEqual(v1)
  })

  it('falls back to task, then to the bare payload, for older events', () => {
    expect(taskFromCreatedEvent({ task: { id: 't2' } })).toEqual({ id: 't2' })
    expect(taskFromCreatedEvent({ id: 't3' })).toEqual({ id: 't3' })
  })

  it('returns null for a payload with no task id', () => {
    expect(taskFromCreatedEvent({})).toBeNull()
    expect(taskFromCreatedEvent(null)).toBeNull()
  })
})
