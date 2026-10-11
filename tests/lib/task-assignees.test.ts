/**
 * Multiple assignees (AWTD-1190, spec §9.5): `assigneeId` is always
 * `assigneeIds[0]`, and an old client that only knows `assigneeId` replaces
 * the first entry without unassigning anyone else.
 */
import { describe, it, expect } from 'vitest'
import { assigneeIdsOf, nextAssigneeIds, MAX_ASSIGNEES } from '@/lib/task-assignees'

describe('assigneeIdsOf (AWTD-1190)', () => {
  it('a task that has only ever had assigneeId reads as [assigneeId]', () => {
    expect(assigneeIdsOf({ assigneeId: 'a', assigneeIds: [] })).toEqual(['a'])
    expect(assigneeIdsOf({ assigneeId: 'a' })).toEqual(['a'])
  })

  it('assigneeId is first whatever the stored list says', () => {
    expect(assigneeIdsOf({ assigneeId: 'b', assigneeIds: ['a', 'b', 'c'] })).toEqual(['b', 'a', 'c'])
  })

  it('nobody assigned is an empty list', () => {
    expect(assigneeIdsOf({ assigneeId: null, assigneeIds: ['a'] })).toEqual([])
  })
})

describe('nextAssigneeIds (AWTD-1190)', () => {
  const multi = { multiple: true }

  it('an old client setting assigneeId replaces ONLY the first entry', () => {
    expect(nextAssigneeIds({ current: ['a', 'b', 'c'], intent: { assigneeId: 'z' }, ...multi })).toEqual({
      ok: true,
      assigneeIds: ['z', 'b', 'c'],
      added: ['z'],
    })
  })

  it('setting assigneeId to someone already further down moves them up, once', () => {
    expect(nextAssigneeIds({ current: ['a', 'b', 'c'], intent: { assigneeId: 'c' }, ...multi })).toMatchObject({
      assigneeIds: ['c', 'b'],
      added: [],
    })
  })

  it('an old client clearing assigneeId removes the first entry and promotes the next', () => {
    expect(nextAssigneeIds({ current: ['a', 'b'], intent: { assigneeId: null }, ...multi })).toMatchObject({
      assigneeIds: ['b'],
      added: [],
    })
  })

  it('assigneeIds replaces the whole list, in order, without duplicates', () => {
    expect(nextAssigneeIds({ current: ['a'], intent: { assigneeIds: ['b', 'a', 'b'] }, ...multi })).toEqual({
      ok: true,
      assigneeIds: ['b', 'a'],
      added: ['b'],
    })
  })

  it('assigneeIds and assigneeId together must agree on who is first', () => {
    expect(nextAssigneeIds({ current: [], intent: { assigneeId: 'a', assigneeIds: ['a', 'b'] }, ...multi })).toMatchObject({ ok: true })
    expect(nextAssigneeIds({ current: [], intent: { assigneeId: 'b', assigneeIds: ['a', 'b'] }, ...multi })).toEqual({
      ok: false,
      error: 'assignee_ids_mismatch',
    })
  })

  it('a classic list keeps at most one assignee', () => {
    expect(nextAssigneeIds({ current: ['a'], intent: { assigneeIds: ['a', 'b'] }, multiple: false })).toEqual({
      ok: false,
      error: 'multiple_assignees_not_supported',
    })
    expect(nextAssigneeIds({ current: ['a'], intent: { assigneeIds: ['b'] }, multiple: false })).toMatchObject({ assigneeIds: ['b'] })
  })

  it('a task that left its GitHub board drops to one assignee on its next assignment', () => {
    expect(nextAssigneeIds({ current: ['a', 'b'], intent: { assigneeId: 'z' }, multiple: false })).toMatchObject({ assigneeIds: ['z'] })
    expect(nextAssigneeIds({ current: ['a', 'b'], intent: { assigneeId: null }, multiple: false })).toMatchObject({ assigneeIds: [] })
  })

  it(`refuses more than GitHub's ${MAX_ASSIGNEES}, and anything that is not a list of ids`, () => {
    const eleven = Array.from({ length: MAX_ASSIGNEES + 1 }, (_, i) => `u${i}`)
    expect(nextAssigneeIds({ current: [], intent: { assigneeIds: eleven }, ...multi })).toEqual({ ok: false, error: 'too_many_assignees' })
    expect(nextAssigneeIds({ current: [], intent: { assigneeIds: 'a' }, ...multi })).toEqual({ ok: false, error: 'invalid_assignee_ids' })
    expect(nextAssigneeIds({ current: [], intent: { assigneeIds: ['a', ''] }, ...multi })).toEqual({ ok: false, error: 'invalid_assignee_ids' })
  })

  it('an intent that names no assignee changes nothing', () => {
    expect(nextAssigneeIds({ current: ['a', 'b'], intent: {}, ...multi })).toEqual({ ok: true, assigneeIds: ['a', 'b'], added: [] })
  })
})
