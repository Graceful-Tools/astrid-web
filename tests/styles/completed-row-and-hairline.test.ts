/**
 * AWTD-1617, astrid-core register DS18 and DS20.
 *
 * DS18: a completed task is its title struck through and muted, as on iOS and
 * the Mac. Web also dimmed the whole row to 75%, which faded the row's
 * labels, dates and surface along with it.
 *
 * DS20: a hairline is the token's half point (`size.hairline`). Tailwind's
 * `border` drew 1px everywhere; it now reads `--hairline-width`, which is the
 * token on a high-density screen and a whole pixel where half of one cannot be
 * drawn.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { designTokens } from '@/lib/design/tokens'
import { compileClasses, ruleFor } from './compile-tailwind'

const css = readFileSync(join(process.cwd(), 'styles', 'components.css'), 'utf8')

describe('DS18: a completed row is not dimmed (AWTD-1617)', () => {
  it('gives .task-row-completed no opacity', () => {
    expect(css).not.toMatch(/\.task-row-completed\s*\{[^}]*opacity/)
  })

  it('still strikes the title through', () => {
    expect(css).toMatch(/\.task-title-completed\s*\{[^}]*line-through/)
  })
})

describe('DS20: a border is a hairline (AWTD-1617)', () => {
  it('compiles `border`, `border-b` and `divide-y` to the hairline width', async () => {
    const out = await compileClasses(['border', 'border-b', 'divide-y'])
    expect(ruleFor(out, 'border')).toContain('border-width: var(--hairline-width)')
    expect(ruleFor(out, 'border-b')).toContain('border-bottom-width: var(--hairline-width)')
    expect(out).toContain('var(--hairline-width)')
  })

  it('leaves the wider borders alone', async () => {
    const out = await compileClasses(['border-2'])
    expect(ruleFor(out, 'border-2')).toContain('border-width: 2px')
  })

  it("keeps a Decision card's 1 pt edge whole (DESIGN_SYSTEM.md → Markdown)", async () => {
    const out = await compileClasses(['border-1'])
    expect(ruleFor(out, 'border-1')).toContain('border-width: 1px')
    const cards = readFileSync(join(process.cwd(), 'components/task-detail/DecisionCards.tsx'), 'utf8')
    expect(cards).toMatch(/rounded-lg border-1 px-3/)
  })

  it('is a whole pixel by default and the token on a high-density screen', () => {
    expect(designTokens.size.hairline).toBe(0.5)
    expect(css).toMatch(/:root \{[^}]*--hairline-width: 1px;/)
    expect(css).toMatch(
      /@media \(min-resolution: 2dppx\) \{\s*:root \{\s*--hairline-width: var\(--astrid-size-hairline\);/,
    )
  })
})
