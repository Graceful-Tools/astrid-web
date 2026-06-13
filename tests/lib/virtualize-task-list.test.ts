import { describe, it, expect } from 'vitest'
import {
  shouldVirtualizeTaskList,
  VIRTUALIZE_TASK_THRESHOLD,
} from '@/lib/virtualize-task-list'

/**
 * Task a48b2d24 — the gate that decides when to virtualize the task list.
 * The whole point is: normal lists render unchanged (zero regression), and a
 * manual-sort drag always falls back to a full render so reordering works.
 */
describe('shouldVirtualizeTaskList (task a48b2d24)', () => {
  it('does NOT virtualize at or below the threshold', () => {
    expect(shouldVirtualizeTaskList(VIRTUALIZE_TASK_THRESHOLD, false)).toBe(false)
    expect(shouldVirtualizeTaskList(VIRTUALIZE_TASK_THRESHOLD - 1, false)).toBe(false)
    expect(shouldVirtualizeTaskList(0, false)).toBe(false)
  })

  it('virtualizes above the threshold when not dragging', () => {
    expect(shouldVirtualizeTaskList(VIRTUALIZE_TASK_THRESHOLD + 1, false)).toBe(true)
    expect(shouldVirtualizeTaskList(5000, false)).toBe(true)
  })

  it('never virtualizes while a manual-sort drag is active', () => {
    expect(shouldVirtualizeTaskList(5000, true)).toBe(false)
    expect(shouldVirtualizeTaskList(VIRTUALIZE_TASK_THRESHOLD + 1, true)).toBe(false)
  })

  it('respects a custom threshold', () => {
    expect(shouldVirtualizeTaskList(11, false, 10)).toBe(true)
    expect(shouldVirtualizeTaskList(10, false, 10)).toBe(false)
  })
})
