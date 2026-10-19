/**
 * AWTD-1275 — the Ready / Doing / Waiting chips in task details appeared to do
 * nothing.
 *
 * The move was saved (PUT answered 200 with the new `statusRole`), but
 * `TaskDetail` is memoised with a hand-written comparator that lists the fields
 * worth a re-render, and `statusRole` was not one of them. So neither the
 * optimistic update nor the server's answer reached the pane: the chip stayed
 * on Inbox until something else about the task changed.
 */
import { describe, it, expect } from 'vitest'
import { taskDetailPropsEqual } from '@/components/task-detail/task-detail-props-equal'
import { buildTask, buildUser } from '../../fixtures/domain'

const currentUser = buildUser({ id: 'user-1' })
// One base task: buildTask fills fields afresh on every call.
const base = buildTask({ id: 'task-1' })

function props(taskOverrides: Record<string, unknown> = {}, rest: Record<string, unknown> = {}) {
  return { task: { ...base, ...taskOverrides }, currentUser, ...rest } as any
}

describe('AWTD-1275: TaskDetail re-renders when its board state changes', () => {
  it('AWTD-1275: a new statusRole is a change', () => {
    expect(taskDetailPropsEqual(props({ statusRole: null }), props({ statusRole: 'ready' }))).toBe(false)
  })

  it('AWTD-1275: moving between two statuses is a change', () => {
    expect(taskDetailPropsEqual(props({ statusRole: 'ready' }), props({ statusRole: 'doing' }))).toBe(false)
  })

  it('AWTD-1275: becoming read-only or switching display mode is a change', () => {
    expect(taskDetailPropsEqual(props({}, { readOnly: false }), props({}, { readOnly: true }))).toBe(false)
    expect(taskDetailPropsEqual(props({}, { displayMode: 'list' }), props({}, { displayMode: 'project' }))).toBe(false)
  })

  it('an identical task is still not a re-render', () => {
    expect(taskDetailPropsEqual(props({ statusRole: 'ready' }), props({ statusRole: 'ready' }))).toBe(true)
  })
})
