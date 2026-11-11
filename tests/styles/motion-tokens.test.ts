/**
 * AWTD-1574 (register DS15): the stylesheets animate with the motion tokens.
 *
 * styles/ wrote 29 durations out (0.2s, 0.35s, duration-300 …), each a private
 * guess at "quick" or "a panel". The spec's Motion table names the interaction
 * and the token; the stylesheets now name the token, and Tailwind has a
 * `duration-*` and `ease-*` utility per token so a component can too.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { designTokens } from '@/lib/design/tokens'
import { MOTION_NAMES } from '@/lib/design/tailwind-theme'
import { METRICS, withoutComments } from '@/scripts/report-design-metrics'

import { compileClasses, ruleFor } from './compile-tailwind'

const read = (...path: string[]) => readFileSync(join(process.cwd(), ...path), 'utf8')

const STYLESHEETS = [
  'app/globals.css',
  'styles/components.css',
  ...readdirSync(join(process.cwd(), 'styles', 'themes')).map((name) => `styles/themes/${name}`),
]

describe('stylesheets animate with the motion tokens (AWTD-1574)', () => {
  const literal = METRICS.find((metric) => metric.id === 'motionLiterals')!.pattern

  it('no stylesheet writes a duration out', () => {
    const found = STYLESHEETS.flatMap((path) =>
      (withoutComments(read(...path.split('/'))).match(literal) ?? []).map((match) => `${path}: ${match}`),
    )
    // The one that stays is not a design value: the drawer's tap guard switches
    // pointer-events with no duration of its own, after the drawer's.
    expect(found).toEqual(['styles/components.css: 0s'])
  })

  it('the drawer reads the drawer token, so the tap guard still waits for the panel', () => {
    const css = read('styles', 'components.css')
    expect(css).toContain('--ios-drawer-duration: var(--astrid-motion-drawer-duration);')
    expect(css).toContain('--ios-drawer-ease: var(--astrid-motion-drawer-ease);')
  })

  it('names every curve token Tailwind can use, and the springs by duration', () => {
    expect([...MOTION_NAMES].sort()).toEqual(
      Object.keys(designTokens.motion).filter((name) => !name.endsWith('-spring')).sort(),
    )
  })

  it.each(MOTION_NAMES)('duration-%s and its curve read the token', async (name) => {
    const css = await compileClasses([`duration-${name}`, `ease-${name}`])
    expect(ruleFor(css, `duration-${name}`)).toContain(`transition-duration: var(--astrid-motion-${name}-duration)`)
    if ('ease' in designTokens.motion[name]) {
      expect(ruleFor(css, `ease-${name}`)).toContain(`transition-timing-function: var(--astrid-motion-${name}-ease)`)
    }
  })

  it('the phone\'s details panel and the code that waits for it agree', () => {
    expect(read('styles', 'components.css')).toContain(
      'transition: transform var(--astrid-motion-panel-duration) var(--astrid-motion-panel-ease);',
    )
    expect(read('hooks', 'useTaskManagerLayout.ts')).toContain('}, designTokens.motion.panel.ms)')
  })
})

// `next build` is the only thing that ran these stylesheets through Tailwind,
// and it is too heavy for a unit test. An `@apply` of a class Tailwind does not
// know (a mistyped `duration-fastt`) fails the build, so it fails here first.
describe('the stylesheets compile with the real Tailwind config (AWTD-1574)', () => {
  it.each(['app/globals.css', 'styles/components.css'])('%s', async (path) => {
    const { default: postcss } = await import('postcss')
    const { default: tailwindcss } = await import('tailwindcss')
    const { default: config } = await import('@/tailwind.config')
    // components.css is compiled after globals.css in the app, which is where
    // `@tailwind` comes from; alone it needs the directives to @apply against.
    const source = path === 'app/globals.css' ? read(...path.split('/')) : `@tailwind utilities;\n${read(...path.split('/'))}`
    const result = await postcss([tailwindcss({ ...config, content: [{ raw: '', extension: 'html' }] })]).process(source, {
      from: join(process.cwd(), path),
    })
    expect(result.css.length).toBeGreaterThan(1000)
    expect(result.css).not.toContain('@apply')
    if (path === 'styles/components.css') {
      expect(result.css).toMatch(/\.task-panel-arrow \{[^}]*transition-duration: var\(--astrid-motion-fast-duration\)/)
      expect(result.css).toMatch(/\.transition-theme \{[^}]*transition-timing-function: var\(--astrid-motion-medium-ease\)/)
    } else {
      expect(result.css).toMatch(/border-color: rgba\(var\(--border\), var\(--tw-border-opacity, 1\)\)/)
    }
  })
})
