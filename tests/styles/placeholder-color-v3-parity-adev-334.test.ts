/**
 * ADEV-334: Tailwind 4's preflight colours placeholders with half the text colour; v3's used gray-400,
 * and the comment, subtask and message boxes were designed against it. globals.css restores it.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('placeholder colour keeps Tailwind 3 gray-400 (ADEV-334)', () => {
  it('globals.css gives input and textarea placeholders gray-400 in the base layer', () => {
    const css = readFileSync(resolve(__dirname, '../../app/globals.css'), 'utf8')
    expect(css).toMatch(/@layer base\s*\{[^@]*input::placeholder,\s*textarea::placeholder\s*\{\s*color: var\(--color-gray-400\);/)
  })
})
