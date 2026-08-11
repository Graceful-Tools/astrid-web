import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LIST_SHOW_SUBTASKS,
  shouldShowSubtasksInList,
} from '@/lib/list-subtask-visibility'

// Task dce843a1: TaskList.showSubtasks — the server half the iOS/Mac
// "Per-list show/hide subtasks" companion is blocked on.
//
// The rule this module encodes, stated once so both platforms port the same
// thing: a list can opt OUT of showing subtasks inline, but it cannot opt
// back IN over a user who has chosen detail-only ('under_parent').
describe('shouldShowSubtasksInList', () => {
  it('defaults to showing when neither side has an opinion', () => {
    // The load-bearing case: every list that existed before the column did
    // reads back as null, and must keep rendering its subtasks.
    expect(shouldShowSubtasksInList(null, null)).toBe(true)
    expect(shouldShowSubtasksInList(undefined, undefined)).toBe(true)
  })

  it('DEFAULT_LIST_SHOW_SUBTASKS is the value an absent column stands in for', () => {
    expect(DEFAULT_LIST_SHOW_SUBTASKS).toBe(true)
    expect(shouldShowSubtasksInList(null, 'indented'))
      .toBe(shouldShowSubtasksInList(DEFAULT_LIST_SHOW_SUBTASKS, 'indented'))
  })

  it('a list can opt out — false hides subtasks for an indented user', () => {
    expect(shouldShowSubtasksInList(false, 'indented')).toBe(false)
  })

  it('a list that opts in still shows for an indented user', () => {
    expect(shouldShowSubtasksInList(true, 'indented')).toBe(true)
  })

  it("a list cannot opt back IN over a user's detail-only preference", () => {
    // The asymmetry is the whole point: user preference wins when it is the
    // more restrictive of the two.
    expect(shouldShowSubtasksInList(true, 'under_parent')).toBe(false)
    expect(shouldShowSubtasksInList(null, 'under_parent')).toBe(false)
    expect(shouldShowSubtasksInList(undefined, 'under_parent')).toBe(false)
  })

  it('both opting out is still out', () => {
    expect(shouldShowSubtasksInList(false, 'under_parent')).toBe(false)
  })

  it('an unrecognised user preference is treated as indented, not as hidden', () => {
    // A future client sending a value this build does not know must not
    // silently empty every list.
    expect(shouldShowSubtasksInList(null, 'some-future-mode')).toBe(true)
    expect(shouldShowSubtasksInList(false, 'some-future-mode')).toBe(false)
  })
})

describe('normalizeShowSubtasks', () => {
  it('accepts only booleans, so a whole-object PUT without the key is a no-op', async () => {
    const { normalizeShowSubtasks } = await import('@/lib/list-subtask-visibility')
    expect(normalizeShowSubtasks(true)).toBe(true)
    expect(normalizeShowSubtasks(false)).toBe(false)
    expect(normalizeShowSubtasks(undefined)).toBeUndefined()
    expect(normalizeShowSubtasks(null)).toBeUndefined()
    expect(normalizeShowSubtasks('true')).toBeUndefined()
    expect(normalizeShowSubtasks(1)).toBeUndefined()
    expect(normalizeShowSubtasks(0)).toBeUndefined()
  })
})
