/**
 * AWTD-936 — `hover:theme-*` classes must actually resolve to a rule, in every
 * theme.
 *
 * `theme-*` classes are hand-written per-theme CSS, not Tailwind utilities, so
 * Tailwind generates no `hover:` variant for any of them. A `hover:theme-x`
 * class in JSX does something ONLY if somebody wrote `.<scope> .hover\:theme-x:hover`
 * into a stylesheet. Nothing enforced that, so 95 call sites accumulated against
 * four rules that existed in one theme file — and those four were themselves
 * mis-escaped until AWTD-935.
 *
 * This test is the enforcement. It reads the classes actually used in the app
 * and requires a matching rule in every theme scope. Add a `hover:theme-*`
 * class to a component without adding the rule and this fails, so the pattern
 * cannot silently rot again.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const STYLES_DIR = join(ROOT, 'styles')
const SOURCE_DIRS = ['app', 'components', 'lib'].map((d) => join(ROOT, d))

/** Every theme scope the app can be in — see contexts/theme-context.tsx plus
 *  the `.lite` palette that light-theme.css still carries. */
const THEME_SCOPES = ['light', 'lite', 'dark', 'ocean'] as const

function filesUnder(dir: string, exts: string[]): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return filesUnder(full, exts)
    return exts.some((e) => entry.name.endsWith(e)) ? [full] : []
  })
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/**
 * Split a selector list on top-level commas only.
 *
 * A plain `.split(',')` shreds `:is(.light, .lite, .dark, .ocean)` into four
 * fragments and the rule reads as covering only the last theme — which is
 * exactly how this test first reported a correct stylesheet as broken.
 */
function splitSelectorList(selectorText: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of selectorText) {
    if (char === '(') depth++
    else if (char === ')') depth--
    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  parts.push(current)
  return parts
}

/** `hover:theme-x` class names used in the app, mapped to where they are used. */
function usedHoverClasses(): Map<string, string[]> {
  const used = new Map<string, string[]>()
  for (const dir of SOURCE_DIRS) {
    for (const file of filesUnder(dir, ['.ts', '.tsx', '.js', '.jsx'])) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/hover:(theme-[a-z0-9-]+)/g)) {
        const name = match[1]
        const sites = used.get(name) ?? []
        sites.push(relative(ROOT, file))
        used.set(name, sites)
      }
    }
  }
  return used
}

/**
 * Index every `.hover\:<name>:hover` rule in styles/ by class name and by the
 * theme scopes it covers.
 *
 * Written to accept either spelling — an explicit `.light .hover\:x:hover` or
 * an `:is(.light, .lite, ...)` prefix — so the test constrains the behaviour,
 * not the authoring style.
 */
function indexHoverRules(): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>()
  for (const file of filesUnder(STYLES_DIR, ['.css'])) {
    const css = stripComments(readFileSync(file, 'utf8'))
    for (const block of css.split('}')) {
      const selectorText = block.split('{')[0]
      if (!selectorText.includes('\\:')) continue
      for (const selector of splitSelectorList(selectorText)) {
        const rule = selector.trim().match(/^(?<prefix>.*?)\.hover\\:(?<name>[a-z0-9-]+):hover$/)
        if (!rule?.groups) continue
        const { prefix, name } = rule.groups

        const scopes = new Set<string>()
        const isList = prefix.match(/:is\(([^)]*)\)/)
        for (const scope of (isList ? isList[1] : prefix).matchAll(/\.([a-z0-9-]+)/g)) {
          scopes.add(scope[1])
        }

        const covered = index.get(name) ?? new Set<string>()
        for (const s of scopes) covered.add(s)
        index.set(name, covered)
      }
    }
  }
  return index
}

/** Base `.<scope> .theme-x` classes defined per theme scope. */
function indexBaseClasses(): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>()
  for (const file of filesUnder(STYLES_DIR, ['.css'])) {
    const css = stripComments(readFileSync(file, 'utf8'))
    for (const match of css.matchAll(/\.([a-z0-9-]+)\s+\.(theme-[a-z0-9-]+)(?![a-z0-9-])/g)) {
      const [, scope, name] = match
      const scopes = index.get(name) ?? new Set<string>()
      scopes.add(scope)
      index.set(name, scopes)
    }
  }
  return index
}

describe('hover:theme-* variants resolve in every theme (AWTD-936)', () => {
  const used = usedHoverClasses()
  const hoverRules = indexHoverRules()
  const baseClasses = indexBaseClasses()

  it('the app actually uses hover:theme-* classes (guards against a vacuous pass)', () => {
    expect(used.size).toBeGreaterThan(0)
  })

  it.each([...used.keys()].sort())(
    'hover:%s has a rule in every theme scope',
    (name) => {
      const covered = hoverRules.get(name) ?? new Set<string>()
      const missing = THEME_SCOPES.filter((scope) => !covered.has(scope))
      expect(
        missing,
        `hover:${name} is used in ${used.get(name)!.length} place(s) (e.g. ${used.get(name)![0]}) ` +
          `but has no rule for: ${missing.join(', ')}. ` +
          `Tailwind does not generate hover: variants for theme-* classes — the rule must be hand-written.`,
      ).toEqual([])
    },
  )

  it('app/[locale]/layout.tsx imports the hover variants AFTER the theme stylesheets', () => {
    // The variants tie the `.theme-x` base rules on specificity (both 0,3,0),
    // so they win only on source order. Imported before the theme sheets they
    // would lose silently and every hover would go dead again — the exact
    // failure this whole task is about.
    //
    // The e2e spec loads the stylesheets straight from disk, which makes it
    // immune to the app being broken but also blind to this wiring. Hence here.
    const layout = readFileSync(join(ROOT, 'app', '[locale]', 'layout.tsx'), 'utf8')
    const at = (file: string) => layout.indexOf(`styles/themes/${file}`)

    const variants = at('hover-variants.css')
    expect(variants, 'layout must import styles/themes/hover-variants.css').toBeGreaterThan(-1)

    for (const theme of ['light-theme.css', 'dark-theme.css', 'ocean-theme.css']) {
      const themeAt = at(theme)
      expect(themeAt, `layout must import ${theme}`).toBeGreaterThan(-1)
      expect(variants, `hover-variants.css must be imported after ${theme}`).toBeGreaterThan(themeAt)
    }
  })

  it.each([...used.keys()].sort())(
    'hover:%s names a theme class that exists',
    (name) => {
      // Catches a hover variant pointing at a token nobody ever defined — the
      // failure mode of `hover:theme-text-link`, which referenced a class and a
      // custom property that appear in no stylesheet at all.
      expect(
        baseClasses.has(name),
        `hover:${name} refers to .${name}, which is not defined in any theme stylesheet.`,
      ).toBe(true)
    },
  )
})
