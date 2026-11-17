/**
 * ADEV-56: completing a task that is not assigned to you asks first —
 * INCLUDING a task assigned to nobody.
 *
 * Jon: "show confirmation before completing a task that isn't [assigned to
 * me] (including unassigned)." AWTD-877 already asked before finishing
 * SOMEONE ELSE'S work; an unassigned task was deliberately left out then
 * ("there is no one whose work you would be finishing"). ADEV-56 reverses
 * that half: the rule is now "is it mine?", not "is it theirs?".
 *
 * Reopening never asks — undoing a completion takes nothing from anyone.
 */
import { describe, it, expect } from 'vitest'
import { completionNeedsConfirmation } from '@/lib/task-leading-control'

const ME = 'user-me'
const THEM = 'user-them'

describe('completionNeedsConfirmation (ADEV-56)', () => {
  it('asks before completing somebody else\'s task', () => {
    expect(completionNeedsConfirmation({ assigneeId: THEM, currentUserId: ME })).toBe(true)
  })

  it('asks before completing an unassigned task, however the API spells it', () => {
    expect(completionNeedsConfirmation({ assigneeId: null, currentUserId: ME })).toBe(true)
    expect(completionNeedsConfirmation({ assigneeId: undefined, currentUserId: ME })).toBe(true)
    expect(completionNeedsConfirmation({ assigneeId: '', currentUserId: ME })).toBe(true)
  })

  it('never asks before completing your own task', () => {
    expect(completionNeedsConfirmation({ assigneeId: ME, currentUserId: ME })).toBe(false)
  })

  it('never asks before reopening, whoever the task belongs to', () => {
    for (const assigneeId of [ME, THEM, null, '']) {
      expect(
        completionNeedsConfirmation({ assigneeId, currentUserId: ME, completed: true }),
      ).toBe(false)
    }
  })

  it('asks when it cannot tell who is looking', () => {
    expect(completionNeedsConfirmation({ assigneeId: THEM, currentUserId: undefined })).toBe(true)
  })
})
