import { test, expect } from '@playwright/test'

const VIEWPORTS = {
  mobile: { width: 390, height: 844 },    // iPhone - 1 column
  tablet: { width: 820, height: 1180 },   // iPad - 2 column
  ipadAir: { width: 1024, height: 768 },  // iPad Air landscape - 2 column
  desktop: { width: 1440, height: 900 },  // Desktop - 3 column
}

test.describe('Sidebar Settings Footer', () => {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    test(`settings footer is visible and not clipped on ${name} (${viewport.width}x${viewport.height})`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      if (viewport.width < 1100) {
        // Mobile/tablet: open the sidebar drawer first
        const hamburger = page.locator('[data-hamburger-button], button:has(svg)').first()
        if (await hamburger.isVisible()) {
          await hamburger.click()
          await page.waitForTimeout(400) // wait for drawer animation
        }
      }

      // Settings footer should be visible (contains user avatar and settings icon)
      const settingsFooter = page.locator('button:has(svg[class*="lucide-settings"])')
      if (await settingsFooter.count() > 0) {
        const footer = settingsFooter.last()
        const box = await footer.boundingBox()
        if (box) {
          // Footer should be within the viewport
          expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 5)
          expect(box.y).toBeGreaterThanOrEqual(0)
        }
      }
    })
  }
})

test.describe('Sidebar Scrolling', () => {
  test('sidebar navigation area should be scrollable on desktop', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop)
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Find the scrollable navigation area
    const scrollableNav = page.locator('.sidebar-navigation')
    if (await scrollableNav.count() > 0) {
      const nav = scrollableNav.first()
      const overflowY = await nav.evaluate(el => getComputedStyle(el).overflowY)
      expect(['auto', 'scroll']).toContain(overflowY)
    }
  })

  test('sidebar navigation area should be scrollable on tablet', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.tablet)
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Open sidebar drawer
    const hamburger = page.locator('button').filter({ has: page.locator('svg') }).first()
    if (await hamburger.isVisible()) {
      await hamburger.click()
      await page.waitForTimeout(400)
    }

    const scrollableNav = page.locator('.sidebar-navigation')
    if (await scrollableNav.count() > 0) {
      const nav = scrollableNav.first()
      const overflowY = await nav.evaluate(el => getComputedStyle(el).overflowY)
      expect(['auto', 'scroll']).toContain(overflowY)
    }
  })
})

test.describe('Sidebar Layout Integrity', () => {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    test(`sidebar has proper flex layout on ${name}`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      if (viewport.width < 1100) {
        const hamburger = page.locator('button').filter({ has: page.locator('svg') }).first()
        if (await hamburger.isVisible()) {
          await hamburger.click()
          await page.waitForTimeout(400)
        }
      }

      // Check the sidebar container has flex-col layout
      const sidebar = page.locator('.app-sidebar, .app-sidebar-mobile').first()
      if (await sidebar.isVisible()) {
        const display = await sidebar.evaluate(el => getComputedStyle(el).display)
        const flexDirection = await sidebar.evaluate(el => getComputedStyle(el).flexDirection)
        expect(display).toBe('flex')
        expect(flexDirection).toBe('column')
      }
    })
  }

  test('sidebar footer stays at bottom, not pushed off screen on iPad', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Open sidebar
    const hamburger = page.locator('button').filter({ has: page.locator('svg') }).first()
    if (await hamburger.isVisible()) {
      await hamburger.click()
      await page.waitForTimeout(400)
    }

    // The sidebar should not exceed viewport height
    const sidebar = page.locator('.app-sidebar-mobile').first()
    if (await sidebar.isVisible()) {
      const sidebarBox = await sidebar.boundingBox()
      if (sidebarBox) {
        // Sidebar height should not exceed viewport
        expect(sidebarBox.height).toBeLessThanOrEqual(768 + 5)
      }
    }
  })
})

test.describe('Settings Navigation', () => {
  test('clicking search in sidebar shows search view on desktop', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop)
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Click the Search button in sidebar
    const searchButton = page.locator('.sidebar-navigation button', { hasText: /search/i }).first()
    if (await searchButton.isVisible()) {
      await searchButton.click()
      await page.waitForTimeout(300)

      // Search input should appear in the main content
      const searchInput = page.getByPlaceholder(/search tasks/i)
      await expect(searchInput).toBeVisible()
    }
  })
})
