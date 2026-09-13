import { test, expect, type Page } from '@playwright/test'
import { gotoWithRetry } from './utils/test-helpers'

/**
 * DOM-measured proof for AWTD-935 — "`hover:theme-text-*` does nothing in the
 * light and lite themes — the CSS escape is a doubled backslash".
 *
 * The unit test (tests/styles/hover-theme-text-escape.test.ts) asserts the
 * source text. This asserts the thing the user actually experiences: that a
 * real browser, with the real stylesheet, changes the colour of a real element
 * on hover.
 *
 * The probe element is injected rather than picked out of the app so the test
 * runs unauthenticated and does not break when someone restyles a page. What
 * is under test is the stylesheet, not any particular screen — and the class
 * pairing used here (`theme-text-muted hover:theme-text-primary`) is the exact
 * one 31 call sites in app/ and components/ use.
 */

/**
 * The two themes scoped by this stylesheet declare different palettes, so the
 * expected colours are per-theme. Values mirror the custom properties in
 * styles/themes/light-theme.css (`.light` at the top, `.lite` further down).
 */
const PALETTE = {
  light: {
    muted: 'rgb(107, 114, 128)',
    primary: 'rgb(17, 24, 39)',
    secondary: 'rgb(75, 85, 99)',
  },
  lite: {
    muted: 'rgb(120, 120, 120)',
    primary: 'rgb(0, 0, 0)',
    secondary: 'rgb(60, 60, 60)',
  },
} as const

const PROBE_ID = 'awtd-935-probe'

/**
 * Put the page in a known theme and drop a probe element into it.
 *
 * The theme is forced on <html> directly rather than through the theme picker:
 * the picker needs an authenticated session, and what matters here is only that
 * the theme's scoping class is present, which is all the picker ultimately does
 * (contexts/theme-context.tsx).
 */
async function mountProbe(page: Page, theme: 'light' | 'lite', className: string) {
  await page.evaluate(
    ({ theme, className, id }) => {
      const root = document.documentElement
      root.classList.remove('light', 'lite', 'dark', 'ocean')
      root.classList.add(theme)

      document.getElementById(id)?.remove()
      const probe = document.createElement('button')
      probe.id = id
      probe.className = className
      probe.textContent = 'hover me'
      // Park it somewhere nothing else can sit on top of, so the synthetic
      // mouse move lands on the probe and not on an overlay.
      probe.style.position = 'fixed'
      probe.style.top = '0'
      probe.style.left = '0'
      probe.style.zIndex = '2147483647'
      probe.style.padding = '20px'
      document.body.appendChild(probe)
    },
    { theme, className, id: PROBE_ID },
  )
  return page.locator(`#${PROBE_ID}`)
}

test.describe('hover:theme-text-* changes colour on hover (AWTD-935)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoWithRetry(page, '/en/auth/signin', { waitUntil: 'domcontentloaded' })

    // Two races to settle before the probe means anything, both of which made
    // this spec report a bogus rgb(0, 0, 0) while it was being written:
    //
    // 1. The theme stylesheets are imported by app/[locale]/layout.tsx, so in
    //    dev they arrive with the JS chunks — after domcontentloaded.
    // 2. contexts/theme-context.tsx rewrites documentElement's class on mount,
    //    which would wipe whatever theme the probe just forced.
    //
    // Waiting for the provider's own class proves hydration has run, and
    // waiting for a known rule proves the stylesheet is live.
    await page.waitForFunction(() =>
      ['light', 'dark', 'ocean'].some((t) => document.documentElement.classList.contains(t)),
    )
    await page.waitForFunction(() =>
      Array.from(document.styleSheets).some((sheet) => {
        let rules: CSSRuleList
        try {
          rules = sheet.cssRules
        } catch {
          return false // cross-origin sheet, not ours
        }
        return Array.from(rules).some(
          (rule) => (rule as CSSStyleRule).selectorText === '.light .theme-text-muted',
        )
      }),
    )
  })

  for (const theme of ['light', 'lite'] as const) {
    test(`${theme}: hover:theme-text-primary darkens muted text on hover`, async ({ page }) => {
      const probe = await mountProbe(
        page,
        theme,
        'theme-text-muted hover:theme-text-primary',
      )

      await expect(probe).toHaveCSS('color', PALETTE[theme].muted)
      await probe.hover()
      // Before the fix the rule was dropped by the parser, so this stayed muted.
      await expect(probe).toHaveCSS('color', PALETTE[theme].primary)
    })

    test(`${theme}: hover:theme-text-secondary wins over the base theme-text-muted colour`, async ({ page }) => {
      const probe = await mountProbe(
        page,
        theme,
        'theme-text-muted hover:theme-text-secondary',
      )

      await expect(probe).toHaveCSS('color', PALETTE[theme].muted)
      await probe.hover()
      await expect(probe).toHaveCSS('color', PALETTE[theme].secondary)
    })

    test(`${theme}: hover:theme-text-primary beats the same-specificity .theme-text-secondary:hover rule`, async ({ page }) => {
      // The stylesheet also carries `.light .theme-text-secondary:hover`, which
      // has the same specificity as the fixed rule. It only loses because it is
      // written earlier in the file. Reordering the file would silently break
      // this pairing, so pin it.
      const probe = await mountProbe(
        page,
        theme,
        'theme-text-secondary hover:theme-text-primary',
      )

      await expect(probe).toHaveCSS('color', PALETTE[theme].secondary)
      await probe.hover()
      await expect(probe).toHaveCSS('color', PALETTE[theme].primary)
    })
  }
})
