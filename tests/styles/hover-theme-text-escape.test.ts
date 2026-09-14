/**
 * Regression for AWTD-935 — "`hover:theme-text-*` does nothing in the light and
 * lite themes — the CSS escape is a doubled backslash". (The `lite` theme has
 * since been deleted as dead — AWTD-936 — but the escape bug it names was real
 * in every theme the rules were written for.)
 *
 * A `:` inside a class name is escaped with ONE backslash. Four rules were
 * written `.light .hover\\:theme-text-primary:hover`, and in CSS `\\` is an
 * escaped literal backslash — so that parses as class `hover\` plus the
 * non-existent pseudo-class `:theme-text-primary`, and the whole rule is
 * dropped (Turbopack: "'theme-text-primary' is not recognized as a valid
 * pseudo-class"). Every call site failed silently.
 *
 * This test owns the ESCAPE. It is deliberately file-agnostic: AWTD-936 moved
 * the rules themselves out of light-theme.css and into
 * styles/themes/hover-variants.css, and the bug being guarded against is a
 * typo that could reappear in any stylesheet, not something about that one
 * file. Whether every used `hover:theme-*` class has a rule in every theme is
 * a different question, owned by tests/styles/hover-theme-variants.test.ts.
 *
 * CSS can't be exercised behaviorally in jsdom, so this asserts source text.
 * The DOM-measured proof lives in e2e/hover-theme-text.spec.ts.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const STYLES_DIR = join(ROOT, 'styles')

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return cssFiles(full)
    return entry.name.endsWith('.css') ? [full] : []
  })
}

/** Comments are prose and may legitimately spell the broken escape out in order
 *  to explain it — as hover-variants.css does. Only real selectors count. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('hover:theme-* class-name escaping (AWTD-935)', () => {
  const sheets = cssFiles(STYLES_DIR).map((file) => ({
    file: relative(ROOT, file),
    css: stripComments(readFileSync(file, 'utf8')),
  }))

  it('no stylesheet escapes a class-name colon with a doubled backslash', () => {
    // A doubled backslash is always this bug: it makes the rule unmatchable and
    // Turbopack drops it with a pseudo-class warning on every dev boot.
    const offenders = sheets.flatMap(({ file, css }) =>
      css
        .split('\n')
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => line.includes('\\\\:'))
        .map(({ line, n }) => `${file}:${n}: ${line.trim()}`),
    )
    expect(offenders).toEqual([])
  })

  for (const tone of ['primary', 'secondary'] as const) {
    it(`hover\\:theme-text-${tone} is escaped with a single backslash somewhere in styles/`, () => {
      const selector = `.hover\\:theme-text-${tone}:hover`
      const declaring = sheets.filter(({ css }) => css.includes(selector))
      expect(
        declaring.map(({ file }) => file),
        `no stylesheet declares ${selector}`,
      ).not.toEqual([])
    })
  }
})
