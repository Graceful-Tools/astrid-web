/**
 * AWTD-1575: the label on a brand or destructive button is readable.
 *
 * The accent and the error red are the shared tokens, and white on them was
 * 3.68:1 and 3.76:1. They were darkened at the source (Jon, 2026-11-11;
 * astrid-core register DS26), and the hover moved one step on so it is still a
 * hover. A fill dark enough for a white label is a poor line on a dark card, so
 * a ring is the focus border, which is lighter in Dark.
 *
 * jsdom applies no stylesheet: these compile the classes through the real
 * Tailwind config and follow each to a colour in every theme.
 */
import { describe, expect, it } from 'vitest'

import { THEME_NAMES } from '@/lib/design/tokens'

import { compileClasses, ruleFor } from './compile-tailwind'
import { contrast, resolveRgb, themeScope, type Rgb } from './resolve-theme'

/** What body text needs (WCAG AA): a button's label is read. */
const LABEL = 4.5
/** What a line that carries meaning needs (WCAG 1.4.11): the focus ring. */
const LINE = 3

const colourOf = (css: string, name: string, scope: Map<string, string>): Rgb => {
  const variable = /rgba\(var\(--([a-z0-9-]+)\)/.exec(ruleFor(css, name))
  if (!variable) throw new Error(`${name} does not compile to a token colour`)
  return resolveRgb(variable[1], scope)
}

const FILLS: [fill: string, label: string][] = [
  ['bg-brand', 'text-brand-foreground'],
  ['bg-brand-hover', 'text-brand-foreground'],
  ['bg-danger', 'text-danger-foreground'],
  ['bg-destructive', 'text-destructive-foreground'],
]

describe('AWTD-1575: a label on a brand or destructive fill is 4.5:1 in every theme', () => {
  it.each(THEME_NAMES.flatMap((theme) => FILLS.map(([fill, label]) => [theme, label, fill] as const)))(
    '%s: %s on %s',
    async (theme, label, fill) => {
      const css = await compileClasses([fill, label])
      const scope = themeScope(theme)
      const ratio = contrast(colourOf(css, label, scope), colourOf(css, fill, scope))
      expect(ratio, `${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(LABEL)
    },
  )

  it('the fills are the values the decision names', async () => {
    const css = await compileClasses(['bg-brand', 'bg-brand-hover', 'bg-danger'])
    for (const theme of THEME_NAMES) {
      const scope = themeScope(theme)
      expect(colourOf(css, 'bg-brand', scope), theme).toEqual([37, 99, 235])
      expect(colourOf(css, 'bg-brand-hover', scope), theme).toEqual([29, 78, 216])
      expect(colourOf(css, 'bg-danger', scope), theme).toEqual([220, 38, 38])
    }
  })

  it.each(THEME_NAMES)('%s: the hover is a darker fill than the one at rest, by as much as a step', async (theme) => {
    const css = await compileClasses(['bg-brand', 'bg-brand-hover', 'text-brand-foreground'])
    const scope = themeScope(theme)
    const [rest, hover, label] = ['bg-brand', 'bg-brand-hover', 'text-brand-foreground'].map((name) => colourOf(css, name, scope))
    expect(contrast(label, hover)).toBeGreaterThan(contrast(label, rest))
    // blue-600 to blue-700 is 1.30:1 between the two; the hover it replaces
    // (blue-500 to blue-600) was 1.41:1. Under 1.2 the button does not answer.
    expect(contrast(rest, hover)).toBeGreaterThanOrEqual(1.2)
  })
})

describe('AWTD-1575: the accent as a ring shows on the page and the card in every theme', () => {
  it.each(THEME_NAMES)('%s: ring-brand and the shadcn ring are 3:1 on both', async (theme) => {
    const css = await compileClasses(['ring-brand', 'ring-ring', 'bg-theme-primary', 'bg-theme-surface'])
    const scope = themeScope(theme)
    const variable = (name: string) => {
      const found = /--tw-ring-color:\s*rgba\(var\(--([a-z0-9-]+)\)/.exec(ruleFor(css, name))
      if (!found) throw new Error(`${name} sets no ring colour from a token`)
      return resolveRgb(found[1], scope)
    }
    for (const ring of ['ring-brand', 'ring-ring']) {
      for (const surface of ['bg-theme-primary', 'bg-theme-surface']) {
        const ratio = contrast(variable(ring), colourOf(css, surface, scope))
        expect(ratio, `${ring} on ${surface}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(LINE)
      }
    }
  })

  it('the selection outline reads the same line colour', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const css = readFileSync(join(process.cwd(), 'styles', 'components.css'), 'utf8')
    expect(css).toContain('--selection-outline-color: rgba(var(--theme-border-focus), var(--astrid-state-selection-outline-opacity));')
  })
})

// The browser pass after the fills were darkened: in Dark, low priority (the
// outline, the "U" and "!", the repeat arrows, the picker) followed the accent
// to 2.84:1 on a card and 2.0:1 on a selected row, and the repeat frame was
// visibly dim. In Dark it reads the accent's lighter shade, as the ring does.
describe('AWTD-1575: low priority shows on the card in every theme', () => {
  const priority = (name: string, scope: Map<string, string>) => resolveRgb(`astrid-priority-${name}`, scope)

  it('Dark: priority-low is the accent\'s lighter shade, 3:1 on the card and on a selected row', async () => {
    const css = await compileClasses(['bg-theme-surface', 'bg-theme-selected'])
    const scope = themeScope('dark')
    const low = priority('low', scope)
    expect(low).toEqual([96, 165, 250])
    expect(low).toEqual(resolveRgb('astrid-accent-ink', scope))
    for (const surface of ['bg-theme-surface', 'bg-theme-selected']) {
      const ratio = contrast(low, colourOf(css, surface, scope))
      expect(ratio, `${surface}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(LINE)
    }
  })

  it.each(THEME_NAMES.filter((theme) => theme !== 'dark'))('%s: priority-low is the accent, 3:1 on the card', async (theme) => {
    const css = await compileClasses(['bg-theme-surface'])
    const scope = themeScope(theme)
    expect(priority('low', scope)).toEqual(resolveRgb('astrid-accent', scope))
    expect(contrast(priority('low', scope), colourOf(css, 'bg-theme-surface', scope))).toBeGreaterThanOrEqual(LINE)
  })

  it('none, medium and high are the same colour in every theme', () => {
    for (const theme of THEME_NAMES) {
      const scope = themeScope(theme)
      expect(priority('none', scope), theme).toEqual([107, 114, 128])
      expect(priority('medium', scope), theme).toEqual([251, 191, 36])
      expect(priority('high', scope), theme).toEqual([239, 68, 68])
    }
  })
})
