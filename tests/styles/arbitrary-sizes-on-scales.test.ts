/**
 * AWTD-1615: the arbitrary sizes moved onto the type scale, the hit target and
 * named layout widths. Each class must read the token, and the token must hold
 * the size the literal wrote, so nothing moved except where a size snapped.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { compileClasses, ruleFor } from './compile-tailwind'

const read = (...path: string[]) => readFileSync(join(process.cwd(), ...path), 'utf8')
const tokens = read('packages', 'astrid-design', 'astrid-tokens.css')
const components = read('styles', 'components.css')
const valueOf = (css: string, name: string) => new RegExp(`--${name}:\\s*([^;]+);`).exec(css)?.[1].trim()

describe('sizes from the scales (AWTD-1615)', () => {
  it.each([
    ['text-caption2', 'font-size', 'astrid-type-comfortable-caption2-size', '11px'],
    ['text-caption1', 'font-size', 'astrid-type-comfortable-caption1-size', '12px'],
    ['text-footnote', 'font-size', 'astrid-type-comfortable-footnote-size', '13px'],
    ['min-h-hit-target', 'min-height', 'astrid-size-comfortable-hit-target', '44px'],
    ['min-w-hit-target', 'min-width', 'astrid-size-comfortable-hit-target', '44px'],
  ])('%s reads the token (%s: %s = %s)', async (className, property, token, size) => {
    const rule = ruleFor(await compileClasses([className]), className)
    expect(rule).toBe(`${property}: var(--${token})`)
    expect(valueOf(tokens, token)).toBe(size)
  })

  it.each([
    ['min-w-pane-min', 'min-width', 'pane-min-width', '280px'],
    ['w-popover-wide', 'width', 'popover-wide-width', '22rem'],
  ])('%s is a web layout width named once', async (className, property, variable, size) => {
    expect(ruleFor(await compileClasses([className]), className)).toBe(`${property}: var(--${variable})`)
    expect(valueOf(components, variable)).toBe(size)
  })

  it('the small type sizes set the size only, like the literals they replace', async () => {
    expect(ruleFor(await compileClasses(['text-caption2']), 'text-caption2')).not.toContain('line-height')
  })

  it('the speech bubble tail is drawn once, at the popover\'s geometry', () => {
    expect(components).toMatch(/\.speech-bubble-tail \{[^}]*border-width: 12px 16px 12px 0;[^}]*\}/)
    expect(components).toMatch(/\.speech-bubble-tail\.speech-bubble-tail-fill \{[^}]*border-width: 9px 13px 10px 0;[^}]*\}/)
    for (const path of ['components/reminder-notification.tsx', 'components/astrid-reminder-popover.tsx', 'components/ui/astrid-empty-state.tsx']) {
      expect(read(...path.split('/')), path).toContain('<SpeechBubbleTail />')
    }
  })
})
