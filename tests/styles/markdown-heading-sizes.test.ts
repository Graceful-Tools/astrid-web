/**
 * AWTD-1625, astrid-core register DS24: Markdown heading sizes are type
 * tokens (`type.comfortable.markdown-h1` to `-h4`), so the prose styles read
 * them instead of writing 1.75 / 1.375 / 1.125 / 1 rem.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { designTokens } from '@/lib/design/tokens'

const globals = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8')
const tokensCss = readFileSync(join(process.cwd(), 'packages/astrid-design/astrid-tokens.css'), 'utf8')

const rule = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = globals.match(new RegExp(`^${escaped} \\{([^}]*)\\}`, 'm'))
  expect(match, `${selector} rule`).not.toBeNull()
  return match![1]
}

describe('Markdown heading sizes (AWTD-1625, DS24)', () => {
  const levels = [1, 2, 3, 4] as const

  it.each(levels)('h%i reads its size and weight from the comfortable type tokens', (level) => {
    const body = rule(`.prose h${level}`)
    expect(body).toContain(`font-size: var(--astrid-type-comfortable-markdown-h${level}-size);`)
    expect(body).toContain(`font-weight: var(--astrid-type-comfortable-markdown-h${level}-weight);`)
    expect(body).not.toMatch(/font-size:\s*[\d.]+rem/)
  })

  it.each(levels)('the vendored tokens define h%i', (level) => {
    const style = (designTokens.type.comfortable as Record<string, { size: number; weight: number }>)[
      `markdown-h${level}`
    ]
    expect(style).toBeDefined()
    expect(tokensCss).toContain(`--astrid-type-comfortable-markdown-h${level}-size: ${style.size}px;`)
  })
})
