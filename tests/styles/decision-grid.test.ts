/**
 * AWTD-1617, astrid-core register DS23: the trade-off grid and Decision cards
 * take iOS's measures from the `markdown` tokens. Web drew a 4 gap, radius 6
 * cells and a 12 swatch; the tokens say 3, 4 and 10, cells 84-150 wide,
 * cards at radius 10 with a 24 number badge.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { designTokens } from '@/lib/design/tokens'

const css = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8')
const cards = readFileSync(join(process.cwd(), 'components/task-detail/DecisionCards.tsx'), 'utf8')

function rule(selector: string): string {
  // At the start of a line: `.tradeoff-viewer .tradeoff-scroll …` must not match `.tradeoff-scroll …`.
  const at = css.indexOf(`\n${selector} {`)
  if (at === -1) throw new Error(`no rule for ${selector}`)
  const start = at + 1
  return css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
}

describe('trade-off grid and Decision cards (AWTD-1617, DS23)', () => {
  it('the tokens say what iOS draws', () => {
    expect(designTokens.markdown).toMatchObject({
      'tradeoff-gap': 3,
      'tradeoff-cell-radius': 4,
      'tradeoff-swatch': 10,
      'tradeoff-cell-min': 84,
      'tradeoff-cell-max': 150,
      'decision-card-radius': 10,
      'decision-badge': 24,
    })
  })

  it('the grid spaces, sizes and rounds its cells from the tokens', () => {
    const grid = rule('.tradeoff-scroll table.tradeoff-grid')
    expect(grid).toContain('border-spacing: var(--astrid-markdown-tradeoff-gap)')
    expect(grid).toContain('--tradeoff-cell-min: var(--astrid-markdown-tradeoff-cell-min)')
    expect(grid).toContain('--tradeoff-cell-max: var(--astrid-markdown-tradeoff-cell-max)')
    expect(rule('.tradeoff-scroll table.tradeoff-grid td')).toContain('border-radius: var(--astrid-markdown-tradeoff-cell-radius)')
    expect(rule('.tradeoff-scroll table.tradeoff-grid.tradeoff-even')).toContain('gap: var(--astrid-markdown-tradeoff-gap)')
    expect(css).not.toMatch(/border-spacing: 4px|gap: 4px/)
  })

  it('the key swatch is the token', () => {
    const swatch = rule('.tradeoff-swatch')
    expect(swatch).toContain('width: var(--astrid-markdown-tradeoff-swatch)')
    expect(swatch).toContain('height: var(--astrid-markdown-tradeoff-swatch)')
  })

  it('a card is rounded by the token and numbers its option in a badge', () => {
    expect(rule('.decision-card')).toContain('border-radius: var(--astrid-markdown-decision-card-radius)')
    const badge = rule('.decision-badge')
    expect(badge).toContain('min-width: var(--astrid-markdown-decision-badge)')
    expect(badge).toContain('height: var(--astrid-markdown-decision-badge)')
    expect(badge).toContain('border-radius: 9999px')
    expect(rule('.decision-card[data-chosen] .decision-badge')).toContain('background-color: rgb(var(--astrid-accent))')
    expect(cards).toContain('className={`decision-card ')
    expect(cards).toContain('<span className="decision-badge">{option.number}</span>')
  })
})
