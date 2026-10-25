/**
 * AWTD-1116 P5c: a manual reorder on a GitHub board as GitHub item moves.
 * GitHub places an item after another (or at the top), so a drag is the few
 * items whose predecessor changed — applied in the new order.
 */

import { describe, it, expect } from 'vitest'
import { itemMoves, planItemMoves, MAX_MOVES } from '@/lib/github/projects/position'

describe('itemMoves (AWTD-1116 P5c)', () => {
  it('no change, no moves', () => {
    expect(itemMoves(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual([])
  })

  it('dragging c to the top: c to the top, a after c (b keeps its place after a)', () => {
    expect(itemMoves(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual([
      { taskId: 'c', afterTaskId: null },
      { taskId: 'a', afterTaskId: 'c' },
    ])
  })

  it('dragging a to the bottom: b to the top, a after c', () => {
    expect(itemMoves(['a', 'b', 'c'], ['b', 'c', 'a'])).toEqual([
      { taskId: 'b', afterTaskId: null },
      { taskId: 'a', afterTaskId: 'c' },
    ])
  })

  it('a task new to the order is placed', () => {
    expect(itemMoves(['a'], ['a', 'n'])).toEqual([{ taskId: 'n', afterTaskId: 'a' }])
  })
})

describe('planItemMoves (AWTD-1116 P5c)', () => {
  const items: Record<string, string> = { a: 'PVTI_a', b: 'PVTI_b', c: 'PVTI_c' }

  it('one document; afterId only when there is one', () => {
    const plan = planItemMoves('PVT_1', [{ taskId: 'c', afterTaskId: null }, { taskId: 'a', afterTaskId: 'c' }], id => items[id])!
    expect(plan.document).toBe(
      'mutation($p: ID!, $i0: ID!, $i1: ID!, $a1: ID) { m0: updateProjectV2ItemPosition(input: { projectId: $p, itemId: $i0 }) { clientMutationId } m1: updateProjectV2ItemPosition(input: { projectId: $p, itemId: $i1, afterId: $a1 }) { clientMutationId } }',
    )
    expect(plan.variables).toEqual({ p: 'PVT_1', i0: 'PVTI_c', i1: 'PVTI_a', a1: 'PVTI_c' })
  })

  it('tasks not on GitHub (personal additions) are skipped; nothing left → no request', () => {
    expect(planItemMoves('PVT_1', [{ taskId: 'local', afterTaskId: null }], id => items[id])).toBeNull()
  })

  it(`caps a large reshuffle at ${MAX_MOVES} moves`, () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ taskId: 'a', afterTaskId: null }))
    expect(planItemMoves('PVT_1', many, id => items[id])!.document.match(/updateProjectV2ItemPosition/g)).toHaveLength(MAX_MOVES)
  })
})
