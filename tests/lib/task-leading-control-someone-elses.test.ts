/**
 * AWTD-877 (web half of astrid-ios AITD-375): someone else's task gets the
 * options popover on EVERY surface, and completing it always confirms first.
 *
 * Jon, for both platforms: "When not yours, always confirm before completing.
 * On web and iOS it should give the popover to show assignment, complete,
 * priority and status options just like in project mode."
 *
 * Web had two different answers to the same question and both were wrong in
 * opposite directions. On a row the avatar was inert (task 2bb1b196) — safe,
 * but it also withheld the things you probably reached for: reassign,
 * reprioritise, move column. In details `leadingControlConfirmsCompletion`
 * (task 43bcc76c) grew a bespoke confirm-on-tap that existed on that one
 * surface and nowhere else.
 *
 * The popover answers both. It cannot finish anyone's work by accident, it
 * carries the actions you wanted, and completion is still there behind a
 * confirmation that names the assignee.
 *
 * The simplification worth noticing: the confirmation is a property of WHOSE
 * TASK IT IS, not of where you are standing, so it no longer takes a surface
 * or a mark — which is why `leadingControlConfirmsCompletion` is gone.
 */
import { describe, it, expect } from 'vitest'
import {
  completionNeedsConfirmation,
  isSomeoneElsesTask,
  leadingControlOpensOptions,
} from '@/lib/task-leading-control'

const ME = 'user-me'
const THEM = 'user-them'

describe('isSomeoneElsesTask (AWTD-877)', () => {
  it('is someone else\'s when the assignee is not the viewer', () => {
    expect(isSomeoneElsesTask({ assigneeId: THEM, currentUserId: ME })).toBe(true)
  })

  it('is not someone else\'s when it is yours', () => {
    expect(isSomeoneElsesTask({ assigneeId: ME, currentUserId: ME })).toBe(false)
  })

  it('treats an unassigned task as nobody\'s, including the API\'s empty string', () => {
    // Trap 2 from the iOS half: '' is how the API says unassigned, not just
    // null. A confirmation dialog names the assignee, so on a task nobody owns
    // it would be a prompt with no subject.
    expect(isSomeoneElsesTask({ assigneeId: null, currentUserId: ME })).toBe(false)
    expect(isSomeoneElsesTask({ assigneeId: undefined, currentUserId: ME })).toBe(false)
    expect(isSomeoneElsesTask({ assigneeId: '', currentUserId: ME })).toBe(false)
  })

  it('counts an unknown viewer as "not yours"', () => {
    // Trap 3: if currentUserId is absent you cannot show the task is theirs,
    // and the safe answer is the one that asks.
    expect(isSomeoneElsesTask({ assigneeId: THEM, currentUserId: undefined })).toBe(true)
    expect(isSomeoneElsesTask({ assigneeId: THEM, currentUserId: null })).toBe(true)
  })
})

describe('leadingControlOpensOptions with someone else\'s task (AWTD-877)', () => {
  it('opens the options popover on a plain list row, where the avatar used to be inert', () => {
    expect(
      leadingControlOpensOptions({ displayMode: 'list', onBoard: false, isSomeoneElses: true }),
    ).toBe(true)
  })

  it('wins on every surface, so the three of them cannot disagree', () => {
    for (const displayMode of ['list', 'project']) {
      for (const onBoard of [false, true]) {
        expect(
          leadingControlOpensOptions({ displayMode, onBoard, isSomeoneElses: true }),
        ).toBe(true)
      }
    }
  })

  it('changes nothing for your own task or an unassigned one', () => {
    expect(
      leadingControlOpensOptions({ displayMode: 'list', onBoard: false, isSomeoneElses: false }),
    ).toBe(false)
    expect(leadingControlOpensOptions({ displayMode: 'list', onBoard: false })).toBe(false)
    expect(leadingControlOpensOptions({ displayMode: 'project', onBoard: false })).toBe(true)
    expect(leadingControlOpensOptions({ displayMode: 'list', onBoard: true })).toBe(true)
  })
})

describe('completionNeedsConfirmation (AWTD-877)', () => {
  it('confirms before finishing work assigned to somebody else', () => {
    expect(completionNeedsConfirmation({ assigneeId: THEM, currentUserId: ME })).toBe(true)
  })

  it('never confirms your own completion, in any display mode', () => {
    // Trap 1: in project mode your OWN task wears your photo, so keying the
    // confirmation off the avatar MARK would make people confirm their own
    // completions. This compares ids, not marks — there is no display mode to
    // pass, which is the point.
    expect(completionNeedsConfirmation({ assigneeId: ME, currentUserId: ME })).toBe(false)
  })

  it('does not confirm an unassigned task', () => {
    expect(completionNeedsConfirmation({ assigneeId: null, currentUserId: ME })).toBe(false)
    expect(completionNeedsConfirmation({ assigneeId: '', currentUserId: ME })).toBe(false)
  })

  it('asks when it cannot tell who is looking', () => {
    expect(completionNeedsConfirmation({ assigneeId: THEM, currentUserId: undefined })).toBe(true)
  })
})
