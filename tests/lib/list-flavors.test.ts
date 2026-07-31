/**
 * Regression tests for task 60f5849d — labels as a third list flavor.
 *
 * Multi-list membership already *is* labels; what was missing was the
 * presentation. The load-bearing requirement is that a label never appears in
 * a list-shaped surface (sidebar, move-to-list picker, board columns), because
 * that is what would make it feel like a place rather than a tag.
 */

import { describe, it, expect } from 'vitest'
import {
  isLabelList,
  isStatusList,
  isDomainList,
  filterDomainLists,
  filterLabelLists,
  splitTaskLists,
  canConvertListFlavor,
  parseGithubLabels,
  reconcileGithubLabels,
} from '@/lib/list-flavors'

const list = (id: string, listType?: string | null) => ({ id, listType }) as never

describe('list flavor predicates (60f5849d)', () => {
  it('recognises each flavor', () => {
    expect(isLabelList(list('a', 'label'))).toBe(true)
    expect(isStatusList(list('b', 'status'))).toBe(true)
    expect(isDomainList(list('c', 'regular'))).toBe(true)
  })

  it('treats a missing listType as a domain list', () => {
    // Every row predating flavors is a real list. Defaulting the other way
    // would hide all of them.
    expect(isDomainList(list('d', undefined))).toBe(true)
    expect(isDomainList(list('e', null))).toBe(true)
    expect(isLabelList(list('f', undefined))).toBe(false)
  })

  it('handles null/undefined lists without throwing', () => {
    expect(isLabelList(null)).toBe(false)
    expect(isDomainList(undefined)).toBe(true)
  })
})

describe('filtering list surfaces (60f5849d)', () => {
  const all = [
    list('regular-1', 'regular'),
    list('legacy-1', undefined),
    list('label-1', 'label'),
    list('status-1', 'status'),
  ]

  it('keeps labels and board columns out of list-shaped surfaces', () => {
    expect(filterDomainLists(all).map(l => (l as { id: string }).id))
      .toEqual(['regular-1', 'legacy-1'])
  })

  it('selects only labels for the label picker', () => {
    expect(filterLabelLists(all).map(l => (l as { id: string }).id)).toEqual(['label-1'])
  })

  it('splits a task\'s memberships into lists and labels, dropping statuses', () => {
    // A status membership is rendered as a board column; repeating it as a row
    // chip is noise.
    const split = splitTaskLists(all)
    expect(split.lists.map(l => (l as { id: string }).id)).toEqual(['regular-1', 'legacy-1'])
    expect(split.labels.map(l => (l as { id: string }).id)).toEqual(['label-1'])
  })

  it('handles a task with no lists', () => {
    expect(splitTaskLists(undefined)).toEqual({ lists: [], labels: [] })
    expect(splitTaskLists([])).toEqual({ lists: [], labels: [] })
  })
})

describe('canConvertListFlavor (60f5849d)', () => {
  it('allows regular ⇄ label', () => {
    expect(canConvertListFlavor('regular', 'label')).toBe(true)
    expect(canConvertListFlavor('label', 'regular')).toBe(true)
    // A legacy null listType is a regular list.
    expect(canConvertListFlavor(null, 'label')).toBe(true)
  })

  it('refuses conversions involving status', () => {
    // Status lists are board machinery with invariants (at most one per task)
    // that a conversion would silently violate.
    expect(canConvertListFlavor('regular', 'status')).toBe(false)
    expect(canConvertListFlavor('status', 'label')).toBe(false)
  })

  it('refuses a no-op conversion', () => {
    expect(canConvertListFlavor('label', 'label')).toBe(false)
  })
})

describe('GitHub label mapping (60f5849d)', () => {
  it('parses the comma-joined metadata GitHub sync already carries', () => {
    expect(parseGithubLabels('bug,regression,needs triage'))
      .toEqual(['bug', 'regression', 'needs triage'])
  })

  it('trims and drops empties', () => {
    expect(parseGithubLabels(' bug , , regression ')).toEqual(['bug', 'regression'])
  })

  it('de-duplicates case-insensitively', () => {
    // GitHub treats "Bug" and "bug" as distinct labels. Users do not.
    expect(parseGithubLabels('Bug,bug,BUG')).toEqual(['Bug'])
  })

  it('handles absent metadata', () => {
    expect(parseGithubLabels(null)).toEqual([])
    expect(parseGithubLabels('')).toEqual([])
  })

  it('matches existing label lists and reports the missing ones', () => {
    const result = reconcileGithubLabels(
      ['bug', 'Regression', 'brand-new'],
      [{ id: 'l1', name: 'Bug' }, { id: 'l2', name: 'regression' }]
    )
    expect(result.matchedListIds).toEqual(['l1', 'l2'])
    expect(result.missingNames).toEqual(['brand-new'])
  })

  it('reports everything missing when no label lists exist yet', () => {
    const result = reconcileGithubLabels(['bug'], [])
    expect(result.matchedListIds).toEqual([])
    expect(result.missingNames).toEqual(['bug'])
  })
})
