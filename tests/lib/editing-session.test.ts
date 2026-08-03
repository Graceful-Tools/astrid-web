import { describe, expect, it } from 'vitest'
import {
  IDLE,
  begin,
  cancel,
  end,
  commitAll,
  isActive,
} from '@/lib/editing-session'

/**
 * Task 7b60c7c5 — one editing session at a time.
 *
 * Today the task detail alone holds EIGHT independent `editingX` booleans
 * (title, description, when, time, priority, repeating, lists, assignee) and
 * nothing stops two being true at once. That is the reported bug: edit a list
 * and tap the title, or vice versa, and both editors are open.
 *
 * The rule, stated once:
 *
 *   begin(B)  COMMITS and closes whatever was active, then activates B
 *   end(A)    commits A
 *   cancel(A) reverts A — the ONLY thing that reverts
 *
 * Everything else — tapping outside, opening another editor, navigating away,
 * backgrounding — SAVES. One rule to learn, one rule to test.
 *
 * Pure on purpose: this is tested before any view touches it, so the
 * mutual-exclusion guarantee is a property of the machine and not of whether
 * each of a dozen call sites remembered to close the others.
 */
describe('editing session — the machine (task 7b60c7c5)', () => {
  describe('begin', () => {
    it('activates an editor when nothing is open', () => {
      const t = begin(IDLE, 'title')

      expect(t.state.activeEditor).toBe('title')
      expect(t.commit).toBeNull()
      expect(t.cancel).toBeNull()
    })

    it('COMMITS the active editor when a different one opens', () => {
      const open = begin(IDLE, 'title').state

      const t = begin(open, 'assignee')

      expect(t.commit).toBe('title')
      expect(t.state.activeEditor).toBe('assignee')
      expect(t.cancel).toBeNull()
    })

    it('never reverts on hand-off — opening another editor saves, it does not discard', () => {
      const open = begin(IDLE, 'description').state

      expect(begin(open, 'when').cancel).toBeNull()
    })

    it('is idempotent — re-opening the already-active editor does not commit it', () => {
      const open = begin(IDLE, 'title').state

      const t = begin(open, 'title')

      expect(t.commit).toBeNull()
      expect(t.state.activeEditor).toBe('title')
    })

    it('hands off cleanly through a chain of editors, committing each in turn', () => {
      let state = IDLE
      const committed: (string | null)[] = []

      for (const id of ['title', 'when', 'time', 'assignee']) {
        const t = begin(state, id)
        committed.push(t.commit)
        state = t.state
      }

      expect(committed).toEqual([null, 'title', 'when', 'time'])
      expect(state.activeEditor).toBe('assignee')
    })
  })

  describe('end', () => {
    it('commits the active editor and closes the session', () => {
      const open = begin(IDLE, 'priority').state

      const t = end(open, 'priority')

      expect(t.commit).toBe('priority')
      expect(t.state.activeEditor).toBeNull()
    })

    it('ignores a stale end from an editor that is no longer active', () => {
      // A blur can arrive after begin() already handed off. Committing on it
      // would write the OLD editor's value over the new one's.
      const handedOff = begin(begin(IDLE, 'title').state, 'assignee').state

      const t = end(handedOff, 'title')

      expect(t.commit).toBeNull()
      expect(t.state.activeEditor).toBe('assignee')
    })

    it('is a no-op when nothing is open', () => {
      const t = end(IDLE, 'title')

      expect(t.commit).toBeNull()
      expect(t.state.activeEditor).toBeNull()
    })
  })

  describe('cancel', () => {
    it('reverts the active editor — the only transition that does', () => {
      const open = begin(IDLE, 'description').state

      const t = cancel(open, 'description')

      expect(t.cancel).toBe('description')
      expect(t.commit).toBeNull()
      expect(t.state.activeEditor).toBeNull()
    })

    it('ignores a stale cancel from an editor that is no longer active', () => {
      const handedOff = begin(begin(IDLE, 'title').state, 'lists').state

      const t = cancel(handedOff, 'title')

      expect(t.cancel).toBeNull()
      expect(t.state.activeEditor).toBe('lists')
    })
  })

  describe('commitAll — navigating away and backgrounding SAVE', () => {
    it('commits whatever was open', () => {
      const open = begin(IDLE, 'when').state

      const t = commitAll(open)

      expect(t.commit).toBe('when')
      expect(t.state.activeEditor).toBeNull()
    })

    it('is a no-op when nothing is open', () => {
      expect(commitAll(IDLE).commit).toBeNull()
    })
  })

  describe('the guarantee', () => {
    it('never has two editors active — by construction, not by call-site discipline', () => {
      let state = IDLE
      const ids = ['title', 'description', 'when', 'time', 'priority', 'repeating', 'lists', 'assignee']

      for (const id of ids) {
        state = begin(state, id).state
        const open = ids.filter(candidate => isActive(state, candidate))
        expect(open).toHaveLength(1)
      }
    })

    it('reports the active editor and only the active editor', () => {
      const state = begin(IDLE, 'time').state

      expect(isActive(state, 'time')).toBe(true)
      expect(isActive(state, 'when')).toBe(false)
      expect(isActive(IDLE, 'time')).toBe(false)
    })
  })
})
