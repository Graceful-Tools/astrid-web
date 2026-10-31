import { test, expect } from '@playwright/test'

/**
 * Signed-in accessibility checks (AWTD-1435). Every assertion runs
 * unconditionally: the old spec's `if (visible)` early returns let it pass
 * having checked nothing.
 *
 * The sign-in form cases (error messages announced via role=alert /
 * aria-invalid) were dropped rather than ported: they need a signed-out
 * project, which does not exist. Their coverage is the sign-in page's own
 * component tests.
 */
test.describe('Accessibility', () => {
  test('has a page title', async ({ page }) => {
    await page.goto('/')
    expect((await page.title()).length).toBeGreaterThan(0)
  })

  test('has exactly one main landmark', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('main')).toHaveCount(1)
  })

  test('has a single h1', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  })

  test('first Tab lands on a skip link that moves focus past the sidebar', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('main').waitFor()

    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: 'Skip to content' })
    await expect(skip).toBeFocused()
    await expect(skip).toBeVisible()
    await expect(skip).toHaveAttribute('href', '#main-content')

    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/#main-content$/)
    await page.keyboard.press('Tab')
    const inSidebar = await page.evaluate(
      () => Boolean(document.activeElement?.closest('.app-sidebar, .app-sidebar-mobile')),
    )
    expect(inSidebar).toBe(false)
  })

  test('the logo is reachable and operable by keyboard', async ({ page }) => {
    await page.goto('/')
    const logo = page.getByRole('button', { name: 'Go to Home' })
    await logo.focus()
    await expect(logo).toBeFocused()
    await expect(logo).toHaveCSS('outline-style', /solid|auto/)
  })

  test('every button has an accessible name', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('main').waitFor()
    const unnamed = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button, [role=button]'))
        .filter(el => !(el as HTMLElement).hidden)
        .filter(el => !(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title') || el.textContent?.trim()))
        .map(el => el.outerHTML.slice(0, 120)),
    )
    expect(unnamed).toEqual([])
  })

  test('every image declares alt text', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('main').waitFor()
    const missing = await page.locator('img:not([alt])').count()
    expect(missing).toBe(0)
  })
})
