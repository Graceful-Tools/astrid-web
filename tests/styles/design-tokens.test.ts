/**
 * The design system's web half (docs/specs/DESIGN_SYSTEM.md).
 *
 * How Astrid looks has one source, astrid-core's design/tokens.json, generated
 * into packages/astrid-design and never edited here. Before it the web kept
 * its own palette beside iOS's, Android's and Windows', held alike by comments
 * saying "matches iOS", and had three colours for medium priority.
 *
 * CSS cannot be exercised in jsdom, so these read the files.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  priorityColor,
  priorityFillClass,
  priorityOutlineClass,
  priorityTextClass,
} from '@/lib/design/priority'
import { THEME_NAMES, designTokens, themeColor, themeColorNames } from '@/lib/design/tokens'
import { getPriorityColor } from '@/lib/task-leading-control'
import { getPriorityColorClass } from '@/lib/task-manager-utils'

const read = (...path: string[]) => readFileSync(join(process.cwd(), ...path), 'utf8')

const tokensCss = read('packages', 'astrid-design', 'astrid-tokens.css')

/** The declarations inside `.theme { … }` of the vendored stylesheet. */
function themeBlock(theme: string): Map<string, string> {
  const start = tokensCss.indexOf(`\n.${theme} {`)
  if (start === -1) throw new Error(`.${theme} is not in astrid-tokens.css`)
  const body = tokensCss.slice(tokensCss.indexOf('{', start) + 1, tokensCss.indexOf('}', start))
  const declarations = new Map<string, string>()
  for (const match of body.matchAll(/--astrid-([a-z0-9-]+):\s*([^;]+);/g)) {
    declarations.set(match[1], match[2].trim())
  }
  return declarations
}

describe('the vendored design tokens', () => {
  it('are astrid-core\'s generated file, not a hand-edited copy', () => {
    const [stamp, hashLine, ...body] = tokensCss.split('\n')
    expect(stamp).toContain('GENERATED')
    const recorded = /body-sha256: ([0-9a-f]{64})/.exec(hashLine)?.[1]
    const actual = createHash('sha256').update(body.join('\n')).digest('hex')
    expect(actual, 'edit design/tokens.json in astrid-core, then scripts/sync-design-tokens.sh').toBe(recorded)
  })

  it('name the astrid-core revision they were copied from', () => {
    expect(read('packages', 'astrid-design', 'REVISION').trim()).toMatch(/^[0-9a-f]{40}$/)
  })

  it('say the same thing as CSS and as data, for every theme', () => {
    for (const theme of THEME_NAMES) {
      const block = themeBlock(theme)
      expect([...block.keys()].sort()).toEqual(themeColorNames().sort())
      for (const name of themeColorNames()) {
        const triplet = themeColor(theme, name).join(', ')
        // A brand colour is `var(--brand-…-rgb, <Astrid's value>)`.
        expect(block.get(name), `${theme} ${name}`).toContain(triplet)
      }
    }
  })
})

describe('the theme stylesheets take their colours from the tokens', () => {
  for (const theme of THEME_NAMES) {
    it(`${theme}: no shared colour is written out`, () => {
      const css = read('styles', 'themes', `${theme}-theme.css`)
      const shared = new Set(themeColorNames())
      const literal: string[] = []
      let seen = 0
      for (const match of css.matchAll(/--theme-([a-z0-9-]+):\s*([^;]+);/g)) {
        if (!shared.has(match[1])) continue
        seen += 1
        if (match[2].trim() !== `var(--astrid-${match[1]})`) literal.push(`--theme-${match[1]}: ${match[2].trim()}`)
      }
      expect(literal).toEqual([])
      expect(seen, 'the stylesheet still declares the shared variables').toBeGreaterThan(20)
    })
  }

  it('loads the tokens before the stylesheets that read them', () => {
    const layout = read('app', '[locale]', 'layout.tsx')
    const tokens = layout.indexOf('packages/astrid-design/astrid-tokens.css')
    expect(tokens).toBeGreaterThan(-1)
    expect(tokens).toBeLessThan(layout.indexOf('styles/themes/light-theme.css'))
  })
})

describe('priority has one colour each, everywhere', () => {
  it('comes from the tokens, and low is the brand accent', () => {
    expect(priorityColor(0)).toBe('rgb(var(--astrid-priority-none))')
    expect(priorityColor(1)).toBe('rgb(var(--astrid-priority-low))')
    expect(priorityColor(2)).toBe('rgb(var(--astrid-priority-medium))')
    expect(priorityColor(3)).toBe('rgb(var(--astrid-priority-high))')
    expect(priorityColor(99)).toBe('rgb(var(--astrid-priority-none))')
    expect(designTokens.themes.light.colors['priority-low']).toBe('{brand.accent}')
    expect(themeColor('light', 'priority-medium')).toEqual([251, 191, 36])
  })

  it('the leading control and the header ask the same home', () => {
    expect(getPriorityColor(2)).toBe(priorityColor(2))
    expect(getPriorityColorClass(2)).toBe(priorityTextClass(2))
  })

  it('has a class for text, a filled control and an outlined one', () => {
    const css = read('styles', 'components.css')
    for (const priority of [0, 1, 2, 3]) {
      for (const name of [priorityTextClass(priority), priorityFillClass(priority), priorityOutlineClass(priority)]) {
        expect(css, name).toContain(`.${name}`)
      }
    }
  })

  // The three "mediums": amber on the row, yellow-500 in the pickers, orange-500
  // in the header and the filter menu.
  it.each([
    'components/ui/priority-picker.tsx',
    'components/priority-assignee-picker.tsx',
    'components/task-detail.tsx',
    'components/list-settings/filter-options.tsx',
    'lib/task-manager-utils.ts',
    'lib/task-leading-control.ts',
  ])('%s draws priority from the tokens', (file) => {
    const source = read(...file.split('/'))
    expect(source.split('\n').filter((line) => /(yellow|orange)-\d00|rgb\(251, 191, 36\)/.test(line))).toEqual([])
  })
})

describe('priority classes hold up where they are used (PR #699 review)', () => {
  const css = read('styles', 'components.css')

  it('"no priority" text is the theme\'s muted text, readable on the dark header', () => {
    expect(css).toMatch(/\.priority-text-none \{ color: rgb\(var\(--astrid-text-muted\)\); \}/)
  })

  it('a filled control keeps its colour on hover', () => {
    for (const name of ['none', 'low', 'medium', 'high']) {
      expect(css).toContain(`.priority-fill-${name}:hover { background-color: rgb(var(--astrid-priority-${name})); }`)
    }
  })
})

describe('the trade-off grid draws its ratings from the tokens', () => {
  const css = read('app', 'globals.css')

  it.each([
    ['very-poor', 1],
    ['poor', 2],
    ['mixed', 3],
    ['good', 4],
    ['very-good', 5],
  ])('%s is rating %i, fill and text', (name, index) => {
    expect(css).toContain(
      `.tradeoff-${name} { background-color: rgb(var(--astrid-palette-tradeoff-${index})); color: rgb(var(--astrid-palette-tradeoff-text-${index})); }`,
    )
    expect(tokensCss).toContain(`--astrid-palette-tradeoff-${index}:`)
    expect(tokensCss).toContain(`--astrid-palette-tradeoff-text-${index}:`)
  })

  it('markdown borders follow the theme', () => {
    expect(css).not.toMatch(/\.prose[^{]*\{[^}]*#d1d5db/)
  })
})
