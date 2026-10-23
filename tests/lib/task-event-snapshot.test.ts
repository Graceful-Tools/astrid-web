/**
 * The task-update path's event snapshot and notify filter (AWTD-1329).
 */
import { describe, it, expect } from 'vitest'
import { notifiableUpdateEvents, taskEventSnapshot } from '@/lib/task-event-snapshot'

describe('taskEventSnapshot (AWTD-1329)', () => {
  it('reads the compared fields off a task row, lists as ids and no status as Inbox', () => {
    expect(taskEventSnapshot({
      title: 'T', completed: false, closedReason: null, priority: 2, assigneeId: 'u',
      dueDateTime: null, lists: [{ id: 'a' }, { id: 'b' }],
    })).toEqual({
      title: 'T', completed: false, closedReason: null, priority: 2, assigneeId: 'u',
      dueDateTime: null, listIds: ['a', 'b'], statusRole: null,
    })
  })
})

describe('notifiableUpdateEvents (AWTD-1329)', () => {
  it('drops a hand-made board move and keeps everything else', () => {
    expect(notifiableUpdateEvents([
      { kind: 'status_changed', from: 'ready', to: 'doing' },
      { kind: 'assigned', from: null, to: 'u' },
      { kind: 'completed', from: false, to: true },
    ]).map(event => event.kind)).toEqual(['assigned', 'completed'])
  })
})
