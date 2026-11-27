/**
 * ADEV-334: Tailwind 4's preflight colours placeholders with half the text colour; v3's used gray-400,
 * and the comment, subtask and message boxes were designed against it. app/globals.css restores it.
 * This compiles globals.css through the app's PostCSS plugins (postcss.config.mjs) and reads the result.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'
import siblingSpacing from '@/lib/design/tailwind-v3-sibling-spacing.mjs'
import { describe, expect, it } from 'vitest'

describe('placeholder colour keeps Tailwind 3 gray-400 (ADEV-334)', () => {
  it('compiled globals.css gives input and textarea placeholders gray-400', async () => {
    const from = resolve(__dirname, '../../app/globals.css')
    const result = await postcss([tailwindcss(), siblingSpacing()]).process(readFileSync(from, 'utf8'), { from })
    const rules: string[] = []
    result.root.walkRules((rule) => {
      if (rule.selector.includes('input::placeholder') && rule.selector.includes('textarea::placeholder')) rules.push(rule.toString())
    })
    expect(rules.join('\n')).toMatch(/color:\s*var\(--color-gray-400\)/)
  }, 60_000)
})
