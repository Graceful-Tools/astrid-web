/**
 * unwrapTask — reading a task out of either envelope (task 641a7615, step 3).
 *
 * Legacy `/api/tasks/[id]` returns the task bare; `/api/v1/tasks/[id]` returns
 * `{ task, meta }`. A call site that swaps the path without unwrapping ends up
 * reading `.id` off the envelope and getting `undefined` — silently. I have
 * already shipped that mistake once: a script read `body.lists` off a v1
 * response, computed an empty membership list, and stripped a task off every
 * board it was on.
 *
 * So the cases worth pinning are the ones where a wrong answer LOOKS fine.
 */

import { describe, it, expect } from 'vitest'
import { unwrapTask, unwrapList } from '@/lib/v1-response'

const task = { id: 't1', title: 'Water the plants' }

describe('unwrapTask (task 641a7615)', () => {
  it('unwraps the v1 envelope', () => {
    expect(unwrapTask({ task, meta: { apiVersion: 'v1' } } as never)).toEqual(task)
  })

  it('passes a legacy bare task through', () => {
    expect(unwrapTask(task)).toEqual(task)
  })

  it('does not mistake an error body for a task', () => {
    // The dangerous one: returning this would hand the caller an object with no
    // id and no title, which reads downstream as a task whose fields are blank.
    expect(unwrapTask({ error: 'Task not found' } as never)).toBeNull()
  })

  it('returns null for an envelope with no task in it', () => {
    expect(unwrapTask({ meta: { apiVersion: 'v1' } } as never)).toBeNull()
  })

  it('returns null rather than guessing on null or a non-object', () => {
    expect(unwrapTask(null)).toBeNull()
    expect(unwrapTask(undefined)).toBeNull()
    expect(unwrapTask('t1' as never)).toBeNull()
  })

  it('rejects a bare object whose id is not a string', () => {
    // Guards against an envelope-shaped body sneaking through on a truthy id.
    expect(unwrapTask({ id: 42 } as never)).toBeNull()
  })

  it('keeps the task fields intact, including arrays', () => {
    // listIds is the field whose loss caused the board-stripping incident.
    const full = { id: 't1', title: 'x', listIds: ['l1', 'l2'] }

    expect(unwrapTask({ task: full } as never)).toEqual(full)
  })
})

/**
 * Lists have the same split — legacy `/api/lists/[id]` returns the list bare,
 * v1 returns `{ list, meta }`. Same helper, different envelope key, so these
 * pin that generalising it did not lose the guards the task version had.
 */
describe('unwrapList (task dc143ab2)', () => {
  const list = { id: 'l1', name: 'Groceries' }

  it('unwraps the v1 envelope', () => {
    expect(unwrapList({ list, meta: { apiVersion: 'v1' } } as never)).toEqual(list)
  })

  it('passes a legacy bare list through', () => {
    expect(unwrapList(list)).toEqual(list)
  })

  it('does not mistake an error body for a list', () => {
    expect(unwrapList({ error: 'List not found' } as never)).toBeNull()
  })

  it('does not unwrap a task envelope as a list', () => {
    // The keys are the only thing distinguishing the two. A helper that
    // accepted either would happily hand a task to list-rendering code.
    expect(unwrapList({ task: { id: 't1' } } as never)).toBeNull()
  })

  it('keeps nested fields intact', () => {
    const full = { id: 'l1', name: 'x', listMembers: [{ userId: 'u1', role: 'owner' }] }

    expect(unwrapList({ list: full } as never)).toEqual(full)
  })
})
