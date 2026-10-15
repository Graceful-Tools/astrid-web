/**
 * Search, inline at the far right of the sidebar's brand header (AWTD-1180).
 *
 * Jon, choosing the search entry point: *"(a) but add search icon inline on far
 * right. Logo left header with Astrid / brand logo on top left. Do across
 * interfaces."*
 *
 * (a) is the sidebar's Search ROW, which web already had, and the brand logo
 * was already top-left. What was missing was the inline icon — a way into
 * search from the header itself, without reading down the nav. The row STAYS:
 * Jon asked for (a) *and* the icon.
 *
 * PINNED AT THE SOURCE, in the idiom `task-detail-field-order.test.ts` uses for
 * this component family: *"rendering the component in jsdom would need the
 * twenty-odd props and pickers it depends on to prove a thing about sequence."*
 * `LeftSidebar` is that component — a render needs the session, the router, the
 * count memos and a dozen handlers, and the result would still only tell us
 * what this reads straight off the markup. The behaviour was checked by
 * rendering the real sidebar in a browser and looking at it.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const src = readFileSync(
  join(process.cwd(), 'components/TaskManager/Sidebar/LeftSidebar.tsx'),
  'utf8',
)

/** The brand header: logo, then whatever sits at its right. */
const header = (() => {
  const start = src.indexOf('{/* Astrid brand header */}')
  if (start === -1) throw new Error('AWTD-1180: the brand header comment is gone — re-derive this test')
  return src.slice(start, src.indexOf('<div className="p-3">', start))
})()

describe('sidebar brand header search (AWTD-1180)', () => {
  it('puts a search control in the brand header', () => {
    expect(header).toContain('aria-label={t("search.open")}')
    expect(header).toMatch(/<Search className="w-4 h-4" \/>/)
  })

  it('opens search through the SAME handler as the nav row', () => {
    // Two entry points, one destination. Separate handlers is how one of them
    // quietly ends up going somewhere else after a refactor.
    const uses = src.match(/onClick=\{handleSearchClick\}/g) ?? []
    expect(uses.length).toBe(2)
  })

  it('keeps the nav Search row — the icon is an addition, not a replacement', () => {
    // Jon asked for (a) AND the icon. Losing the row would be answering a
    // different question from the one he was asked.
    expect(src).toContain('{/* Search */}')
    expect(src).toContain('t("search.placeholder")')
  })

  it('keeps the logo left and the search right, in that order', () => {
    const logo = header.indexOf('BRAND.iconSmall')
    const search = header.indexOf('t("search.open")')
    expect(logo).toBeGreaterThan(-1)
    expect(search).toBeGreaterThan(logo)
  })

  it('labels the control for a screen reader rather than shipping a bare icon', () => {
    expect(header).toContain('title={t("search.open")}')
  })
})
