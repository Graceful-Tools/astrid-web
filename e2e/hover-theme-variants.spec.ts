import { test, expect, type Locator, type Page } from '@playwright/test'
import { join } from 'node:path'

/**
 * DOM-measured proof that `hover:theme-*` classes actually do something, in
 * every theme (AWTD-936), and that the class-name colon stays correctly escaped
 * (AWTD-935).
 *
 * This absorbs the earlier e2e/hover-theme-text.spec.ts, which covered the same
 * two text classes in the light theme only. Every assertion it made is still
 * here — including the cascade-order pin — alongside the other classes and
 * every theme, without running two near-identical suites.
 *
 * WHY THIS RUNS AGAINST about:blank
 *
 * The stylesheets are loaded straight from disk rather than by driving the app.
 * They are hand-written plain CSS — no Tailwind pass, no build step — so what a
 * browser gets here is byte-for-byte what it gets in production. Loading them
 * in the app's own import order preserves the cascade this depends on.
 *
 * The earlier version navigated to /en/auth/signin, and every failure it ever
 * produced came from the app rather than the CSS: the theme provider rewriting
 * documentElement's class mid-test, transient overlays swallowing the pointer
 * and hanging .hover(), and the dev server intermittently not having the
 * stylesheet live within the timeout. Different test failed each run. None of
 * it was about the rules under test.
 *
 * The one thing this cannot see is whether app/[locale]/layout.tsx actually
 * imports hover-variants.css, and in the right order. That is asserted in
 * tests/styles/hover-theme-variants.test.ts instead.
 *
 * Expected values are never hardcoded. Each is resolved from the live theme by
 * rendering a reference element, so the test states the real contract —
 * "hovering makes it the theme's primary text colour" — rather than a snapshot
 * of hex values needing an edit every time a palette is retuned.
 */

// Mirrors the Theme union in contexts/theme-context.tsx. The unit test pins
// that these are the only themes any stylesheet is scoped to.
const THEMES = ['light', 'dark', 'ocean'] as const
type Theme = (typeof THEMES)[number]

/** Exactly the order app/[locale]/layout.tsx imports them; hover-variants.css
 *  ties the theme sheets on specificity and must win on source order. */
const STYLESHEETS = [
  'light-theme.css',
  'dark-theme.css',
  'ocean-theme.css',
  'hover-variants.css',
]

/**
 * Baseline styling for probe elements.
 *
 * It has to be a stylesheet rule, not an inline style: an inline background or
 * border would outrank the very `hover:theme-*` rule under test, and the spec
 * would report a working stylesheet as broken.  At (0,1,0) it loses cleanly to
 * the (0,3,0) hover variants.
 */
const PROBE_BASELINE = `
  .awtd-probe {
    position: fixed;
    top: 0;
    left: 0;
    padding: 20px;
    background-color: rgba(0, 0, 0, 0);
    border: 1px solid transparent;
  }
`

async function useTheme(page: Page, theme: Theme) {
  await page.evaluate(
    ({ t, all }) => {
      const root = document.documentElement
      root.classList.remove(...all)
      root.classList.add(t)
    },
    { t: theme, all: [...THEMES] },
  )
}

/** Render `declaration` on a throwaway element and read back what the browser
 *  computed, so a custom property resolves to the current theme's value. */
async function resolve(page: Page, property: string, declaration: string): Promise<string> {
  return page.evaluate(
    ({ property, declaration }) => {
      const el = document.createElement('div')
      el.style.cssText = declaration
      document.body.appendChild(el)
      const value = getComputedStyle(el).getPropertyValue(property)
      el.remove()
      return value
    },
    { property, declaration },
  )
}

/**
 * Mount a probe carrying `className`, replacing any previous one so a hover
 * cannot land on a leftover probe stacked underneath.
 *
 * The pointer is parked away from the mount point first. Probes share a fixed
 * position, so otherwise the mouse is still resting where the previous probe
 * was and the new one is already in :hover before its resting colour is read.
 */
