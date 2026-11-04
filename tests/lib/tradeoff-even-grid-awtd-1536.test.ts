/**
 * AWTD-1536: a trade-off grid's option rows are all the same height and its criteria columns
 * share the width equally, with every word still fitting; the option column may be wider.
 *
 * A table sizes each row to its own content, so a grid with one long reason drew one tall row
 * among short ones. Up to ten criteria now lay out as a CSS grid (`grid-auto-rows: 1fr`), keyed
 * by `tradeoff-cols-N`; its rows are `display: contents`, so the table roles are explicit.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderMarkdownWithLinks } from '@/lib/markdown'

const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8')

function gridOf(criteria: number): string {
  const head = ['Option', ...Array.from({ length: criteria }, (_, i) => `C${i + 1}`)]
  const row = (name: string) => ['', name, ...Array.from({ length: criteria }, () => '+ ok'), ''].join(' | ').trim()
  return [
    `| ${head.join(' | ')} |`,
    `|${head.map(() => '---').join('|')}|`,
    row('Lisbon'),
    row('Cabin'),
  ].join('\n')
}

describe('AWTD-1536 even trade-off grid', () => {
  it('marks a grid with its criteria count', () => {
    const html = renderMarkdownWithLinks(gridOf(3))
    expect(html).toMatch(/<table role="table" class="tradeoff-grid tradeoff-even tradeoff-cols-3">/)
  })

  it('gives every part of the grid its table role', () => {
    const html = renderMarkdownWithLinks(gridOf(2))
    expect(html.match(/role="rowgroup"/g)).toHaveLength(2)
    expect(html.match(/<tr role="row">/g)).toHaveLength(3)
    expect(html.match(/<th role="columnheader"/g)).toHaveLength(3)
    expect(html.match(/<td role="rowheader"/g)).toHaveLength(2)
    expect(html.match(/<td role="cell"/g)).toHaveLength(4)
  })

  it('defines a column count for every grid it marks', () => {
    for (let n = 1; n <= 10; n++) {
      expect(renderMarkdownWithLinks(gridOf(n))).toContain(`tradeoff-cols-${n}"`)
      expect(css).toContain(`.tradeoff-cols-${n} { --tradeoff-cols: ${n}; }`)
    }
  })

  it('leaves a grid wider than ten criteria in the table layout', () => {
    const html = renderMarkdownWithLinks(gridOf(11))
    expect(html).toContain('<table class="tradeoff-grid">')
    expect(html).not.toContain('tradeoff-even')
    expect(html).not.toContain('role="row"')
  })

  it('sizes rows equally and columns by share, never below their longest word', () => {
    const rule = css.match(/table\.tradeoff-grid\.tradeoff-even \{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toContain('display: grid')
    expect(rule).toContain('grid-auto-rows: 1fr')
    // `1fr` is minmax(auto, 1fr): a column never shrinks below its longest word.
    expect(rule).toContain('repeat(var(--tradeoff-cols), 1fr)')
    expect(rule).toMatch(/minmax\(var\(--tradeoff-option-min\), max-content\)/)
  })
})
