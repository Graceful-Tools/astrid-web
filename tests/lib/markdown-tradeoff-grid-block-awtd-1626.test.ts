/**
 * AWTD-1626: a trade-off grid reads back as a `tradeoffGrid` block, so the markdown contract
 * (contracts/fixtures/markdown.json) pins the grid and astrid-core's `markdown::render` can emit
 * the same block for every native shell, instead of each re-recognising a plain table.
 *
 * Before this, the grid's `<div class="tradeoff">` was not a block the reader knew, so its
 * header, cells, spoken labels and key ran together into one paragraph.
 */
import { describe, expect, it } from 'vitest'
import { renderMarkdownWithLinks } from '@/lib/markdown'
import { BRAND } from '@/lib/brand/config'
import { blocksOfHtml } from '../../scripts/contract-fixtures/markdown-blocks.mjs'

const text = (t: string, style: Record<string, unknown> = {}) => ({
  kind: 'text', text: t, bold: false, italic: false, strike: false, code: false, link: null, ...style,
})

const blocks = (markdown: string) => blocksOfHtml(document, renderMarkdownWithLinks(markdown), { origin: `https://${BRAND.domain}` })

describe('a trade-off grid as a block (AWTD-1626)', () => {
  it('reads header, option names, ratings and key without the renderer chrome', () => {
    const [grid] = blocks('| Option | Cost |\n|---|:-:|\n| A. Lisbon | ++ **cheap** |\n| **2)** Porto | 🔴 |\n| B |  |')
    expect(grid).toEqual({
      kind: 'tradeoffGrid',
      alignments: ['none', 'center'],
      // No column letter: a shell letters criteria by position.
      header: [[text('Option')], [text('Cost')]],
      rows: [
        // The writer's marker and the renderer's "1. " are gone: rows are numbered by position.
        { name: [text('Lisbon')], cells: [{ rating: 'veryGood', inlines: [text('cheap', { bold: true })] }] },
        // A rating-only cell shows its token, so it still reads without colour.
        { name: [text('Porto')], cells: [{ rating: 'poor', inlines: [text('🔴')] }] },
        { name: [], cells: [{ rating: null, inlines: [] }] },
      ],
      key: ['poor', 'veryGood'],
    })
  })

  it('names a rating by its label key, so - and 🔴 read the same', () => {
    const [grid] = blocks('| Option | Cost |\n|---|---|\n| One | - dear |\n| Two | 🔴 dear |') as Array<{
      rows: Array<{ cells: Array<{ rating: string }> }>
      key: string[]
    }>
    expect(grid.rows.map(r => r.cells[0].rating)).toEqual(['poor', 'poor'])
    expect(grid.key).toEqual(['poor'])
  })

  it('leaves a table that is not a grid a table', () => {
    expect(blocks('| Option | Cost |\n|---|---|\n| One | + cheap |\n| Two | dear |')[0]).toMatchObject({ kind: 'table' })
  })
})
