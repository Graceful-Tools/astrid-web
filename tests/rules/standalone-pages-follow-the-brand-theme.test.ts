/**
 * RATCHET — AWTD-1047 (standalone pages ignored the brand theme).
 *
 * Pages rendered outside the task-manager shell used to paint their own dark
 * palette — `bg-black`, `bg-gray-900` cards, `text-white`, a `bg-blue-600`
 * button. That reads as "on brand" on Astrid, where the palette happened to be
 * close, and as broken on any other brand: the white-label test site
 * (light theme, GitHub-blue accent) showed a black /help page with Astrid's
 * blue buttons, because none of it went through the theme variables or
 * `NEXT_PUBLIC_BRAND_ACCENT_COLOR`.
 *
 * WHAT THIS ENFORCES: the pages listed below take their neutrals and their
 * accent from the theme system — `theme-bg-*`, `theme-surface`,
 * `theme-border*`, `theme-text-*`, and `--theme-accent` / `-hover` / `-text`.
 * Status colours (green / yellow / red badges, the red error alert) are not
 * banned: they carry meaning, not brand.
 *
 * Add a page here when you convert it. A page leaving this list is a page
 * going back to ignoring the brand.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

const THEMED_STANDALONE_PAGES = [
  'app/[locale]/help/page.tsx',
  'app/[locale]/terms/page.tsx',
  'app/[locale]/privacy/page.tsx',
  'app/[locale]/download/page.tsx',
  'app/[locale]/not-found.tsx',
  'app/[locale]/settings/fullpage/[page]/page.tsx',
]

/**
 * Palette classes that bypass the theme. Neutrals (black / white / gray) and
 * the hardcoded accent (blue), plus shadcn's `background` / `foreground`, which
 * are not wired to the Astrid theme or the brand accent either.
 */
const HARDCODED_PALETTE =
  /(?<![\w-])(?:(?:hover|focus|dark|group-hover):)*(?:bg|text|border|from|to|via|ring)-(?:black|white|gray-\d+|blue-\d+|purple-\d+|background|foreground)(?:\/\d+)?(?![\w-])/g

describe('standalone pages follow the brand theme (AWTD-1047)', () => {
  for (const page of THEMED_STANDALONE_PAGES) {
    it(`${page} uses theme tokens, not a hardcoded palette`, () => {
      const source = readFileSync(join(ROOT, page), 'utf8')
      const hits = [...new Set(source.match(HARDCODED_PALETTE) ?? [])]
      expect(hits, [
        `${page} paints its own palette outside the theme system, so it ignores`,
        'the brand theme and NEXT_PUBLIC_BRAND_ACCENT_COLOR. Use theme-bg-primary,',
        'theme-surface / theme-border, theme-text-*, and the accent via',
        'bg-[rgb(var(--theme-accent))] / text-[rgb(var(--theme-accent-text))].',
      ].join('\n')).toEqual([])
    })
  }

  it('every page still owns its scroll surface', () => {
    // The palette swap touches the root element of each page; the scroll shell
    // on that same element is what keeps content below the fold reachable
    // (tests/rules/standalone-pages-own-their-scrolling.test.ts).
    for (const page of THEMED_STANDALONE_PAGES) {
      const source = readFileSync(join(ROOT, page), 'utf8')
      expect(/ScrollShell|scrollShellClassName/.test(source), page).toBe(true)
    }
  })
})
