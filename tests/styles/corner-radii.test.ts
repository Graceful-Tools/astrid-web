/**
 * AWTD-1617, astrid-core register DS13: corner radius by kind, from the
 * `layout` tokens. A row 8; a board card 8 (touch) / 6 (pointer); a board
 * column 12 / 8; the details panel 16 / 14. Web drew rows, cards and the panel
 * at 12 (`rounded-xl`) and columns at 10.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { designTokens } from '@/lib/design/tokens'

const css = readFileSync(join(process.cwd(), 'styles', 'components.css'), 'utf8')
const board = readFileSync(join(process.cwd(), 'components', 'project-status-board.tsx'), 'utf8')

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`no rule for ${selector}`)
  return css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
}

const KINDS = {
  'row-radius': 'row-radius',
  'board-card-radius': 'board-card-radius',
  'board-column-radius': 'board-column-radius',
  'detail-panel-radius': 'detail-panel-radius',
} as const

describe('corner radii come from the layout tokens (AWTD-1617, DS13)', () => {
  it('the tokens say what the register says', () => {
    const { comfortable, compact } = designTokens.layout
    expect([comfortable['row-radius'], comfortable['board-card-radius'], comfortable['board-column-radius'], comfortable['detail-panel-radius']]).toEqual([8, 8, 12, 16])
    expect([compact['row-radius'], compact['board-card-radius'], compact['board-column-radius'], compact['detail-panel-radius']]).toEqual([8, 6, 8, 14])
  })

  it.each(Object.keys(KINDS))('--%s is compact by default and comfortable on touch', (kind) => {
    expect(css).toContain(`--${kind}: var(--astrid-layout-compact-${kind});`)
    expect(css).toMatch(new RegExp(`@media \\(pointer: coarse\\) \\{\\s*:root \\{[^}]*--${kind}: var\\(--astrid-layout-comfortable-${kind}\\);`))
  })

  it('a row, a board card and a board column read their own radius', () => {
    expect(rule('.task-card')).toContain('border-radius: var(--row-radius)')
    expect(rule('.task-card')).not.toMatch(/rounded-/)
    expect(rule('.board-card')).toContain('border-radius: var(--board-card-radius)')
    expect(css.indexOf('.board-card {')).toBeGreaterThan(css.indexOf('.task-card {'))
    expect(rule('.board-column')).toContain('border-radius: var(--board-column-radius)')
    expect(board).toMatch(/className=\{`board-column flex h-full/)
    expect(board).toMatch(/task-row task-card board-card/)
  })

  it('the details panel and its clipped content read the panel radius', () => {
    expect(rule('.task-panel-desktop')).toContain('border-radius: var(--detail-panel-radius)')
    expect(rule('.task-panel-desktop > [data-task-detail-panel]')).toContain('border-radius: var(--detail-panel-radius)')
    expect(rule('.task-panel-desktop')).not.toMatch(/rounded-xl/)
  })
})
