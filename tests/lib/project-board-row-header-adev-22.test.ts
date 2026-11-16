/**
 * ADEV-22 — the project board's row header: text readable on the list's colour,
 * and the Done window the count is "in the last N hours" of.
 */
import { describe, it, expect } from 'vitest'
import { boardDoneWindowHours, boardRowTextColor } from '@/lib/project-board-rows'
import type { TaskList } from '@/types/task'

describe('ADEV-22 board row header', () => {
  it('picks white on dark list colours and dark on light ones', () => {
    expect(boardRowTextColor('#1e3a8a')).toBe('#ffffff')
    expect(boardRowTextColor('#fde68a')).toBe('#111827')
  })

  it('leaves a colour it cannot read alone', () => {
    expect(boardRowTextColor('red')).toBeUndefined()
    expect(boardRowTextColor(undefined)).toBeUndefined()
  })

  it('reads the Done window in hours, defaulting to 24', () => {
    expect(boardDoneWindowHours({} as TaskList)).toBe(24)
    expect(
      boardDoneWindowHours({ recentlyCompletedWindow: { kind: 'duration', amount: 3, unit: 'day' } } as unknown as TaskList),
    ).toBe(72)
    expect(
      boardDoneWindowHours({ recentlyCompletedWindow: { kind: 'since-weekday', weekday: 1 } } as unknown as TaskList),
    ).toBeNull()
  })
})
