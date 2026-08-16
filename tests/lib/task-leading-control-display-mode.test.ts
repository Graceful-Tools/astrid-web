/**
 * The leading control changes with the task display mode (task ffa5bbb5).
 *
 * Jon: "In project view we compact the task details so priority and assignee
 * and complete/mark as incomplete are accessed by tapping on the checkbox.
 * Instead of completing the task a popover with these options is revealed. In
 * project mode, tasks assigned to you should also show your profile photo."
 *
 * TWO INDEPENDENT CHANGES, and keeping them separate is the point of this file.
 *
 *   1. The MARK. Today "assigned to you" renders the checkbox and only someone
 *      else's task renders a photo. In project mode your own task shows YOUR
 *      photo too — "also" in Jon's sentence, i.e. in addition to the existing
 *      avatar case, not instead of it.
 *
 *   2. The ACTION. lib/task-leading-control.ts has said since task 2bb1b196
 *      that "the MARK changes between the three; the ACTION does not — tapping
 *      any of them completes the task." Project mode is the first thing that
 *      makes the action vary, so that sentence is now conditional and the
 *      module says so.
 *
 * List mode must be untouched by all of this: it is what every existing user
 * has, and it is the default. The cases below assert the current behaviour
 * still holds for it rather than trusting that an added parameter changed
 * nothing.
 */

import { describe, it, expect } from 'vitest'
import { taskLeadingControlKind } from '@/lib/task-leading-control'

const ME = 'user-me'
const THEM = 'user-them'

describe('list mode keeps the three answers it has always had (task ffa5bbb5)', () => {
  it.each([
    ['assigned to someone else', THEM, 'avatar'],
    ['assigned to you', ME, 'checkbox'],
    ['assigned to nobody', null, 'unassigned'],
  ])('%s → %s', (_label, assigneeId, expected) => {
    expect(
      taskLeadingControlKind({ assigneeId, currentUserId: ME, displayMode: 'list' }),
    ).toBe(expected)
  })

  it('still falls back to the checkbox for a completed unassigned task', () => {
    // The "U" mark has no checked state, so a completed task cannot wear it.
    expect(
      taskLeadingControlKind({
        assigneeId: null,
        currentUserId: ME,
        completed: true,
        displayMode: 'list',
      }),
    ).toBe('checkbox')
  })

  it('behaves as list mode when no mode is given', () => {
    // Every existing call site omits it. Adding the parameter must not change
    // a single one of them.
    expect(taskLeadingControlKind({ assigneeId: ME, currentUserId: ME })).toBe('checkbox')
    expect(taskLeadingControlKind({ assigneeId: THEM, currentUserId: ME })).toBe('avatar')
    expect(taskLeadingControlKind({ assigneeId: null, currentUserId: ME })).toBe('unassigned')
  })
})

describe('project mode shows your own photo (task ffa5bbb5)', () => {
  it('assigned to you → your avatar, not the checkbox', () => {
    expect(
      taskLeadingControlKind({ assigneeId: ME, currentUserId: ME, displayMode: 'project' }),
    ).toBe('avatar')
  })

  it('assigned to someone else → their avatar, as before', () => {
    expect(
      taskLeadingControlKind({ assigneeId: THEM, currentUserId: ME, displayMode: 'project' }),
    ).toBe('avatar')
  })

  it('assigned to nobody → still the unassigned mark', () => {
    // "Also show your photo" is about assignment, not about inventing a photo
    // for a task nobody owns.
    expect(
      taskLeadingControlKind({ assigneeId: null, currentUserId: ME, displayMode: 'project' }),
    ).toBe('unassigned')
  })

  it('a completed task assigned to you still shows a checked mark', () => {
    // An avatar cannot render "completed". Completion has to stay legible in
    // project mode too, so the checkbox wins over the photo here.
    expect(
      taskLeadingControlKind({
        assigneeId: ME,
        currentUserId: ME,
        completed: true,
        displayMode: 'project',
      }),
    ).toBe('checkbox')
  })

  it('signed out is not "your" task', () => {
    // currentUserId absent must not make every unassigned-to-you task look
    // like yours.
    expect(
      taskLeadingControlKind({
        assigneeId: THEM,
        currentUserId: null,
        displayMode: 'project',
      }),
    ).toBe('avatar')
  })
})
