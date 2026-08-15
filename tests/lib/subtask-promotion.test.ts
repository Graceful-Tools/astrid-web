/**
 * Dragging a subtask out to top level (task b00a1f94).
 *
 * The decision lives here, away from the drag handlers, for the same reason
 * lib/comment-attachments and lib/editing-session do: the UI question ("does a
 * drop target appear, and what does dropping mean") is answerable without a
 * DOM, and it is the part that can silently go wrong.
 */

import { describe, it, expect } from 'vitest'
import {
  canPromoteToTopLevel,
  shouldShowPromoteTarget,
  resolvePromotion,
  PROMOTE_DROP_TARGET_ID,
} from '@/lib/subtask-promotion'

const task = (over: Record<string, unknown> = {}) =>
  ({ id: 't1', title: 'Child', parentTaskId: 'p1', completed: false, ...over }) as never

describe('canPromoteToTopLevel (task b00a1f94)', () => {
  it('is true for a task that has a parent', () => {
    expect(canPromoteToTopLevel(task())).toBe(true)
  })

  it('is false for a task that is already top level', () => {
    // The whole point of the feature is moving OUT of a subtask. A top-level
    // task has nothing to move out of, so offering the target would be a lie.
    expect(canPromoteToTopLevel(task({ parentTaskId: null }))).toBe(false)
    expect(canPromoteToTopLevel(task({ parentTaskId: undefined }))).toBe(false)
  })

  it('is false for nothing at all', () => {
    expect(canPromoteToTopLevel(null)).toBe(false)
    expect(canPromoteToTopLevel(undefined)).toBe(false)
  })
})

describe('shouldShowPromoteTarget (task b00a1f94)', () => {
  it('shows the target only while a subtask is being dragged', () => {
    expect(shouldShowPromoteTarget(task())).toBe(true)
  })

  it('stays hidden when nothing is being dragged', () => {
    // A permanently visible "unnest" strip is noise for the common case —
    // most tasks are not subtasks and most drags are reorders.
    expect(shouldShowPromoteTarget(null)).toBe(false)
  })

  it('stays hidden when the dragged task is already top level', () => {
    expect(shouldShowPromoteTarget(task({ parentTaskId: null }))).toBe(false)
  })
})

describe('resolvePromotion (task b00a1f94)', () => {
  it('clears the parent link', () => {
    expect(resolvePromotion(task())).toEqual({ taskId: 't1', parentTaskId: null })
  })

  it('returns nothing for a task that cannot be promoted', () => {
    // Guards the drop handler: a stray drop on the target must be a no-op
    // rather than an API call that clears an already-null parent.
    expect(resolvePromotion(task({ parentTaskId: null }))).toBeNull()
    expect(resolvePromotion(null)).toBeNull()
  })

  it('says nothing about the task\'s own children', () => {
    // Deliberate and worth pinning: promoting a subtask cuts ONLY its link to
    // its parent. Its own subtree travels with it. Pulling grandchildren up
    // too is a different product decision, and doing it silently would be the
    // kind of surprise that is hard to undo.
    const result = resolvePromotion(task())

    expect(Object.keys(result!)).toEqual(['taskId', 'parentTaskId'])
  })

  it('has a stable target id for the drop zone', () => {
    expect(PROMOTE_DROP_TARGET_ID).toBeTruthy()
  })
})

// ─── Request-body parsing, shared by both task routes ──────────────

import { readParentTaskIdFromBody } from '@/lib/subtasks'

describe('readParentTaskIdFromBody (task b00a1f94)', () => {
  it('skips when the caller did not mention parentTaskId', () => {
    // A PUT that only changes the title must not silently unnest the task.
    expect(readParentTaskIdFromBody({})).toEqual({ skip: true })
  })

  it('clears the parent for null', () => {
    expect(readParentTaskIdFromBody({ parentTaskId: null })).toEqual({ skip: false, parentTaskId: null })
  })

  it('clears the parent for an empty string', () => {
    // iOS sends "" to mean "no parent"; both spellings have to work or the
    // clients disagree about how to unnest.
    expect(readParentTaskIdFromBody({ parentTaskId: '' })).toEqual({ skip: false, parentTaskId: null })
  })

  it('re-parents for a string id', () => {
    expect(readParentTaskIdFromBody({ parentTaskId: 'p2' })).toEqual({ skip: false, parentTaskId: 'p2' })
  })

  it('ignores a value that is neither a string nor null', () => {
    // Garbage must not reach Prisma as a parent id.
    expect(readParentTaskIdFromBody({ parentTaskId: 42 })).toEqual({ skip: true })
    expect(readParentTaskIdFromBody({ parentTaskId: {} })).toEqual({ skip: true })
  })
})
