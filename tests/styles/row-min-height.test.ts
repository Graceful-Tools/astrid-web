/**
 * AWTD-1617, astrid-core register DS14: a row is never shorter than
 * `layout.row-min-height`, 76 on touch (comfortable) and 52 with a pointer
 * (compact). Web drew 64 at every width.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { designTokens } from '@/lib/design/tokens'

const css = readFileSync(join(process.cwd(), 'styles', 'components.css'), 'utf8')

describe('row minimum height (AWTD-1617, DS14)', () => {
  it('the tokens say 76 comfortable, 52 compact', () => {
    expect(designTokens.layout.comfortable['row-min-height']).toBe(76)
    expect(designTokens.layout.compact['row-min-height']).toBe(52)
  })

  it('a task card reads --row-min-height, with no literal', () => {
    const start = css.indexOf('.task-card {')
    const body = css.slice(start, css.indexOf('}', start))
    expect(body).toContain('min-height: var(--row-min-height)')
    expect(body).not.toMatch(/min-height: \d+px/)
  })

  it('is compact by default and comfortable on touch', () => {
    expect(css).toContain('--row-min-height: var(--astrid-layout-compact-row-min-height);')
    expect(css).toMatch(/@media \(pointer: coarse\) \{\s*:root \{[^}]*--row-min-height: var\(--astrid-layout-comfortable-row-min-height\);/)
  })
})
