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
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  priorityColor,
  priorityFillClass,
  priorityOutlineClass,
  priorityTextClass,
} from '@/lib/design/priority'
import { THEME_VOCABULARY } from '@/lib/design/tailwind-theme'
import { THEME_NAMES, designTokens, themeColor, themeColorNames } from '@/lib/design/tokens'
import { getPriorityColor } from '@/lib/task-leading-control'
import { getPriorityColorClass } from '@/lib/task-manager-utils'

import { compileClasses, ruleFor } from './compile-tailwind'
import { contrast, resolveRgb, themeScope, type Rgb } from './resolve-theme'

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
    for (const name of ['none', 'medium', 'high']) {
      expect(css).toContain(`.priority-fill-${name}:hover { background-color: rgb(var(--astrid-priority-${name})); }`)
    }
    expect(css).toContain('.priority-fill-low:hover { background-color: rgb(var(--astrid-accent)); }')
  })

  // AWTD-1575: Dark's low-priority colour is the accent's lighter ink, so it
  // reads as a line or a glyph on a dark card. As a FILL under a white "!" that
  // blue is 2.54:1; the fill is the accent itself, which is 5.17:1 in every theme.
  it('the low-priority fill is the accent fill, so its white glyph is readable in Dark', () => {
    expect(css).toContain('.priority-fill-low { background-color: rgb(var(--astrid-accent)); border-color: rgb(var(--astrid-accent)); }')
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

describe('one global stylesheet (AWTD-1574)', () => {
  // styles/globals.css was shadcn's scaffold, imported by nothing: a second copy
  // of the shadcn variables that drifted from app/globals.css (a different
  // --radius, --border and --muted-foreground) and read as the one to edit.
  it('app/globals.css is the only one', () => {
    expect(existsSync(join(process.cwd(), 'styles', 'globals.css'))).toBe(false)
    expect(read('components.json')).toContain('"css": "app/globals.css"')
  })
})

describe('web-only surfaces read the tokens (AWTD-1574, register DS9)', () => {
  // The sidebar, the panel, the pill, the count badge and the card glass have no
  // token of their own yet. Each is named once per theme and reads one; none is
  // a colour written out.
  for (const theme of THEME_NAMES) {
    const css = read('styles', 'themes', `${theme}-theme.css`).replace(/\/\*[\s\S]*?\*\//g, '')
    const declared = new Map<string, string>()
    for (const match of css.matchAll(/--theme-([a-z0-9-]+):\s*([^;]+);/g)) declared.set(match[1], match[2].trim())

    it(`${theme}: every --theme-* variable is a token or another theme variable`, () => {
      const literal = [...declared].filter(([, value]) => !/^var\(--(astrid|theme)-[a-z0-9-]+\)$/.test(value))
      expect(literal).toEqual([])
    })

    it(`${theme}: each one ends at a design token`, () => {
      for (const name of declared.keys()) {
        let value = declared.get(name)!
        for (let hop = 0; hop < 5 && value.startsWith('var(--theme-'); hop += 1) {
          value = declared.get(/^var\(--theme-([a-z0-9-]+)\)$/.exec(value)![1]) ?? `undeclared ${value}`
        }
        const token = /^var\(--astrid-([a-z0-9-]+)\)$/.exec(value)?.[1]
        expect(token, `--theme-${name}`).toBeDefined()
        expect(tokensCss, `--theme-${name} reads --astrid-${token}`).toContain(`--astrid-${token}:`)
      }
    })

    it(`${theme}: no rule writes a colour out`, () => {
      expect(css.match(/rgba?\(\s*\d[^)]*\)|#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([])
    })
  }

  it('the surfaces every theme has are the same names', () => {
    const names = (theme: string) =>
      [...read('styles', 'themes', `${theme}-theme.css`).matchAll(/--theme-((?:surface|sidebar|panel|comment|shadow)[a-z0-9-]*):/g)]
        .map((match) => match[1])
        .sort()
    for (const theme of THEME_NAMES) expect(names(theme), theme).toEqual(names(THEME_NAMES[0]))
  })
})

describe('shadcn\'s variables are answered by the theme (AWTD-1574)', () => {
  // --background, --primary and the rest were a second colour system: stock
  // shadcn greys for :root and .dark, and nothing for Ocean, which wore the
  // light values. They now read the tokens, so a shadcn component and a
  // theme-* class beside it are the same colour in every theme.
  const globals = read('app', 'globals.css').replace(/\/\*[\s\S]*?\*\//g, '')
  const SHADCN =
    /--(background|foreground|card|popover|primary|secondary|muted|accent|destructive|border|input|ring|chart|sidebar)[a-z0-9-]*:\s*([^;]+);/g

  it('each one is a token or a theme variable, declared once for every theme', () => {
    const declared = [...globals.matchAll(SHADCN)]
    expect(declared.length).toBeGreaterThan(25)
    expect(declared.filter((match) => !/^var\(--(astrid|theme)-[a-z0-9-]+\)$/.test(match[2].trim())).map((match) => match[0])).toEqual([])
    expect(new Set(declared.map((match) => match[0].split(':')[0])).size, 'no .dark copy').toBe(declared.length)
  })

  it('Tailwind reads them as r, g, b like every other token, never as hsl', () => {
    const config = read('tailwind.config.ts') + read('lib', 'design', 'tailwind-theme.ts')
    expect(config).not.toContain('hsl(')
  })

  it('compiles, and keeps opacity modifiers', async () => {
    const css = await compileClasses(['bg-background', 'bg-background/95', 'hover:bg-primary/90', 'text-muted-foreground', 'border-input', 'ring-ring'])
    expect(ruleFor(css, 'bg-background')).toContain('background-color: rgba(var(--background), var(--tw-bg-opacity, 1))')
    expect(ruleFor(css, 'bg-background/95')).toBe('background-color: rgba(var(--background), 0.95)')
    expect(ruleFor(css, 'hover:bg-primary/90')).toBe('background-color: rgba(var(--primary), 0.9)')
    expect(ruleFor(css, 'text-muted-foreground')).toContain('color: rgba(var(--muted-foreground)')
    expect(ruleFor(css, 'border-input')).toContain('border-color: rgba(var(--input)')
    expect(ruleFor(css, 'ring-ring')).toContain('--tw-ring-color: rgba(var(--ring)')
  })

  const SHADCN_NAMES = [...new Set([...globals.matchAll(SHADCN)].map((match) => match[0].split(':')[0].slice(2)))]

  it.each(THEME_NAMES)('%s: every one resolves to a colour', (theme) => {
    const scope = themeScope(theme)
    for (const name of SHADCN_NAMES) expect(() => resolveRgb(name, scope), `--${name}`).not.toThrow()
  })

  // What button, dialog, popover, select, input and card write text on.
  it.each(THEME_NAMES)('%s: shadcn text is readable on the surface under it', (theme) => {
    const scope = themeScope(theme)
    for (const [text, surface] of [
      ['foreground', 'background'],
      ['card-foreground', 'card'],
      ['popover-foreground', 'popover'],
      ['primary-foreground', 'primary'],
      ['secondary-foreground', 'secondary'],
      ['accent-foreground', 'accent'],
      ['muted-foreground', 'background'],
      ['muted-foreground', 'popover'],
    ]) {
      const ratio = contrast(resolveRgb(text, scope), resolveRgb(surface, scope))
      expect(ratio, `${theme}: --${text} on --${surface} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('a surface is the card, never Ocean\'s cyan page', () => {
    expect(resolveRgb('background', themeScope('ocean'))).toEqual([255, 255, 255])
    expect(resolveRgb('popover', themeScope('ocean'))).toEqual([255, 255, 255])
    expect(resolveRgb('border', themeScope('ocean'))).not.toEqual(resolveRgb('astrid-bg-primary', themeScope('ocean')))
  })

  it('the first paint has a theme to answer them: the brand\'s default is on <html>', () => {
    // The variables only resolve under a theme class, and the provider adds one
    // after hydration. Without it the server's HTML painted with no border or
    // text colour at all.
    expect(read('app', '[locale]', 'layout.tsx')).toMatch(/<html\b[\s\S]{0,600}?className=\{BRAND\.defaultTheme\}/)
  })
})

describe('the theme vocabulary: what a palette class is replaced with (AWTD-1574)', () => {
  // 1,585 Tailwind palette classes (text-gray-400, bg-blue-600 …) each restate
  // a colour the tokens already hold. These are the names they become. They are
  // Tailwind theme colours, so nothing here is a hand-written rule that a
  // variant could be missing for.
  const spec = read('docs', 'specs', 'DESIGN_SYSTEM.md')
  let css = ''
  const VARIANTS = ['hover', 'focus', 'focus-visible', 'active', 'disabled', 'group-hover', 'md']

  /** The custom property a compiled colour rule reads. */
  const propertyOf = (rule: string) => /rgba\(var\(--((?:astrid|theme)-[a-z0-9-]+)\)/.exec(rule)?.[1]

  it('compiles every class, in every variant the app uses', async () => {
    css = await compileClasses([
      ...THEME_VOCABULARY,
      ...THEME_VOCABULARY.flatMap((name) => VARIANTS.map((variant) => `${variant}:${name}`)),
    ])
    for (const name of THEME_VOCABULARY) {
      expect(propertyOf(ruleFor(css, name)), name).toBeDefined()
      for (const variant of VARIANTS) {
        expect(css, `${variant}:${name}`).toContain(`${variant}\\:${name}`)
      }
    }
  })

  it.each(THEME_NAMES)('%s: every class resolves to a colour', (theme) => {
    const scope = themeScope(theme)
    for (const name of THEME_VOCABULARY) {
      const property = propertyOf(ruleFor(css, name))!
      expect(() => resolveRgb(property, scope), `${name} reads --${property}`).not.toThrow()
    }
    // The wash behind a notice is a number, named once.
    expect(Number(scope.get('theme-wash-opacity'))).toBeGreaterThan(0)
  })

  it.each(THEME_NAMES)('%s: theme text is readable on the theme\'s page, card and secondary surface', (theme) => {
    const scope = themeScope(theme)
    const colour = (name: string) => resolveRgb(propertyOf(ruleFor(css, name))!, scope)
    for (const text of ['text-theme-primary', 'text-theme-secondary', 'text-theme-muted']) {
      for (const surface of ['bg-theme-primary', 'bg-theme-surface', 'bg-theme-secondary']) {
        const ratio = contrast(colour(text), colour(surface))
        expect(ratio, `${theme}: ${text} on ${surface} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('says the same thing as the hand-written class it turns round', () => {
    const light = read('styles', 'themes', 'light-theme.css')
    for (const [tailwind, handWritten, property] of [
      ['text-theme-primary', 'theme-text-primary', 'color'],
      ['text-theme-secondary', 'theme-text-secondary', 'color'],
      ['text-theme-muted', 'theme-text-muted', 'color'],
      ['bg-theme-primary', 'theme-bg-primary', 'background-color'],
      ['bg-theme-secondary', 'theme-bg-secondary', 'background-color'],
      ['bg-theme-tertiary', 'theme-bg-tertiary', 'background-color'],
      ['bg-theme-surface', 'theme-surface', 'background-color'],
      ['border-theme', 'theme-border', 'border-color'],
      ['border-theme-input', 'theme-border-input', 'border-color'],
    ]) {
      const variable = new RegExp(`\\.light \\.${handWritten} \\{ ${property}: rgb\\(var\\(--(theme-[a-z-]+)\\)\\); \\}`).exec(light)?.[1]
      expect(variable, handWritten).toBeDefined()
      const scope = themeScope('light')
      expect(resolveRgb(propertyOf(ruleFor(css, tailwind))!, scope), tailwind).toEqual(resolveRgb(variable!, scope))
    }
  })

  it('hover is the surface\'s hover tint, as hover:theme-bg-hover is', () => {
    expect(ruleFor(css, 'hover:bg-theme-hover')).toContain('rgba(var(--theme-surface-hover)')
    expect(read('styles', 'themes', 'hover-variants.css')).toMatch(
      /\.hover\\:theme-bg-hover:hover \{\s*background-color: rgb\(var\(--theme-surface-hover\)\);/,
    )
  })

  it('states reach the tokens too: disabled, completed, press', async () => {
    const states = await compileClasses(['disabled:opacity-disabled', 'opacity-completed', 'active:scale-press'])
    expect(ruleFor(states, 'disabled:opacity-disabled')).toBe('opacity: var(--astrid-state-disabled-opacity)')
    expect(ruleFor(states, 'opacity-completed')).toBe('opacity: var(--astrid-state-completed-mark-opacity)')
    expect(ruleFor(states, 'active:scale-press')).toContain('--tw-scale-x: var(--astrid-state-press-scale)')
  })

  it('the spec\'s table names every class', () => {
    const section = spec.slice(spec.indexOf('## Palette classes to theme classes'))
    expect(section.length).toBeGreaterThan(1000)
    const listed = (name: string) => section.includes(`\`${name}\``) || new RegExp(`\`[^\`]*\\b${name}\\b[^\`]*\``).test(section)
    expect(THEME_VOCABULARY.filter((name) => !/^bg-list-[2-7]$/.test(name) && !listed(name))).toEqual([])
  })

  it('no palette colour is named in the Tailwind theme', () => {
    const source = read('lib', 'design', 'tailwind-theme.ts') + read('tailwind.config.ts')
    expect(source.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d|hsl\(/g) ?? []).toEqual([])
  })
})

describe('a meaning as text reads its ink, as a fill its base colour (AWTD-1575)', () => {
  // The conversion turned `text-blue-600 dark:text-blue-400` into `text-brand`,
  // and the tokens had one mid-tone per meaning: right as a fill, 3.68:1 as a
  // link on white, about 2:1 as a label on its own wash. astrid-core now has an
  // ink per meaning (register DS25) and the text utilities read it.
  const MEANINGS = [
    ['brand', 'accent'],
    ['danger', 'error'],
    ['success', 'success'],
    ['warning', 'warning'],
    ['info', 'info'],
  ] as const
  const propertyOf = (rule: string) => /rgba\(var\(--((?:astrid|theme)-[a-z0-9-]+)\)/.exec(rule)?.[1]
  let css = ''

  it('AWTD-1575: text, and an icon drawn with fill or stroke, compile to the ink', async () => {
    css = await compileClasses([
      'bg-theme-surface',
      'bg-theme-primary',
      'bg-theme-secondary',
      'hover:text-brand-hover',
      ...MEANINGS.flatMap(([name]) => [
        `text-${name}`,
        `hover:text-${name}`,
        `text-${name}/70`,
        `fill-${name}`,
        `stroke-${name}`,
        `text-${name}-foreground`,
        `bg-${name}`,
        `bg-${name}-subtle`,
        `border-${name}`,
        `ring-${name}`,
      ]),
    ])
    for (const [name, token] of MEANINGS) {
      expect(propertyOf(ruleFor(css, `text-${name}`)), `text-${name}`).toBe(`astrid-${token}-ink`)
      expect(propertyOf(ruleFor(css, `hover:text-${name}`)), `hover:text-${name}`).toBe(`astrid-${token}-ink`)
      expect(ruleFor(css, `text-${name}/70`)).toBe(`color: rgba(var(--astrid-${token}-ink), 0.7)`)
      expect(ruleFor(css, `fill-${name}`)).toContain(`rgba(var(--astrid-${token}-ink)`)
      expect(ruleFor(css, `stroke-${name}`)).toContain(`rgba(var(--astrid-${token}-ink)`)
    }
    // shadcn's alert writes the same red as `text-destructive`; its fill is still `--destructive`.
    const shadcn = await compileClasses(['text-destructive', 'bg-destructive', 'text-destructive-foreground'])
    expect(propertyOf(ruleFor(shadcn, 'text-destructive'))).toBe('astrid-error-ink')
    expect(ruleFor(shadcn, 'bg-destructive')).toContain('rgba(var(--destructive)')
    expect(ruleFor(shadcn, 'text-destructive-foreground')).toContain('rgba(var(--destructive-foreground)')
  })

  // The accent's ring is the focus border, which is the accent in Light and
  // Ocean and its lighter shade in Dark (astrid-core register DS26).
  it('AWTD-1575: fills, washes, borders, rings and text on the fill keep the base colour', () => {
    for (const [name, token] of MEANINGS) {
      expect(propertyOf(ruleFor(css, `bg-${name}`)), `bg-${name}`).toBe(`astrid-${token}`)
      expect(ruleFor(css, `bg-${name}-subtle`)).toBe(`background-color: rgba(var(--astrid-${token}), var(--theme-wash-opacity))`)
      expect(propertyOf(ruleFor(css, `border-${name}`)), `border-${name}`).toBe(`astrid-${token}`)
      expect(ruleFor(css, `ring-${name}`)).toContain(`rgba(var(--astrid-${name === 'brand' ? 'border-focus' : token}), `)
      expect(propertyOf(ruleFor(css, `text-${name}-foreground`)), `text-${name}-foreground`).toBe('astrid-accent-text')
    }
  })

  it.each(THEME_NAMES)('AWTD-1575 %s: each text-<meaning> is 4.5:1 on the card and on its own wash', (theme) => {
    const scope = themeScope(theme)
    const colour = (name: string) => resolveRgb(propertyOf(ruleFor(css, name))!, scope)
    const wash = Number(scope.get('theme-wash-opacity'))
    const card = colour('bg-theme-surface')
    for (const [name, token] of MEANINGS) {
      const ink = colour(`text-${name}`)
      expect(ink, `${theme} text-${name}`).toEqual(themeColor(theme, `${token}-ink`))
      const surfaces: [string, Rgb][] = [
        ['bg-theme-surface', card],
        ['bg-theme-secondary', colour('bg-theme-secondary')],
        [
          `bg-${name}-subtle on the card`,
          colour(`bg-${name}`).map((channel, at) => Math.round(channel * wash + card[at] * (1 - wash))) as Rgb,
        ],
      ]
      // Ocean's page is cyan; a status colour is drawn on a card there.
      if (theme !== 'ocean') surfaces.push(['bg-theme-primary', colour('bg-theme-primary')])
      for (const [surface, under] of surfaces) {
        const ratio = contrast(ink, under)
        expect(ratio, `${theme}: text-${name} on ${surface} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it.each(THEME_NAMES)('AWTD-1575 %s: a link under the pointer is never fainter than the link', (theme) => {
    const scope = themeScope(theme)
    const colour = (name: string) => resolveRgb(propertyOf(ruleFor(css, name))!, scope)
    const card = colour('bg-theme-surface')
    expect(contrast(colour('hover:text-brand-hover'), card)).toBeGreaterThanOrEqual(contrast(colour('text-brand'), card))
  })
})