async function probe(page: Page, className: string): Promise<Locator> {
  await page.mouse.move(600, 400)
  await page.evaluate((cls) => {
    document.querySelectorAll('.awtd-probe').forEach((el) => el.remove())
    const el = document.createElement('button')
    el.className = `awtd-probe ${cls}`
    el.textContent = 'hover me'
    document.body.appendChild(el)
  }, className)
  return page.locator('.awtd-probe')
}

/**
 * Move the real pointer onto the probe.
 *
 * Deliberately not `locator.hover()`: its actionability checks hang on a
 * `position: fixed` element on an otherwise empty page, and buy nothing when
 * the probe is the only element on it.
 */
async function hoverProbe(page: Page, target: Locator) {
  const box = await target.boundingBox()
  expect(box, 'probe must have a layout box to hover').not.toBeNull()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
}

test.describe('hover:theme-* variants (AWTD-936, AWTD-935)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('about:blank')
    for (const sheet of STYLESHEETS) {
      await page.addStyleTag({ path: join(process.cwd(), 'styles', 'themes', sheet) })
    }
    await page.addStyleTag({ content: PROBE_BASELINE })
    // Park the pointer away from where probes mount.
    await page.mouse.move(600, 400)
  })

  for (const theme of THEMES) {
    test(`${theme}: every hover:theme-* class in use changes what it claims to`, async ({ page }) => {
      await useTheme(page, theme)

      const muted = await resolve(page, 'color', 'color: rgb(var(--theme-text-muted))')
      const textPrimary = await resolve(page, 'color', 'color: rgb(var(--theme-text-primary))')
      const textSecondary = await resolve(page, 'color', 'color: rgb(var(--theme-text-secondary))')
      const surfaceHover = await resolve(
        page,
        'background-color',
        'background-color: rgb(var(--theme-surface-hover))',
      )
      const border = await resolve(page, 'border-top-color', 'border-color: rgb(var(--theme-border))')

      // Sanity: a hover landing on the colour the element already had would pass
      // every assertion below while being invisible to a user. That is exactly
      // the trap --theme-bg-hover falls into in light (pure white, the same as
      // --theme-bg-primary), and the reason hover:theme-bg-hover resolves to
      // --theme-surface-hover instead.
      expect(textPrimary, 'primary must differ from muted, or the hover is invisible').not.toBe(muted)
      expect(textSecondary, 'secondary must differ from muted').not.toBe(muted)
      expect(surfaceHover, 'surface-hover must be a real colour').not.toBe('rgba(0, 0, 0, 0)')

      const toPrimary = await probe(page, 'theme-text-muted hover:theme-text-primary')
      await expect(toPrimary).toHaveCSS('color', muted)
      await hoverProbe(page, toPrimary)
      await expect(toPrimary, 'hover:theme-text-primary').toHaveCSS('color', textPrimary)

      const toSecondary = await probe(page, 'theme-text-muted hover:theme-text-secondary')
      await expect(toSecondary).toHaveCSS('color', muted)
      await hoverProbe(page, toSecondary)
      await expect(toSecondary, 'hover:theme-text-secondary').toHaveCSS('color', textSecondary)

      const bg = await probe(page, 'hover:theme-bg-hover')
      await expect(bg).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      await hoverProbe(page, bg)
      await expect(bg, 'hover:theme-bg-hover resolves to --theme-surface-hover').toHaveCSS(
        'background-color',
        surfaceHover,
      )

      const bordered = await probe(page, 'hover:theme-border')
      await expect(bordered).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)')
      await hoverProbe(page, bordered)
      await expect(bordered, 'hover:theme-border').toHaveCSS('border-top-color', border)

      // AWTD-935's cascade pin, kept. `.light .theme-text-secondary:hover` used
      // to tie this rule on specificity and lose only on source order, so
      // reordering the stylesheet would have silently broken the commonest
      // pairing in the app. That no-op rule is deleted now, and this fails
      // loudly if anything reintroduces one.
      const overSecondary = await probe(page, 'theme-text-secondary hover:theme-text-primary')
      await expect(overSecondary).toHaveCSS('color', textSecondary)
      await hoverProbe(page, overSecondary)
      await expect(
        overSecondary,
        'hover:theme-text-primary must beat the base theme-text-secondary colour',
      ).toHaveCSS('color', textPrimary)
    })
  }
})
