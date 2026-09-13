/**
 * Regression for AWTD-935 — "`hover:theme-text-*` does nothing in the light and
 * lite themes — the CSS escape is a doubled backslash".
 *
 * `theme-*` classes are hand-written per-theme CSS, not Tailwind utilities, so
 * Tailwind never generates a `hover:` variant for them. The four rules in
 * light-theme.css are the only thing that can make `hover:theme-text-primary`
 * and `hover:theme-text-secondary` work.
 *
 * They were written `.light .hover\\:theme-text-primary:hover`. In CSS `\\` is
 * an escaped literal backslash, so that parses as class `hover\` plus the
 * non-existent pseudo-class `:theme-text-primary`, and the whole rule is
 * dropped (Turbopack warns: "'theme-text-primary' is not recognized as a valid
 * pseudo-class"). The correct escape for a `:` inside a class name is a single
 * backslash.
 *
 * CSS can't be exercised behaviorally in jsdom, so this asserts the source
 * text. The DOM-measured proof lives in e2e/hover-theme-text.spec.ts.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const STYLES_DIR = join(process.cwd(), 'styles')
const lightTheme = readFileSync(join(STYLES_DIR, 'themes', 'light-theme.css'), 'utf8')

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return cssFiles(full)
    return entry.name.endsWith('.css') ? [full] : []
  })
}

describe('hover:theme-text-* escaping in the light/lite themes (AWTD-935)', () => {
  for (const theme of ['light', 'lite'] as const) {
    for (const tone of ['primary', 'secondary'] as const) {
      it(`.${theme} .hover\\:theme-text-${tone}:hover escapes the colon with ONE backslash`, () => {
        // Exactly the selector a browser needs in order to match
        // class="hover:theme-text-primary". One backslash, not two.
        const selector = `.${theme} .hover\\:theme-text-${tone}:hover`
        expect(lightTheme).toContain(`${selector} {`)
      })

      it(`.${theme} .hover\\:theme-text-${tone} still sets the ${tone} text colour`, () => {
        const escaped = `\\.${theme} \\.hover\\\\:theme-text-${tone}:hover`
        const rule = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`)
        const match = lightTheme.match(rule)
        expect(match, `rule for .${theme} .hover\\:theme-text-${tone}:hover must exist`).toBeTruthy()
        expect(match![1]).toContain(`color: rgb(var(--theme-text-${tone}))`)
      })
    }
  }

  it('no stylesheet escapes a class-name colon with a doubled backslash', () => {
    // A doubled backslash is always this bug: it makes the rule unmatchable and
    // Turbopack drops it with a pseudo-class warning on every dev boot.
    const offenders = cssFiles(STYLES_DIR)
      .map((file) => ({ file, lines: readFileSync(file, 'utf8').split('\n') }))
      .flatMap(({ file, lines }) =>
        lines
          .map((line, i) => ({ line, n: i + 1 }))
          .filter(({ line }) => line.includes('\\\\:'))
          .map(({ line, n }) => `${file}:${n}: ${line.trim()}`),
      )
    expect(offenders).toEqual([])
  })
})
