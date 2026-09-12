/**
 * AWTD-919 (web half of astrid-ios AITD-382, fixed there in 2bcb0e4): tapping
 * the mark on an UNASSIGNED task completed it.
 *
 * `leadingControlOpensOptions` asked three questions — the display mode, the
 * board, and whose task it is — and never asked about the MARK IT ACTUALLY
 * DREW. For a task nobody owns, on a plain list row:
 *
 *   usesCompactTaskDetail('list')  false
 *   onBoard                        false
 *   isSomeoneElses                 false   <- correct; nobody's is not someone else's
 *
 * so it returned false and the tap completed the task. `taskLeadingControlKind`
 * had already decided to draw "U" rather than a checkbox, precisely because a
 * task nobody owns was otherwise depicted exactly like a task you own.
 * Completing on a tap is what a checkbox means; it is not what "U" means.
 *
 * Other people's and agents' tasks were already right, but only incidentally:
 * both are an avatar with an id that is not yours, so `isSomeoneElses` caught
 * them. Unassigned was the one state that fell through.
 *
 * THE FIX GATES ON THE KIND, NOT THE ASSIGNEE ID. `taskLeadingControlKind` has
 * a deliberate web-only fallback iOS lacks: a COMPLETED unassigned task returns
 * 'checkbox', because the "U" mark has no checked state to show and
 * un-completing has to stay reachable in one tap. Gating on a raw assigneeId
 * would break that; gating on the kind preserves it by construction.
 */
import { describe, it, expect } from 'vitest'
import {
  leadingControlOpensOptions,
  taskLeadingControlKind,
} from '@/lib/task-leading-control'

const ME = 'user-me'
const THEM = 'user-them'
const AGENT = 'ai-agent-claude'

/** What a plain list row asks: no board, no project mode. */
function opensOnListRow(assigneeId: string | null, completed = false) {
  const kind = taskLeadingControlKind({ assigneeId, currentUserId: ME, completed })
  return leadingControlOpensOptions({
    displayMode: 'list',
    onBoard: false,
    isSomeoneElses: Boolean(assigneeId) && assigneeId !== ME,
    kind,
  })
}

describe('the unassigned mark does not complete on tap (AWTD-919)', () => {
  it('AWTD-919: tapping the "U" on an unassigned list row opens the options sheet', () => {
    expect(opensOnListRow(null)).toBe(true)
  })

  it('AWTD-919: the API\'s empty-string unassigned behaves identically to null', () => {
    // '' is how the API says unassigned, per isSomeoneElsesTask's trap 2.
    expect(opensOnListRow('')).toBe(true)
  })

  it('AWTD-919: nobody\'s, an agent\'s and another person\'s task all agree on a row', () => {
    // The acceptance criterion as ONE property, not three expectations that
    // happen to match: none of these three is your own work, so none of them
    // may be finished by a single tap. Asserted as a set so a future change
    // cannot fix one and leave another behind — which is exactly how
    // unassigned came to be the odd one out.
    const answers = [null, '', AGENT, THEM].map(id => opensOnListRow(id))
    expect(answers).toEqual([true, true, true, true])
    expect(new Set(answers).size).toBe(1)
  })

  it('your own checkbox still completes in one tap', () => {
    // The behaviour that must NOT change: this is the whole point of the
    // checkbox, and gating too broadly would put a sheet in front of every
    // completion in the product.
    expect(opensOnListRow(ME)).toBe(false)
  })

  it('a COMPLETED unassigned task can still be un-completed in one tap', () => {
    // The web-only `completed -> 'checkbox'` fallback. iOS has no equivalent,
    // and gating on assigneeId rather than kind would have silently removed
    // the only way to un-tick a task nobody owns.
    expect(taskLeadingControlKind({ assigneeId: null, currentUserId: ME, completed: true }))
      .toBe('checkbox')
    expect(opensOnListRow(null, true)).toBe(false)
  })
})

describe('the existing reasons to open the sheet are unchanged (AWTD-919)', () => {
  it('omitting kind keeps the pre-AWTD-919 answers', () => {
    // kind is optional and defaults to 'checkbox', the same convention this
    // module already uses for displayMode. Callers that predate this task must
    // not change behaviour.
    expect(leadingControlOpensOptions({ displayMode: 'list', onBoard: false })).toBe(false)
    expect(leadingControlOpensOptions({ displayMode: 'list', onBoard: true })).toBe(true)
    expect(leadingControlOpensOptions({ displayMode: 'project', onBoard: false })).toBe(true)
    expect(
      leadingControlOpensOptions({ displayMode: 'list', onBoard: false, isSomeoneElses: true }),
    ).toBe(true)
  })

  it('an unassigned task on a board or in project mode still opens the sheet', () => {
    expect(opensOnListRow(null)).toBe(true)
    expect(
      leadingControlOpensOptions({ displayMode: 'project', onBoard: false, kind: 'unassigned' }),
    ).toBe(true)
    expect(
      leadingControlOpensOptions({ displayMode: 'list', onBoard: true, kind: 'unassigned' }),
    ).toBe(true)
  })
})
