/**
 * AWTD-1574 (register DS4): the leading control is `size.leading-control`, 34.
 *
 * Web drew 32 px, as `w-8 h-8` and `width={32}` in five places. Every place the
 * control is sized now names the token, through the `leading-control` step of
 * Tailwind's spacing scale or `LEADING_CONTROL_SIZE`, so the next change to the
 * token moves all of them and none can be left behind.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { LEADING_CONTROL_SIZE, designTokens } from '@/lib/design/tokens'

import { compileClasses, ruleFor } from '../styles/compile-tailwind'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

/** Where a leading control, or something drawn to its size, is sized. */
const DRAWN_IN = [
  'components/task-leading-control.tsx',
  'components/task-checkbox.tsx',
  'components/quick-add.tsx',
  'components/task-detail/TaskFieldRow.tsx',
]

describe('the leading control is the token\'s size (AWTD-1574)', () => {
  it('is 34, from the vendored tokens', () => {
    expect(LEADING_CONTROL_SIZE).toBe(designTokens.size.comfortable['leading-control'])
    expect(LEADING_CONTROL_SIZE).toBe(34)
  })

  it('has a Tailwind step that reads the token, not a number', async () => {
    const css = await compileClasses(['w-leading-control', 'h-leading-control'])
    expect(ruleFor(css, 'w-leading-control')).toBe('width: var(--astrid-size-comfortable-leading-control)')
    expect(ruleFor(css, 'h-leading-control')).toBe('height: var(--astrid-size-comfortable-leading-control)')
  })

  it.each(DRAWN_IN)('%s sizes it with the token', (file) => {
    const source = read(file)
    expect(source).toMatch(/w-leading-control/)
    // The literal it replaced: a 32px square, or a 32px image.
    expect(source.match(/\b(?:w-8 h-8|h-8 w-8)\b|(?:width|height)=\{32\}/g) ?? []).toEqual([])
  })

  it('the drag placeholder in the list is the same size', () => {
    expect(read('components/TaskManager/MainContent/MainContent.tsx')).toContain(
      'flex h-leading-control w-leading-control items-center justify-center rounded-lg border',
    )
  })
})
