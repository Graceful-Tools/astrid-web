/**
 * AWTD-1264 — on the board view, the gap between the list description and the
 * Sort & Filters control was 44px.
 *
 * The header's `mb-6` exists to separate it from the "Add a task..." input,
 * which the board view does not render. With nothing below it, that margin plus
 * the row's own `mb-4` and the block's `pb-5` all stacked above the funnel.
 *
 * The MainContent half pins the wiring at the source, for the reason
 * tests/components/main-content-board-height.test.ts gives: no jsdom test can
 * render that component.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { listHeaderBottomMarginClass } from '@/lib/list-header-spacing'

describe('listHeaderBottomMarginClass (AWTD-1264)', () => {
  it('keeps the list view gap above the add-task input', () => {
    expect(listHeaderBottomMarginClass({ boardMode: false })).toBe('mb-6')
  })

  it('drops the margin on the board, where no add-task input follows the header', () => {
    expect(listHeaderBottomMarginClass({ boardMode: true })).toBe('mb-0')
  })
})

describe('MainContent list header wiring (AWTD-1264)', () => {
  const src = readFileSync(
    join(process.cwd(), 'components/TaskManager/MainContent/MainContent.tsx'),
    'utf8',
  )

  it('takes the header bottom margin from the helper, in board mode on the board', () => {
    expect(src).toContain("from '@/lib/list-header-spacing'")
    expect(src).toMatch(
      /listHeaderBottomMarginClass\(\{\s*boardMode: Boolean\(hasProjectBoard && taskViewMode === 'board'\)/,
    )
  })

  it('no longer hardcodes mb-6 on the centered header', () => {
    expect(src).not.toContain('<div className="text-center mb-6">')
  })
})
