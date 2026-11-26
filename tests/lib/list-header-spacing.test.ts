/**
 * AWTD-1264 — on the board view, the gap between the list description and the
 * Sort & Filters control was 44px.
 *
 * The header's `mb-6` exists to separate it from the "Add a task..." input,
 * which the board view does not render. With nothing below it, that margin plus
 * the row's own `mb-4` and the block's `pb-5` all stacked above the funnel.
 *
 * The MainContent half (the header really takes this margin) renders the
 * component: tests/components/main-content-render.test.tsx.
 */

import { describe, it, expect } from 'vitest'
import { listHeaderBottomMarginClass } from '@/lib/list-header-spacing'

describe('listHeaderBottomMarginClass (AWTD-1264)', () => {
  it('keeps the list view gap above the add-task input', () => {
    expect(listHeaderBottomMarginClass({ boardMode: false })).toBe('mb-6')
  })

  it('drops the margin on the board, where no add-task input follows the header', () => {
    expect(listHeaderBottomMarginClass({ boardMode: true })).toBe('mb-0')
  })
})

