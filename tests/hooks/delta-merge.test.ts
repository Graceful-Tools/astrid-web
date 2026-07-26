/**
 * @vitest-environment node
 *
 * loadData reconciled with a FULL fetch (~1.9 MB of tasks) because a delta could
 * not report deletions — merging one would have left deleted tasks on screen.
 * The API now returns `deletedIds` on delta responses, so the reconcile can go
 * incremental.
 *
 * The merge is where this gets dangerous. A full response REPLACES state; a
 * delta must be merged INTO it, or every task the delta didn't mention vanishes.
 * These pin that distinction, plus the things a delta must not lose:
 * optimistic (temp-) rows and locally-loaded comments.
 */
import { describe, it, expect } from 'vitest'
import { mergeTasks, mergeLists } from '@/hooks/task-manager/merge-tasks'

const t = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id, ...extra }) as never

describe('full reconcile', () => {
  it('replaces state — a task the server omitted is gone', () => {
    const prev = [t('a'), t('b')]

    const merged = mergeTasks(prev, [t('a')], { isDelta: false, deletedIds: [] })

    expect(merged.map(x => x.id)).toEqual(['a'])
  })
})

describe('delta reconcile', () => {
  it('keeps tasks the delta did not mention', () => {
    // The whole hazard: 'b' was simply unchanged, not deleted.
    const prev = [t('a'), t('b')]

    const merged = mergeTasks(prev, [t('a', { title: 'updated' })], { isDelta: true, deletedIds: [] })

    expect(merged.map(x => x.id).sort()).toEqual(['a', 'b'])
    expect(merged.find(x => x.id === 'a')?.title).toBe('updated')
  })

  it('removes exactly what the server says was deleted', () => {
    const prev = [t('a'), t('b'), t('c')]

    const merged = mergeTasks(prev, [], { isDelta: true, deletedIds: ['b'] })

    expect(merged.map(x => x.id)).toEqual(['a', 'c'])
  })

  it('adds tasks created on another device', () => {
    const merged = mergeTasks([t('a')], [t('new-from-mac')], { isDelta: true, deletedIds: [] })

    expect(merged.map(x => x.id).sort()).toEqual(['a', 'new-from-mac'])
  })

  it('preserves optimistic temp- rows the server has never seen', () => {
    const prev = [t('a'), t('temp-123')]

    const merged = mergeTasks(prev, [t('a')], { isDelta: true, deletedIds: [] })

    expect(merged.map(x => x.id)).toContain('temp-123')
  })

  it('keeps locally loaded comments when the delta omits them', () => {
    // Comments are fetched on demand in the detail view; a list-level sync must
    // not wipe them.
    const prev = [t('a', { comments: [{ id: 'c1' }] })]

    const merged = mergeTasks(prev, [t('a')], { isDelta: true, deletedIds: [] })

    expect((merged[0] as { comments?: unknown[] }).comments).toHaveLength(1)
  })

  it('lets the server drop comments when it actually sends them', () => {
    const prev = [t('a', { comments: [{ id: 'c1' }] })]

    const merged = mergeTasks(prev, [t('a', { comments: [] })], { isDelta: true, deletedIds: [] })

    expect((merged[0] as { comments?: unknown[] }).comments).toEqual([])
  })

  it('applies a deletion even for a task the delta also returned', () => {
    // Defensive: deletion wins, so a race cannot resurrect a deleted task.
    const merged = mergeTasks([t('a')], [t('a')], { isDelta: true, deletedIds: ['a'] })

    expect(merged).toEqual([])
  })
})

describe('lists follow the same rules', () => {
  it('keeps unmentioned lists on a delta but not on a full response', () => {
    const prev = [t('l1'), t('l2')]

    expect(mergeLists(prev, [t('l1')], { isDelta: true, deletedIds: [] }).map(x => x.id).sort())
      .toEqual(['l1', 'l2'])
    expect(mergeLists(prev, [t('l1')], { isDelta: false, deletedIds: [] }).map(x => x.id))
      .toEqual(['l1'])
  })

  it('removes deleted lists and preserves optimistic ones', () => {
    const prev = [t('l1'), t('l2'), t('temp-new')]

    const merged = mergeLists(prev, [], { isDelta: true, deletedIds: ['l2'] })

    expect(merged.map(x => x.id).sort()).toEqual(['l1', 'temp-new'])
  })
})
