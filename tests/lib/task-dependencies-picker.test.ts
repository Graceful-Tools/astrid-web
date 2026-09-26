/**
 * AWTD-1002 follow-up — the picker never offers a choice the write would
 * refuse, and ranks neighbours first.
 *
 * The spec: "Exclude the task itself and anything that would cycle (the same
 * walk as the write check, so the user is never offered a choice that will be
 * refused)" and "Rank tasks on the same board first … ranking is not
 * filtering, so a cross-board blocker is still one search away."
 */

import { describe, it, expect } from 'vitest'
import {
  rankBlockerCandidates,
  reachableTaskIds,
  wouldCreateDependencyCycle,
} from '@/lib/task-dependencies'
import { notificationKindFor } from '@/lib/notifications'

/** a waits on b, b waits on c. `edges[x]` = the tasks x waits on. */
const edges: Record<string, string[]> = { a: ['b'], b: ['c'], c: [] }
const blockersOf = async (id: string) => edges[id] ?? []
const dependentsOf = async (id: string) =>
  Object.entries(edges).filter(([, to]) => to.includes(id)).map(([from]) => from)

describe('AWTD-1002 reachableTaskIds — one walk for the write check and the picker', () => {
  it('collects everything transitively reachable, excluding the start', async () => {
    expect(await reachableTaskIds('a', blockersOf)).toEqual(new Set(['b', 'c']))
    expect(await reachableTaskIds('c', dependentsOf)).toEqual(new Set(['b', 'a']))
  })

  it('terminates on a graph that already contains a cycle', async () => {
    const looped: Record<string, string[]> = { x: ['y'], y: ['x'] }
    expect(await reachableTaskIds('x', async id => looped[id] ?? [])).toEqual(new Set(['y', 'x']))
  })

  it('agrees with the write check: every transitive dependent would cycle', async () => {
    // c's dependents are exactly the tasks c may not wait on.
    for (const dependent of await reachableTaskIds('c', dependentsOf)) {
      expect(
        await wouldCreateDependencyCycle({ blockedTaskId: 'c', blockingTaskId: dependent, blockersOf }),
      ).toBe(true)
    }
  })
})

describe('AWTD-1002 rankBlockerCandidates', () => {
  const hit = (id: string, listIds: string[]) => ({ id, title: id, lists: listIds.map(l => ({ id: l })) })

  it('puts tasks on the same board first and keeps search order within each group', () => {
    const ranked = rankBlockerCandidates({
      hits: [hit('far-1', ['other']), hit('near-1', ['board']), hit('far-2', []), hit('near-2', ['x', 'board'])],
      taskId: 'self',
      taskListIds: ['board'],
      excludedIds: [],
    })
    expect(ranked.map(h => h.id)).toEqual(['near-1', 'near-2', 'far-1', 'far-2'])
  })

  it('drops the task itself, already-linked tasks, and tasks that would cycle — nothing else', () => {
    const ranked = rankBlockerCandidates({
      hits: [hit('self', ['board']), hit('linked', ['board']), hit('dependent', []), hit('fine', [])],
      taskId: 'self',
      taskListIds: ['board'],
      excludedIds: ['linked', 'dependent'],
    })
    expect(ranked.map(h => h.id)).toEqual(['fine'])
  })

  it('tolerates a hit with no lists field', () => {
    const ranked = rankBlockerCandidates({
      hits: [{ id: 'bare', title: 'bare' }],
      taskId: 'self',
      taskListIds: ['board'],
      excludedIds: [],
    })
    expect(ranked.map(h => h.id)).toEqual(['bare'])
  })
})

describe('AWTD-1002 notifications ride the existing event fan-out', () => {
  it('an automatic promotion is news: unblocked notifies as a status change', () => {
    expect(notificationKindFor('unblocked')).toBe('status_changed')
  })

  it('a reopened blocker under a card someone is working is news too', () => {
    expect(notificationKindFor('blocker_reopened')).toBe('status_changed')
  })

  it('adding and removing a blocker stay history, not news', () => {
    expect(notificationKindFor('blocker_added')).toBeNull()
    expect(notificationKindFor('blocker_removed')).toBeNull()
  })
})
