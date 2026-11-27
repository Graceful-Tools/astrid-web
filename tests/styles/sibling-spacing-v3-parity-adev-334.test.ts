/**
 * ADEV-334: Tailwind 4 moved `space-*` and `divide-*` from "every child but the first gets a start
 * margin/border" to "every child but the last gets an end margin/border". The first child of a
 * `space-x-3` row then gets a 12px end margin that overrides its own `-m-2`, which moved every task
 * row 16px right in the Tailwind 3 → 4 screenshot comparison. The build keeps v3's rule
 * (lib/design/tailwind-v3-sibling-spacing.mjs); these tests read the CSS the classes compile to.
 */
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import postcss from 'postcss'
import siblingSpacing from '../../lib/design/tailwind-v3-sibling-spacing.mjs'
import { compileClasses } from './compile-tailwind'

const V3 = ' > :not([hidden]) ~ :not([hidden])'

function rule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) return ''
  return css.slice(start, css.indexOf('}', start)).replace(/\s+/g, ' ')
}

describe('space-* and divide-* keep the Tailwind 3 sibling rule (ADEV-334)', () => {
  it('space-x puts the start margin on every child but the first, never an end margin on the first', async () => {
    const css = await compileClasses(['space-x-3'])
    const body = rule(css, `.space-x-3${V3}`)
    expect(body).toContain('margin-left: calc(calc(var(--spacing) * 3) * calc(1 - var(--tw-space-x-reverse)))')
    expect(body).toContain('margin-right: calc(calc(var(--spacing) * 3) * var(--tw-space-x-reverse))')
    expect(body).not.toContain('margin-inline')
  })

  it('space-y puts the top margin on every child but the first', async () => {
    const css = await compileClasses(['space-y-4', '-space-y-px'])
    expect(rule(css, `.space-y-4${V3}`)).toContain('margin-top: calc(calc(var(--spacing) * 4) * calc(1 - var(--tw-space-y-reverse)))')
    expect(rule(css, `.space-y-4${V3}`)).toContain('margin-bottom: calc(calc(var(--spacing) * 4) * var(--tw-space-y-reverse))')
    expect(rule(css, `.-space-y-px${V3}`)).toContain('margin-top: calc(-1px * calc(1 - var(--tw-space-y-reverse)))')
  })

  it('divide-y draws the top border of every child but the first', async () => {
    const css = await compileClasses(['divide-y', 'divide-gray-200', 'dark:divide-gray-700'])
    const body = rule(css, `.divide-y${V3}`)
    expect(body).toContain('border-top-width: calc(1px * calc(1 - var(--tw-divide-y-reverse)))')
    expect(body).toContain('border-bottom-width: calc(1px * var(--tw-divide-y-reverse))')
    expect(rule(css, `.divide-gray-200${V3}`)).toContain('border-color')
    expect(rule(css, `.dark\\:divide-gray-700:is(.dark *)${V3}`)).toContain('border-color')
  })

  it('keeps variants and reverse', async () => {
    const css = await compileClasses(['md:space-x-2', 'space-x-reverse'])
    expect(rule(css, `.md\\:space-x-2${V3}`)).toContain('margin-left')
    expect(rule(css, `.space-x-reverse${V3}`)).toContain('--tw-space-x-reverse: 1')
  })

  it('leaves other :not(:last-child) rules alone', async () => {
    const input = ':where(.gap-row > :not(:last-child)) { margin-inline-end: 4px }'
    const result = await postcss([siblingSpacing()]).process(input, { from: undefined })
    expect(result.css).toBe(input)
  })

  it('rewrites minified output, as a production build emits it', async () => {
    const input = ':where(.space-x-3>:not(:last-child)){margin-inline-end:12px}'
    const result = await postcss([siblingSpacing()]).process(input, { from: undefined })
    expect(result.css).toBe('.space-x-3 > :not([hidden]) ~ :not([hidden]){margin-left:12px}')
  })

  it('rewrites a component class that applies space-x, as styles/components.css .task-row does', async () => {
    const { default: tailwindcss } = await import('@tailwindcss/postcss')
    const root = resolve(__dirname, '../..')
    const input = '@reference "../app/globals.css";\n.task-row { @apply flex space-x-3; }'
    const result = await postcss([tailwindcss({ base: root, optimize: { minify: false } }), siblingSpacing()]).process(input, {
      from: resolve(root, 'styles/apply-fixture.css'),
    })
    expect(result.css).not.toContain(':not(:last-child)')
    const body = rule(result.css, `.task-row${V3}`)
    expect(body).toContain('margin-left: calc(calc(var(--spacing')
    expect(body).not.toContain('margin-inline')
  })

  it('runs in the build, after Tailwind', async () => {
    const { default: config } = await import('@/postcss.config.mjs')
    expect(config.plugins).toEqual(['@tailwindcss/postcss', siblingSpacing])
  })
})
