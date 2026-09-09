/**
 * Task 43bcc76c: in task DETAILS, in list mode, a task assigned to someone
 * else could not be completed at all.
 *
 * The mark for someone else's task is their avatar, and the avatar is only
 * clickable where tapping opens the options sheet — project mode, or a board.
 * On a row that inertness is deliberate: completing another person's task from
 * the row was never an affordance (task 2bb1b196). In details it is a dead end,
 * because the leading control is the ONLY completion affordance there.
 *
 * Jon: "in task details cannot complete tasks when user in list mode. Tapping
 * on profile should show popover with confirmation to complete."
 *
 * So the surface decides. This is the predicate; the popover it gates lives in
 * components/task-leading-control.tsx.
 */
import { describe, it, expect } from 'vitest'
import {
  leadingControlConfirmsCompletion,
  taskLeadingControlKind,
} from '@/lib/task-leading-control'

const ME = 'user-me'
const THEM = 'user-them'

/** The mark someone else's task wears, in list mode. */
const theirTask = taskLeadingControlKind({
  assigneeId: THEM,
  currentUserId: ME,
  displayMode: 'list',
})

describe('leadingControlConfirmsCompletion (task 43bcc76c)', () => {
  it('asks for confirmation on someone else\'s task in details', () => {
    expect(theirTask).toBe('avatar')
    expect(
      leadingControlConfirmsCompletion({
        kind: theirTask,
        opensOptions: false,
        surface: 'detail',
      }),
    ).toBe(true)
  })

  it('leaves the row inert, which is the documented list-mode behaviour', () => {
    expect(
      leadingControlConfirmsCompletion({
        kind: theirTask,
        opensOptions: false,
        surface: 'row',
      }),
    ).toBe(false)
  })

  it('defaults to the row, so call sites predating this task are untouched', () => {
    expect(
      leadingControlConfirmsCompletion({ kind: theirTask, opensOptions: false }),
    ).toBe(false)
  })

  it('yields to the options sheet, which already carries complete', () => {
    // Project mode and boards route the tap to the sheet. Two competing
    // popovers on one control is the bug this avoids.
    expect(
      leadingControlConfirmsCompletion({
        kind: theirTask,
        opensOptions: true,
        surface: 'detail',
      }),
    ).toBe(false)
  })

  it('does not touch the checkbox or the unassigned mark', () => {
    // Your own task and an unowned one already complete on tap. Neither should
    // grow a confirmation step.
    for (const kind of ['checkbox', 'unassigned'] as const) {
      expect(
        leadingControlConfirmsCompletion({ kind, opensOptions: false, surface: 'detail' }),
      ).toBe(false)
    }
  })
})
