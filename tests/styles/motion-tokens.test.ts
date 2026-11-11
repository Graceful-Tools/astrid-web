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
