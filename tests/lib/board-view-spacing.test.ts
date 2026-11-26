/**
 * ADEV-289 — the board view had too much space above the boards and too little
 * between a column's title and its top card.
 *
 * Above: the list title row kept the `mb-4` that separates it from "Add a
 * task..." in list view, though the board renders no add-task input. It stacked
 * with the header block's `pb-5` into ~36px of blank space under the title.
 *
 * Inside a column: the compact (pointer) well had 0 padding on top, so the first
 * card sat flush against the header's divider. It now gets the card gap, the
 * same space that separates one card from the next. Comfortable already had 8px
 * and is unchanged.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { listTitleRowBottomMarginClass } from '@/lib/list-header-spacing'

describe('listTitleRowBottomMarginClass (ADEV-289)', () => {
  it('keeps the list view gap under the title row', () => {
    expect(listTitleRowBottomMarginClass({ boardMode: false })).toBe('mb-4')
  })

  it('drops it on the board, where nothing follows the title row', () => {
    expect(listTitleRowBottomMarginClass({ boardMode: true })).toBe('mb-0')
  })
})

describe('MainContent title row wiring (ADEV-289)', () => {
  const src = readFileSync(join(process.cwd(), 'components/TaskManager/MainContent/MainContent.tsx'), 'utf8')

  it('takes both title rows (user list and system list) from the helper', () => {
    const uses = src.match(/listTitleRowBottomMarginClass\(\{\s*boardMode: Boolean\(hasProjectBoard && taskViewMode === 'board'\)/g) ?? []
    expect(uses.length).toBe(2)
  })
})

describe('board column well (ADEV-289)', () => {
  const css = readFileSync(join(process.cwd(), 'styles/components.css'), 'utf8')
  const rule = css.match(/\.board-column-body\s*\{([^}]*)\}/)?.[1] ?? ''

  it('never lets the top card touch the column header', () => {
    expect(rule).toMatch(/padding:\s*max\(var\(--board-column-body-padding-y\),\s*var\(--board-card-gap\)\)/)
  })
})
