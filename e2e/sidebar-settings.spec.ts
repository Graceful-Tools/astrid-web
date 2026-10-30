import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { gotoWithRetry } from './utils/test-helpers'

/**
 * The sidebar at each layout: reachable, laid out as a column, its list area
 * scrollable, and its settings footer on screen (AWTD-1425).
 *
 * Revived signed in. It used to wait for `networkidle` — which the app's live
 * SSE connection never reaches — open the drawer through "the first button
 * with an svg", and wrap each assertion in an `if (visible)` that let a run
 * pass having checked nothing.
 */

const VIEWPORTS = {
  mobile: { width: 390, height: 844 }, // iPhone - 1 column
  tablet: { width: 820, height: 1180 }, // iPad - 2 column
  ipadAir: { width: 1024, height: 768 }, // iPad Air landscape - 2 column
  desktop: { width: 1440, height: 900 }, // Desktop - 3 column
}

/** The sidebar, opened through the hamburger wherever the layout has one. */
async function openSidebar(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport)
  await gotoWithRetry(page, '/')
  const hamburger = page.locator('[data-hamburger-button]')
  // Narrow layouts put the sidebar in a drawer; desktop shows it in place.
  if (viewport.width < 1100) {
    await expect(hamburger).toBeVisible()
    await hamburger.click()
    const drawer = page.locator('.app-sidebar-mobile.app-sidebar-mobile-open')
    await expect(drawer).toBeVisible()
    return drawer
  }
  await expect(hamburger).toHaveCount(0)
  const sidebar = page.locator('.app-sidebar')
  await expect(sidebar).toBeVisible()
  return sidebar
}

test.describe('Sidebar at every layout', () => {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    test(`${name} (${viewport.width}x${viewport.height}): a flex column with a scrollable list area and the settings footer on screen`, async ({ page }) => {
      const sidebar = await openSidebar(page, viewport)

      expect(await sidebar.evaluate(el => getComputedStyle(el).display)).toBe('flex')
      expect(await sidebar.evaluate(el => getComputedStyle(el).flexDirection)).toBe('column')
      const box = (await sidebar.boundingBox())!
      expect(box.height).toBeLessThanOrEqual(viewport.height + 1)

      const nav = sidebar.locator('.sidebar-navigation')
      expect(['auto', 'scroll']).toContain(await nav.evaluate(el => getComputedStyle(el).overflowY))

      // The footer is the signed-in user's settings button, and must not be
      // pushed below the fold by a long list of lists.
      const footer = sidebar.getByRole('button', { name: /Playwright Owner/ })
      await expect(footer).toBeVisible()
      const footerBox = (await footer.boundingBox())!
      expect(footerBox.y).toBeGreaterThanOrEqual(0)
      expect(footerBox.y + footerBox.height).toBeLessThanOrEqual(viewport.height + 1)
    })
  }
})

test.describe('Sidebar navigation', () => {
  test('the settings footer opens Settings', async ({ page }) => {
    const sidebar = await openSidebar(page, VIEWPORTS.desktop)
    await sidebar.getByRole('button', { name: /Playwright Owner/ }).click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  })

  test('the search button opens search', async ({ page }) => {
    const sidebar = await openSidebar(page, VIEWPORTS.desktop)
    await sidebar.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page.getByPlaceholder(/search tasks/i).first()).toBeVisible()
  })
})
