/**
 * AWTD-1269: reassigning a task in the web detail pane 400'd with
 * `assignee_ids_mismatch`. The controller PUTs the whole edited task, which
 * still carries the `assigneeIds` it was READ with — so the body said
 * "assigneeId: B" next to "assigneeIds: [A]", and the server (rightly) refused
 * a write that disagreed with itself.
 */
import { describe, it, expect } from 'vitest'
import { v1TaskUpdateBody } from '@/lib/tasks/v1-task-update-body'

const alice = { id: 'alice', name: 'Alice', email: 'a@x.cc' }
const bob = { id: 'bob', name: 'Bob', email: 'b@x.cc' }

const original = {
  id: 't1',
  title: 'Task',
  assignee: alice,
  assigneeId: 'alice',
  assigneeIds: ['alice'],
  lists: [{ id: 'l1' }],
}

describe('v1TaskUpdateBody (AWTD-1269)', () => {
  it('reassigning sends the new assignee without the stale list it was read with', () => {
    const body = v1TaskUpdateBody({ ...original, assignee: bob, assigneeId: 'bob' }, original)
    expect(body.assigneeId).toBe('bob')
    expect(body).not.toHaveProperty('assigneeIds')
  })

  it('unassigning sends null without the stale list', () => {
    const body = v1TaskUpdateBody({ ...original, assignee: null, assigneeId: null }, original)
    expect(body.assigneeId).toBeNull()
    expect(body).not.toHaveProperty('assigneeIds')
  })

  it('an edited assignee list is sent as-is', () => {
    const edited = { ...original, assigneeIds: ['alice', 'bob'] }
    expect(v1TaskUpdateBody(edited, original).assigneeIds).toEqual(['alice', 'bob'])
  })

  it('sends listIds and drops the relation objects', () => {
    const body = v1TaskUpdateBody({ ...original }, original)
    expect(body.listIds).toEqual(['l1'])
    expect(body).not.toHaveProperty('lists')
    expect(body).not.toHaveProperty('assignee')
    expect(body.assigneeId).toBe('alice')
  })
})

/**
 * AWTD-1272: "No due date" on web set `dueDateTime: undefined`, which
 * JSON.stringify drops — and the v1 PUT leaves an absent field alone. Only
 * `isAllDay: false` arrived, so an all-day date became a timed one at UTC
 * midnight (the evening before, west of UTC) instead of going away.
 */
describe('clearing the due date survives the wire (AWTD-1272)', () => {
  const dated = { ...original, dueDateTime: new Date('2026-10-25T00:00:00.000Z'), isAllDay: true }

  it('a date set to undefined is sent as null, which the server reads as "clear"', () => {
    const body = v1TaskUpdateBody({ ...dated, dueDateTime: undefined, isAllDay: false }, dated)
    expect(JSON.parse(JSON.stringify(body)).dueDateTime).toBeNull()
  })

  it('an edit that never mentions the date does not invent a clear', () => {
    const { dueDateTime: _omit, ...withoutDate } = dated
    void _omit
    const body = v1TaskUpdateBody({ ...withoutDate, title: 'renamed' }, dated)
    expect(body).not.toHaveProperty('dueDateTime')
  })
})
