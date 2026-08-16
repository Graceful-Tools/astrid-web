/**
 * Moving a task between status lists without losing its board.
 *
 * `PUT /api/v1/tasks/[id]` replaces `listIds` wholesale, so "move to Doing" written
 * the obvious way — `listIds: [doingId]` — puts the task on Doing and takes it off
 * its board, out of every queue, findable only by id. That is not a hypothetical:
 * `scripts/move-task-to-list.ts` sends exactly that, correctly for its own job, and
 * its header records the near-identical bug that prompted it.
 *
 * These pin the arithmetic that keeps the board.
 */

import { describe, it, expect } from 'vitest'
import {
  isStatusList,
  listIdsForStatusChange,
  unsafeStatusChangeReason,
} from '@/lib/task-status-lists'

const BOARD = { id: 'board-ios', name: 'Astrid iOS To-do', listType: 'user' }
const READY = { id: 'status-ready', name: 'Ready', listType: 'status' }
const DOING = { id: 'status-doing', name: 'Doing', listType: 'status' }
const WAITING = { id: 'status-waiting', name: 'Waiting', listType: 'status' }

describe('listIdsForStatusChange', () => {
  it('keeps the board and swaps the status', () => {
    const result = listIdsForStatusChange([BOARD, READY], DOING.id)
    expect(result).toContain(BOARD.id)
    expect(result).toContain(DOING.id)
    expect(result).not.toContain(READY.id)
  })

  it('keeps EVERY non-status membership, not just the first', () => {
    const second = { id: 'board-other', name: 'Career', listType: 'user' }
    const result = listIdsForStatusChange([BOARD, second, READY], WAITING.id)
    expect(result).toEqual(expect.arrayContaining([BOARD.id, second.id, WAITING.id]))
    expect(result).not.toContain(READY.id)
  })

  it('drops a stale second status membership rather than leaving two', () => {
    // A task that somehow sits on both Ready and Doing must not come out of this
    // still on both — the queue would then see it twice with different meanings.
    const result = listIdsForStatusChange([BOARD, READY, DOING], WAITING.id)
    expect(result).toEqual([BOARD.id, WAITING.id])
  })

  it('is idempotent — re-applying the status it already has changes nothing', () => {
    const once = listIdsForStatusChange([BOARD, DOING], DOING.id)
    const twice = listIdsForStatusChange([BOARD, DOING], DOING.id)
    expect(once).toEqual(twice)
    expect(once).toEqual([BOARD.id, DOING.id])
  })

  it('never emits a duplicate id', () => {
    const result = listIdsForStatusChange([BOARD, BOARD, READY], DOING.id)
    expect(result).toEqual([...new Set(result)])
  })

  it('adds a status to a task that had none', () => {
    expect(listIdsForStatusChange([BOARD], DOING.id)).toEqual([BOARD.id, DOING.id])
  })
})

describe('isStatusList', () => {
  it('trusts listType when the server sends it', () => {
    expect(isStatusList(READY)).toBe(true)
    expect(isStatusList(BOARD)).toBe(false)
  })

  it("does NOT treat a user's own list named Waiting as the status list", () => {
    // Several accounts have a personal list called Waiting. Mistaking one for the
    // status list would silently unfile the task from it.
    expect(isStatusList({ id: 'mine', name: 'Waiting', listType: 'user' })).toBe(false)
  })

  it('falls back to the name only when listType is missing', () => {
    expect(isStatusList({ id: 'x', name: 'Doing' })).toBe(true)
    expect(isStatusList({ id: 'y', name: 'Groceries' })).toBe(false)
  })
})

describe('unsafeStatusChangeReason', () => {
  it('refuses a task with no memberships at all', () => {
    expect(unsafeStatusChangeReason([], DOING.id)).toMatch(/no list memberships/)
  })

  it('refuses a task that is on no board — moving it would strand it', () => {
    expect(unsafeStatusChangeReason([READY], DOING.id)).toMatch(/no board/)
  })

  it('refuses an unresolved target', () => {
    expect(unsafeStatusChangeReason([BOARD, READY], '')).toMatch(/no target/)
  })

  it('allows the ordinary case', () => {
    expect(unsafeStatusChangeReason([BOARD, READY], DOING.id)).toBeNull()
  })
})
