/**
 * AWTD-1175 — where Sort & Filters lives, by layout.
 *
 * The regression this pins is not "the funnel is in the wrong place". It is
 * that between 2026-09-13 (aa4e7eb0, which moved sort & filters out of List
 * Settings to a 3-column-only funnel) and this change, a user list on a 1- or
 * 2-column layout had NO way to sort or filter: the funnel was not rendered,
 * and the one button in the header opened a modal that no longer contained it.
 *
 * So the test that matters is the complement one — every layout must offer
 * exactly one entry point. Two would be clutter; zero was the bug.
 */
import { describe, it, expect } from 'vitest'
import {
  type ColumnCount,
  sortAndFiltersIsItsOwnControl,
  sortAndFiltersLivesInListSettings,
} from '@/lib/list-view-controls'

const LAYOUTS: ColumnCount[] = [1, 2, 3]

describe('where Sort & Filters lives', () => {
  it('gives every layout exactly one entry point', () => {
    for (const columnCount of LAYOUTS) {
      const own = sortAndFiltersIsItsOwnControl(columnCount)
      const inSettings = sortAndFiltersLivesInListSettings(columnCount)
      expect(
        [own, inSettings].filter(Boolean),
        `${columnCount}-column must have exactly one entry point, not ${[own, inSettings].filter(Boolean).length}`,
      ).toHaveLength(1)
    }
  })

  it('keeps the funnel as its own control in 3 columns', () => {
    // Jon, 2026-10-12: "On 3 column spit out the filter / sort web." This is
    // the half of the decision that leaves aa4e7eb0 intact.
    expect(sortAndFiltersIsItsOwnControl(3)).toBe(true)
    expect(sortAndFiltersLivesInListSettings(3)).toBe(false)
  })

  it('reaches it through List Settings on one and two columns', () => {
    // "On mobile single column follow iOS iPhone" — where there is one button,
    // it goes behind that button. 2-column has the same single-button header,
    // so it is the same case, not a third one.
    for (const narrow of [1, 2] as ColumnCount[]) {
      expect(sortAndFiltersLivesInListSettings(narrow)).toBe(true)
      expect(sortAndFiltersIsItsOwnControl(narrow)).toBe(false)
    }
  })
})
