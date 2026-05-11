import { describe, expect, it } from 'vitest'
import { didEnterBoardMode } from '@/lib/board-mode-transition'

describe('didEnterBoardMode (bug a1e5c0ff follow-up: messages tap in board view)', () => {
  it('fires only on the list → board transition', () => {
    expect(didEnterBoardMode({ prevTaskViewMode: 'list', nextTaskViewMode: 'board' })).toBe(true)
  })

  it('does NOT fire while already in board mode — this caused the messages tap to be reverted', () => {
    expect(didEnterBoardMode({ prevTaskViewMode: 'board', nextTaskViewMode: 'board' })).toBe(false)
  })

  it('does NOT fire when leaving board mode', () => {
    expect(didEnterBoardMode({ prevTaskViewMode: 'board', nextTaskViewMode: 'list' })).toBe(false)
  })

  it('does NOT fire when staying on the list view', () => {
    expect(didEnterBoardMode({ prevTaskViewMode: 'list', nextTaskViewMode: 'list' })).toBe(false)
  })
})
